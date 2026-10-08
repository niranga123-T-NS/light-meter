// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// pdf-lib (HSE forms) imports tslib; its "exports" map sends the web bundle to modules/index.js, which reads a
// default export the CommonJS build does not have and crashes the screen ("Cannot destructure '__extends'").
// Always use tslib's plain CommonJS build.
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'tslib') return { type: 'sourceFile', filePath: require.resolve('tslib/tslib.js') };
  return resolveRequest ? resolveRequest(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
