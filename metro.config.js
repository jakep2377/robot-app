const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

const ignoredRoots = [
  path.join(projectRoot, '.git'),
  path.join(projectRoot, '.expo'),
  path.join(projectRoot, '.gradle-local'),
  path.join(projectRoot, 'dist'),
  path.join(projectRoot, 'dist-autonomy-check'),
  path.join(projectRoot, 'dist-style-check'),
  path.join(projectRoot, 'dist-test'),
  path.join(projectRoot, 'android', 'build'),
];

config.resolver.blockList = ignoredRoots.map((folder) => new RegExp(
  `^${folder.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')}([\\\\/].*)?$`
));

module.exports = config;
