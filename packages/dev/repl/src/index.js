// @flow
// @jsx h
// @jsxFrag Fragment
/* eslint-disable react/jsx-no-bind */
// eslint-disable-next-line no-unused-vars
import {h, render, Fragment} from 'preact';
import {useEffect, useState, useReducer, useRef} from 'preact/hooks';

// $FlowFixMe
import parcelLogo from 'url:./assets/logo.svg';
// $FlowFixMe
import parcelText from 'url:./assets/parcel.png';

import {
  Editor,
  FileBrowser,
  Notes,
  Options,
  ParcelError,
  PresetSelector,
  Preview,
  Tabs,
  Graphs,
  useDebounce,
  useKeyboard,
  usePromise,
  useSessionStorage,
} from './components/';
import {saveState, reducer, getInitialState} from './components';
import type {State} from './components';
import filesize from 'filesize';

import {
  bundle,
  watch,
  workerReady,
  waitForFS,
  clientID as clientIDPromise,
} from './parcel/';

const STATUS_LOADING = Symbol('STATUS_LOADING');
const STATUS_RUNNING = Symbol('STATUS_RUNNING');
const STATUS_IDLING = Symbol('STATUS_IDLING');

function Status({watching, status, buildProgress, buildOutput}) {
  let buildDuration =
    buildOutput?.buildTime != null
      ? Math.round(buildOutput?.buildTime / 10) / 100
      : null;

  let text, color;
  if (status === STATUS_LOADING) {
    text = 'Loading...';
    color = '#D97706';
    // color = '#553701';
  } else if (status === STATUS_IDLING) {
    if (watching) {
      if (buildDuration != null) {
        text = `Watching... (last build took ${buildDuration}s)`;
      } else {
        text = 'Watching...';
      }
    } else {
      if (buildDuration != null) {
        text = `Finished in ${buildDuration}s`;
      } else {
        text = 'Ready';
      }
    }
    color = '#059669';
    // color = '#015551';
    // TODO: errors + "finished in 123s"
  } else if (status === STATUS_RUNNING) {
    if (buildProgress) {
      text = 'Running: ' + buildProgress;
    } else {
      text = 'Running...';
    }
    color = 'black';
  }

  return (
    <div class="status" style={{backgroundColor: color}}>
      {text}
    </div>
  );
}

function Output({state, dispatch}: {|state: State, dispatch: Function|}) {
  let [watching, setWatching] = useState(false);
  let [buildState, setBuildState] = useState(STATUS_LOADING);
  let [buildOutput, setBuildOutput] = useState(null);
  let [buildProgress, setBuildProgress] = useState(null);
  let [outputTabIndex, setOutputTabIndex] = useSessionStorage(
    'outputTabIndex',
    0,
  );
  let watchSubscriptionRef = useRef(null);

  useEffect(async () => {
    setBuildState(STATUS_LOADING);
    await workerReady(state.options.numWorkers);
    setBuildState(STATUS_IDLING);
  }, [state.options.numWorkers]);

  async function build() {
    setBuildState(STATUS_RUNNING);

    setBuildProgress(null);

    try {
      const output = await bundle(state.files, state.options, setBuildProgress);

      setBuildOutput(output);
      dispatch({
        type: 'diagnostics',
        value:
          output.type === 'failure' && output.diagnostics
            ? new Map(
                [...output.diagnostics]
                  .filter(([name]) => name)
                  .map(([name, data]) => ['/' + name, data]),
              )
            : null,
      });
    } catch (error) {
      console.error('Unexpected error', error);
    }

    setBuildState(STATUS_IDLING);
  }

  async function toggleWatch() {
    if (watchSubscriptionRef.current) {
      watchSubscriptionRef.current.unsubscribe();
      watchSubscriptionRef.current = null;
      setWatching(false);
    } else {
      setWatching(true);
      setBuildState(STATUS_RUNNING);
      let {unsubscribe, writeAssets} = await watch(
        state.files,
        state.options,
        output => {
          setBuildState(STATUS_IDLING);
          setBuildOutput(output);
          dispatch({
            type: 'diagnostics',
            value:
              output.type === 'failure' && output.diagnostics
                ? new Map(
                    [...output.diagnostics]
                      .filter(([name]) => name)
                      .map(([name, data]) => ['/' + name, data]),
                  )
                : null,
          });
        },
        setBuildProgress,
      );
      watchSubscriptionRef.current = {unsubscribe, writeAssets};
    }
  }

  useEffect(() => {
    if (watchSubscriptionRef.current) {
      watchSubscriptionRef.current.writeAssets(state.files);
      setBuildState(STATUS_RUNNING);
    }
  }, [state.files]);

  useKeyboard(
    e => {
      if (
        e.metaKey &&
        e.code === 'KeyB' &&
        !watching &&
        buildState !== STATUS_RUNNING
      ) {
        build();
        e.preventDefault();
      }
    },
    [build, buildState, watching],
  );

  let [clientID] = usePromise(clientIDPromise);

  return (
    <div class="output">
      <Status
        watching={watching}
        status={buildState}
        buildProgress={buildProgress}
        buildOutput={buildOutput}
      />
      <div class="header">
        <button
          disabled={watching || buildState !== STATUS_IDLING}
          onClick={build}
        >
          Build
        </button>
        <button disabled={buildState !== STATUS_IDLING} onClick={toggleWatch}>
          {watching ? 'Stop watching' : 'Watch'}
        </button>
      </div>
      <div class="files">
        {buildOutput?.type === 'success' && (
          <Tabs
            names={['Output', 'Preview']}
            selected={outputTabIndex}
            setSelected={setOutputTabIndex}
          >
            <div>
              <div class="list views">
                {buildOutput.bundles.map(({name, size, content}) => (
                  <div key={name} class="view selected">
                    <div class="name">
                      <span />
                      <span>{name}</span>
                      <span>{filesize(size)}</span>
                    </div>
                    <Editor name={name} value={content} readOnly />
                  </div>
                ))}
              </div>
              {buildOutput?.graphs && <Graphs graphs={buildOutput.graphs} />}
            </div>
            <Preview clientID={waitForFS().then(() => clientID)} />
          </Tabs>
        )}
        {buildOutput?.type === 'failure' && (
          <ParcelError output={buildOutput} />
        )}
      </div>
    </div>
  );
}

