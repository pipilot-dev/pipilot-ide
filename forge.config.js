// PiPilot IDE — electron-forge config.
//
// The `ignore` function does the heavy lifting: forge calls it for every
// path it considers including in the bundle, and we return true to drop
// it. This is where most of the bundle-size optimisation lives.

const path = require('path');

// Map node platforms to the SDK's vendored ripgrep folder names so we
// keep ONLY the binary that matches the build target. Saves ~42 MB per
// build by dropping the four other-platform binaries.
const RIPGREP_BY_PLATFORM = {
  win32:  ['x64-win32', 'arm64-win32'],
  darwin: ['x64-darwin', 'arm64-darwin'],
  linux:  ['x64-linux', 'arm64-linux'],
};
function ripgrepKeepFor(platform) {
  return new Set(RIPGREP_BY_PLATFORM[platform] || []);
}

// node-pty ships prebuilds for darwin-arm64, darwin-x64, win32-arm64,
// win32-x64 (no linux — built from source there). Drop the wrong ones.
function nodePtyKeepFor(platform) {
  if (platform === 'win32') return new Set(['win32-x64', 'win32-arm64']);
  if (platform === 'darwin') return new Set(['darwin-x64', 'darwin-arm64']);
  return new Set();   // linux builds from source via electron-rebuild
}

// Always-drop patterns: dev-only directories, source maps, type defs,
// markdown docs inside dependencies, test fixtures. None of this is
// useful at runtime and it adds 10-20 MB.
const ALWAYS_DROP = [
  /[\\/]\.git[\\/]/,
  /[\\/]\.github[\\/]/,
  /[\\/]\.vscode[\\/]/,
  /[\\/]\.idea[\\/]/,
  /[\\/]\.pipilot[\\/]/,
  /[\\/]\.pipilot-data[\\/]/,
  /[\\/]\.claude[\\/]/,
  /[\\/]\.cache[\\/]/,
  /[\\/]node_modules[\\/].+\.md$/i,
  /[\\/]node_modules[\\/].+\.map$/i,
  /[\\/]node_modules[\\/].+\.ts$/,        // type defs + TS sources we don't run
  /[\\/]node_modules[\\/].+\.d\.ts$/,
  /[\\/]node_modules[\\/].+[\\/]test[\\/]/,
  /[\\/]node_modules[\\/].+[\\/]tests[\\/]/,
  /[\\/]node_modules[\\/].+[\\/]example[\\/]/,
  /[\\/]node_modules[\\/].+[\\/]examples[\\/]/,
  /[\\/]node_modules[\\/].+[\\/]docs?[\\/]/,
  /[\\/]node_modules[\\/].+\.flow$/,
  /\.DS_Store$/,
  /[\\/]out[\\/]/,
  /[\\/]dist[\\/]/,
  /^[\\/]?\.env$/,
  /^[\\/]?auth-token\.bin$/,
  /^[\\/]?test[\\/]/,                      // our own smoke tests, not shipped
];

module.exports = {
  packagerConfig: {
    name: 'PiPilot IDE',
    executableName: 'pipilot-ide',
    appBundleId: 'dev.pipilot.ide',
    asar: true,
    icon: path.join(__dirname, 'public', 'icon'),   // platform-specific extension auto-resolved
    // Per-platform ignore. `platform` is auto-injected by electron-packager.
    ignore: function (filePath) {
      const targetPlatform = this.platform || process.platform;
      // Normalise the path forge passes in so our regexes work cross-OS.
      const norm = filePath.replace(/\\/g, '/');

      // 1. Always-drop patterns
      for (const re of ALWAYS_DROP) {
        if (re.test(filePath) || re.test(norm)) return true;
      }

      // 2. SDK ripgrep — keep only the matching platform's binaries.
      const rgMatch = norm.match(/[/\\]node_modules[/\\]@anthropic-ai[/\\]claude-agent-sdk[/\\]vendor[/\\]ripgrep[/\\]([^/\\]+)/);
      if (rgMatch) {
        const keep = ripgrepKeepFor(targetPlatform);
        if (!keep.has(rgMatch[1]) && rgMatch[1] !== 'COPYING') return true;
      }

      // 3. node-pty prebuilds — drop wrong-platform native binaries.
      const ptyMatch = norm.match(/[/\\]node_modules[/\\]node-pty[/\\]prebuilds[/\\]([^/\\]+)/);
      if (ptyMatch) {
        const keep = nodePtyKeepFor(targetPlatform);
        if (!keep.has(ptyMatch[1])) return true;
      }

      return false;
    },
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
