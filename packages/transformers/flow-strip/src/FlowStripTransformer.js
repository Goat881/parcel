// @flow
import {Transformer} from '@parcel/plugin';

export default (new Transformer({
  async loadConfig({config, options}) {
    if (!config.isSource) {
      config.setResult(false);
      return;
    }

    // Only run flow if `flow-bin` is listed as a dependency in the root package.json
    let conf = await config.getConfigFrom(options.projectRoot + '/index', [
      'package.json',
    ]);
    let pkg = conf?.contents;

    config.setResult(
      pkg &&
        (pkg.dependencies?.['flow-bin'] != null ||
          pkg.devDependencies?.['flow-bin'] != null),
    );
  },

  async transform({asset, config, options}) {
    if (!config) {
      return [asset];
    }

    let [code, flowRemoveTypes] = await Promise.all([
      asset.getCode(),
      // TODO is config.addDevDependency() necessary?
      // Should it be improted in loadConfig()?
      options.packageManager.require(
        'flow-remove-types',
        options.projectRoot + '/index',
        {
          shouldAutoInstall: options.shouldAutoInstall,
          saveDev: true,
        },
      ),
    ]);

    // TODO sourcemaps?

    asset.setCode(flowRemoveTypes(code).toString());

    return [asset];
  },
}): Transformer);