function Editors({state, dispatch}) {
  const views = [...state.views];
  const names = views.map(([name, data]) => (
    // $FlowFixMe
    <>
      <span></span>
      <span>{name}</span>
      <button
        class={data.value !== state.files.get(name)?.value && 'modified'}
        onClick={() => dispatch({type: 'view.close', name})}
      ></button>
    </>
  ));
  const children = views.map(([name, data]) => {
    if (data.component) {
      let Comp = data.component;
      return <Comp key={name} state={state} dispatch={dispatch} />;
    } else {
      return (
        <Editor
          key={name}
          dispatch={dispatch}
          name={name}
          value={data.value}
          diagnostics={state.diagnostics.get(name)}
        />
      );
    }
  });

  if (state.useTabs) {
    return (
      <Tabs
        names={names}
        class="editors views"
        mode="hide"
        selected={state.currentView}
        setSelected={i => dispatch({type: 'view.select', index: i})}
        fallback={<Notes />}
      >
        {children}
      </Tabs>
    );
  } else {
    let merged = [];
    for (let i = 0; i < views.length; i++) {
      merged.push(
        // $FlowFixMe
        <div class="view">
          <div class="name selected">{names[i]}</div>
          <div class="content">{children[i]}</div>
        </div>,
      );
    }
    return (
      <div class="list editors views">
        {merged}
        {children.length === 0 && <Notes />}
      </div>
    );
  }
}

function App() {
  let [state, dispatch] = useReducer(reducer, null, getInitialState);

  useDebounce(() => saveState(state), 500, [state.files, state.options]);

  useKeyboard(
    e => {
      if (e.metaKey && e.code === 'KeyS') {
        dispatch({type: 'view.saveCurrent'});
        e.preventDefault();
      } else if (e.ctrlKey && e.code === 'KeyW') {
        dispatch({type: 'view.closeCurrent'});
        e.preventDefault();
      }
    },
    [dispatch],
  );

  return (
    // $FlowFixMe
    <>
      <main>
        <FileBrowser
          files={state.files}
          collapsed={state.browserCollapsed}
          dispatch={dispatch}
          isEditing={state.isEditing}
        >
          <header>
            <a href="/">
              <img
                class="parcel"
                src={parcelText}
                height="30"
                style="margin-top: 5px;"
                alt=""
              />
              <img class="type" src={parcelLogo} style="width: 120px;" alt="" />
              <span style="font-size: 25px;">REPL</span>
            </a>
          </header>
          <div>
            <PresetSelector dispatch={dispatch} />
            <div class="options">
              <button
                onClick={() =>
                  dispatch({
                    type: 'view.open',
                    name: 'Options',
                    component: Options,
                  })
                }
              >
                Options
              </button>
              <button
                title="Toggle view"
                class={'view ' + (state.useTabs ? 'tabs' : '')}
                onClick={() =>
                  dispatch({
                    type: 'toggleView',
                  })
                }
              >
                <span></span>
              </button>
            </div>
          </div>
        </FileBrowser>
        <Editors state={state} dispatch={dispatch} />
        <Output state={state} dispatch={dispatch} />
      </main>
    </>
  );
}

render(<App />, document.getElementById('root'));

if (navigator.serviceWorker) {
  navigator.serviceWorker.register('./sw.js').catch(error => {
    // eslint-disable-next-line no-console
    console.error('Service worker registration failed:', error);
  });
}
