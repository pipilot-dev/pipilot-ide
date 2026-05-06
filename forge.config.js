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
// win32-x64 (no linux — built from source there). Drop the wrong ones —
// arch-aware, so a win32-x64 build doesn't carry the win32-arm64 binary
// (~28 MB saving on Windows alone).
function nodePtyKeepFor(platform, arch) {
  const a = arch || process.arch;
  if (platform === 'win32')  return new Set([`win32-${a}`]);
  if (platform === 'darwin') return new Set([`darwin-${a}`]);
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
  // .env DELIBERATELY NOT excluded — it has to ship so CODESTRAL_API_KEY,
  // GROQ_API_KEY etc. are available in the packaged app. CI writes it
  // from GitHub Actions secrets before forge runs (see workflow).
  // Anthropic creds are NOT in this file — they come from the user's
  // JWT via the auth-gated proxy at runtime.
  /^[\\/]?auth-token\.bin$/,
  /^[\\/]?test[\\/]/,                      // our own smoke tests, not shipped
];

module.exports = {
  packagerConfig: {
    name: 'PiPilot IDE',
    executableName: 'pipilot-ide',
    appBundleId: 'dev.pipilot.ide',
    asar: {
      // The Claude Agent SDK spawns its bundled cli.js as a child process.
      // Files inside app.asar can't be exec'd by spawn() — they're not
      // real on-disk files from the OS's POV. Unpack the SDK so cli.js
      // is a real file at <install>/resources/app.asar.unpacked/...
      // node-pty's prebuilt .node binaries have the same constraint
      // (native loaders can't dlopen across the asar boundary).
      unpack: '{**/node_modules/@anthropic-ai/claude-agent-sdk/**,**/node_modules/node-pty/**}',
    },
    // Platform-specific icon extension auto-resolved (.ico/.icns/.png).
    // public/icon.ico is generated from icon.png at install time by
    // scripts/build-icons.js. macOS .icns isn't generated yet — Mac
    // builds fall back to the .png. (TODO v0.2: add iconutil step.)
    icon: path.join(__dirname, 'public', 'icon'),
    // Per-platform ignore. `platform` is auto-injected by electron-packager.
    ignore: function (filePath) {
      const targetPlatform = this.platform || process.platform;
      const targetArch     = this.arch     || process.arch;
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

      // 3. node-pty prebuilds — drop wrong-platform AND wrong-arch native
      //    binaries. A win32-x64 build doesn't need the win32-arm64 .node.
      const ptyMatch = norm.match(/[/\\]node_modules[/\\]node-pty[/\\]prebuilds[/\\]([^/\\]+)/);
      if (ptyMatch) {
        const keep = nodePtyKeepFor(targetPlatform, targetArch);
        if (!keep.has(ptyMatch[1])) return true;
      }

      return false;
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        // Install folder name + NuGet package id. Must be a valid Windows
        // filename and a valid NuGet id (alphanumeric + . _ -, no spaces).
        // Determines:
        //   %LocalAppData%\PiPilot\               install root
        //   %LocalAppData%\PiPilot\app-x.y.z\     per-version dir
        //   PiPilot-x.y.z-full.nupkg              update package name
        name: 'PiPilot',
        // Friendly display name used in the install wizard, Add/Remove
        // Programs entry, and shortcut labels. Spaces are fine here.
        title: 'PiPilot IDE',
        // Installer filename — what users actually click to install.
        setupExe: 'PiPilot-Setup.exe',
        // Brands the installer wizard + the Add/Remove Programs entry.
        // public/icon.ico is generated at install time by build-icons.js.
        setupIcon: path.join(__dirname, 'public', 'icon.ico'),
      },
    },
    { name: '@electron-forge/maker-zip', platforms: ['darwin', 'linux'] },
    { name: '@electron-forge/maker-deb', config: {} },
    { name: '@electron-forge/maker-rpm', config: {} },
  ],
  plugins: [],
};
