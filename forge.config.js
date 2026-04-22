module.exports = {
  packagerConfig: {
    name: 'PiPilot IDE',
    executableName: 'pipilot-ide',
    appBundleId: 'dev.pipilot.ide',
    asar: true,
    ignore: [
      /^\/\.git/,
      /^\/\.env$/,
      /^\/\.vscode/,
      /^\/out/,
      /^\/dist/,
      /^\/\.idea/,
    ],
  },
  rebuildConfig: {},
  makers: [
    { name: '@electron-forge/maker-squirrel', config: { name: 'pipilot_ide' } },
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux'] },
    { name: '@electron-forge/maker-deb', config: {} },
    { name: '@electron-forge/maker-rpm', config: {} },
  ],
  plugins: [],
};
