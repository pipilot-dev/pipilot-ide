/**
 * Real language diagnostics for project workspaces.
 *
 * Currently supports:
 *  - TypeScript / JavaScript via `tsc --noEmit`
 *  - JSON via Node's built-in JSON parser
 *  - ESLint (if installed in node_modules/.bin/eslint)
 *
 * Additional checkers can be added easily.
 */

import { spawn, exec } from "child_process";
import { promisify } from "util";
import { createRequire } from "module";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);
const require = createRequire(import.meta.url);

export interface Diagnostic {
  file: string;       // workspace-relative path
  line: number;       // 1-indexed
  column: number;     // 1-indexed
  severity: "error" | "warning" | "info";
  code?: string;      // e.g. "TS2304" or "no-unused-vars"
  message: string;
  source: "typescript" | "eslint" | "json" | "syntax" | "python" | "go" | "rust" | "php" | "ruby";
}

/** Check whether a binary exists on PATH (cross-platform) */
function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const which = isWindows ? "where" : "which";
    const proc = spawn(which, [cmd], { shell: false });
    proc.on("exit", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

const isWindows = process.platform === "win32";

/** Locate a binary inside node_modules/.bin and return the JS entry to run via node */
function findLocalBin(workDir: string, name: string): string | null {
  const binDir = path.join(workDir, "node_modules", ".bin");

  // On Windows, prefer the .cmd wrapper which we parse to find the actual
  // JS entry point. The no-extension file in .bin is a Linux shell script
  // and would fail if passed to node.
  if (isWindows) {
    const winCmd = path.join(binDir, `${name}.cmd`);
    if (fs.existsSync(winCmd)) {
      try {
        const content = fs.readFileSync(winCmd, "utf8");
        const m = content.match(/%dp0%\\([^"]+)"/);
        if (m) {
          const rel = m[1].replace(/\\/g, "/");
          const full = path.join(binDir, rel);
          if (fs.existsSync(full)) return full;
        }
      } catch {}
    }
    // Fallback: try the package's bin directly
    try {
      const pkgPath = path.join(workDir, "node_modules", name, "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        let binEntry: string | undefined;
        if (typeof pkg.bin === "string") binEntry = pkg.bin;
        else if (pkg.bin && typeof pkg.bin === "object") binEntry = pkg.bin[name] || Object.values(pkg.bin)[0] as string;
        if (binEntry) {
          const full = path.join(workDir, "node_modules", name, binEntry);
          if (fs.existsSync(full)) return full;
        }
      }
    } catch {}
    return null;
  }

  // On Linux/Mac, the .bin/<name> is a real symlink to the JS entry
  const direct = path.join(binDir, name);
  if (fs.existsSync(direct)) return direct;
  return null;
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 60000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    // Only use shell for .cmd/.bat wrapper invocations on Windows.
    // When invoking node directly with absolute paths, NOT using shell
    // is more reliable and avoids cmd.exe arg-mangling.
    const useShell = isWindows && (
      command.endsWith(".cmd") ||
      command.endsWith(".bat") ||
      command === "npx" ||
      command === "npx.cmd"
    );
    const proc = spawn(command, args, { cwd, shell: useShell });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
    }, timeoutMs);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `spawn error: ${err.message}`, code: -1 });
    });
  });
}

// ─── Dependency installation ─────────────────────────────────────

interface InstallResult {
  installed: boolean;       // true if we ran an install in this call
  alreadyPresent: boolean;  // true if node_modules was already there
  packageManager: "pnpm" | "yarn" | "npm" | null;
  durationMs: number;
  error?: string;
}

/** Detect which package manager the project uses based on lockfile */
function detectPackageManager(workDir: string): "pnpm" | "yarn" | "npm" | null {
  if (fs.existsSync(path.join(workDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(workDir, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(workDir, "package-lock.json"))) return "npm";
  if (fs.existsSync(path.join(workDir, "package.json"))) return "npm"; // default
  return null;
}

/** Track in-flight installs so we don't kick off two installs for one project */
const inFlightInstalls = new Map<string, Promise<InstallResult>>();

/**
 * Ensure node_modules exists for a project. If package.json is present and
 * node_modules is missing (or empty), runs the project's package manager.
 *
 * Without this, TypeScript can't resolve any imports — every `import 'react'`
 * becomes a TS2307 "Cannot find module" error and the diagnostics list is
 * dominated by noise instead of real bugs.
 */
export async function ensureNodeModules(workDir: string): Promise<InstallResult> {
  const start = Date.now();
  const pkgPath = path.join(workDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return { installed: false, alreadyPresent: false, packageManager: null, durationMs: 0 };
  }

  const nmPath = path.join(workDir, "node_modules");
  // "Present" = directory exists AND has at least one entry that isn't .package-lock.json
  let alreadyPresent = false;
  if (fs.existsSync(nmPath)) {
    try {
      const entries = fs.readdirSync(nmPath).filter((e) => !e.startsWith("."));
      alreadyPresent = entries.length > 0;
    } catch {}
  }

  const pm = detectPackageManager(workDir);
  if (alreadyPresent) {
    return { installed: false, alreadyPresent: true, packageManager: pm, durationMs: Date.now() - start };
  }
  if (!pm) {
    return { installed: false, alreadyPresent: false, packageManager: null, durationMs: Date.now() - start };
  }

  // Dedupe concurrent installs for same workDir
  const key = path.resolve(workDir);
  const existing = inFlightInstalls.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<InstallResult> => {
    // pnpm/yarn/npm — install command. Use --no-audit/--no-fund for npm to keep it quick.
    const args =
      pm === "pnpm" ? ["install", "--prefer-offline", "--ignore-scripts"]
      : pm === "yarn" ? ["install", "--prefer-offline", "--ignore-scripts"]
      : ["install", "--prefer-offline", "--no-audit", "--no-fund", "--ignore-scripts"];

    const cmd = isWindows ? `${pm}.cmd` : pm;
    const result = await runCommand(cmd, args, workDir, 5 * 60_000); // 5 min cap

    if (result.code !== 0) {
      return {
        installed: false,
        alreadyPresent: false,
        packageManager: pm,
        durationMs: Date.now() - start,
        error: (result.stderr || result.stdout || "install failed").slice(0, 2000),
      };
    }
    return { installed: true, alreadyPresent: false, packageManager: pm, durationMs: Date.now() - start };
  })();

  inFlightInstalls.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlightInstalls.delete(key);
  }
}

// ─── TypeScript ──────────────────────────────────────────────────

/** Detect if the project has a tsconfig.json or jsconfig.json */
function hasTsConfig(workDir: string): boolean {
  return fs.existsSync(path.join(workDir, "tsconfig.json"));
}

function hasJsConfig(workDir: string): boolean {
  return fs.existsSync(path.join(workDir, "jsconfig.json"));
}

/**
 * Load the TypeScript module — prefer the project's own version if it has
 * one in node_modules (so we match the exact version the project expects),
 * otherwise fall back to the server-bundled typescript dependency.
 */
function loadTypeScript(workDir: string): typeof import("typescript") | null {
  // Try project's own copy first
  try {
    const localPath = path.join(workDir, "node_modules", "typescript");
    if (fs.existsSync(localPath)) {
      // require.resolve to get the entry point, then require it
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(localPath);
    }
  } catch {}
  // Fallback to server-bundled
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("typescript");
  } catch {
    return null;
  }
}

/**
 * Run TypeScript type checking using the COMPILER API directly (no spawn).
 *
 * This is the same approach Dyad uses — much faster than spawning `tsc`
 * because there's no process startup, no string parsing, and we get
 * structured Diagnostic objects with precise line/column info.
 *
 * Loads the project's own typescript when available so we use the exact
 * version the project depends on, otherwise falls back to the bundled one.
 */
export async function runTypeScriptCheck(workDir: string): Promise<Diagnostic[]> {
  const hasTs = hasTsConfig(workDir);
  const hasJs = hasJsConfig(workDir);
  if (!hasTs && !hasJs) return [];

  // Make sure node_modules exists so TS can resolve imports — without this
  // every `import 'react'` becomes a TS2307 and floods the diagnostics list.
  await ensureNodeModules(workDir).catch(() => {});

  const ts = loadTypeScript(workDir);
  if (!ts) return [];

  // Resolve the right config file
  const configFileName = hasTs ? "tsconfig.json" : "jsconfig.json";
  const configPath = path.join(workDir, configFileName);

  // Parse the config — ts.parseJsonConfigFileContent does extends resolution,
  // include/exclude expansion, all the things tsc does on startup.
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    const d = formatTsDiagnostic(ts, configFile.error, workDir);
    return d ? [d] : [];
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    workDir,
    {},
    configPath,
  );

  if (parsed.errors.length > 0) {
    const errs = parsed.errors
      .map((e) => formatTsDiagnostic(ts, e, workDir))
      .filter((d): d is Diagnostic => d !== null);
    if (errs.length > 0) return errs;
  }

  // Create the program — this is the heavy step but it caches well
  // when called repeatedly with the same files.
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });

  // Get all diagnostics — syntactic + semantic + global
  const allDiagnostics = ts.getPreEmitDiagnostics(program);

  return allDiagnostics
    .map((d) => formatTsDiagnostic(ts, d, workDir))
    .filter((d): d is Diagnostic => d !== null);
}

/** Convert a TypeScript Diagnostic into our common Diagnostic shape */
function formatTsDiagnostic(
  ts: typeof import("typescript"),
  d: import("typescript").Diagnostic,
  workDir: string,
): Diagnostic | null {
  // Severity mapping
  let severity: Diagnostic["severity"] = "error";
  if (d.category === ts.DiagnosticCategory.Warning) severity = "warning";
  else if (d.category === ts.DiagnosticCategory.Suggestion) severity = "info";
  else if (d.category === ts.DiagnosticCategory.Message) severity = "info";

  let line = 1;
  let column = 1;
  let filePath = "";

  if (d.file && d.start !== undefined) {
    const pos = d.file.getLineAndCharacterOfPosition(d.start);
    line = pos.line + 1;
    column = pos.character + 1;
    filePath = d.file.fileName;
    // Make path workspace-relative with forward slashes
    if (path.isAbsolute(filePath)) {
      filePath = path.relative(workDir, filePath);
    }
    filePath = filePath.replace(/\\/g, "/");
    // Skip diagnostics from node_modules — we don't want to flood the panel
    if (filePath.includes("node_modules/")) return null;
  } else {
    // Global diagnostic with no file — skip if it's a config issue we don't care about
    return null;
  }

  // Flatten the message — TS messages can be a chain
  const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");

  return {
    file: filePath,
    line,
    column,
    severity,
    code: `TS${d.code}`,
    message,
    source: "typescript",
  };
}

// ─── ESLint ──────────────────────────────────────────────────────

interface EslintMessage {
  ruleId: string | null;
  severity: 1 | 2;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
  errorCount: number;
  warningCount: number;
}

function hasEslintConfig(workDir: string): boolean {
  const candidates = [
    ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs",
    ".eslintrc.yml", ".eslintrc.yaml", ".eslintrc",
    "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs",
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(workDir, c))) return true;
  }
  // Or via package.json eslintConfig field
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(workDir, "package.json"), "utf8"));
    if (pkg.eslintConfig) return true;
  } catch {}
  return false;
}

export async function runEslintCheck(workDir: string): Promise<Diagnostic[]> {
  const localEslint = findLocalBin(workDir, "eslint");
  if (!localEslint || !hasEslintConfig(workDir)) return [];

  const result = await runCommand(
    process.execPath,
    [localEslint, "--format", "json", "--ext", ".ts,.tsx,.js,.jsx", "."],
    workDir,
    120000,
  );

  const diagnostics: Diagnostic[] = [];
  try {
    // eslint may print non-JSON warnings before the JSON output
    const jsonStart = result.stdout.indexOf("[");
    const jsonText = jsonStart >= 0 ? result.stdout.slice(jsonStart) : result.stdout;
    const parsed: EslintFileResult[] = JSON.parse(jsonText);
    for (const file of parsed) {
      let relPath = file.filePath;
      if (path.isAbsolute(relPath)) {
        relPath = path.relative(workDir, relPath);
      }
      relPath = relPath.replace(/\\/g, "/");
      for (const msg of file.messages) {
        diagnostics.push({
          file: relPath,
          line: msg.line || 1,
          column: msg.column || 1,
          severity: msg.severity === 2 ? "error" : "warning",
          code: msg.ruleId || undefined,
          message: msg.message,
          source: "eslint",
        });
      }
    }
  } catch {
    // ESLint failed to produce JSON — likely a config error
  }

  return diagnostics;
}

// ─── Plain JS/TS syntax check (Acorn-based, no config required) ─

/**
 * Walk the workspace and run a syntax check on every .js/.mjs/.cjs file
 * via `node --check`. This is Node's built-in syntax checker and supports
 * both CommonJS and ES modules natively. Skips .jsx/.tsx (need a JSX parser).
 */
export async function runJsSyntaxCheck(workDir: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const skipDirs = new Set([
    "node_modules", ".git", "dist", "build", ".next", "out",
    ".cache", ".vite", "coverage", ".turbo", ".vercel",
  ]);
  // Only check pure JS files — JSX/TSX need a proper parser
  const exts = new Set([".js", ".mjs", ".cjs"]);
  const filesToCheck: string[] = [];

  function walk(dir: string, rel: string) {
    if (filesToCheck.length > 200) return; // cap
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      const full = path.join(dir, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      let stat: fs.Stats;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        walk(full, relPath);
      } else if (stat.isFile()) {
        const ext = path.extname(entry).toLowerCase();
        if (!exts.has(ext)) continue;
        if (stat.size > 500_000) continue;
        // Skip files containing JSX-looking syntax
        try {
          const peek = fs.readFileSync(full, "utf8").slice(0, 4000);
          if (/<[A-Z][\w.]*[\s/>]/.test(peek) || /<\/[A-Z][\w.]*>/.test(peek)) continue;
        } catch { continue; }
        filesToCheck.push(relPath);
      }
    }
  }
  walk(workDir, "");

  // Run `node --check` on each file in parallel batches
  const BATCH = 10;
  for (let i = 0; i < filesToCheck.length; i += BATCH) {
    const batch = filesToCheck.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((relPath) =>
        runCommand(process.execPath, ["--check", relPath], workDir, 10000),
      ),
    );
    for (let j = 0; j < batch.length; j++) {
      const res = results[j];
      const relPath = batch[j];
      if (res.code === 0) continue;
      // Parse Node syntax error output. Examples:
      //   path/file.js:5
      //   foo bar
      //       ^^^
      //   SyntaxError: Unexpected identifier 'bar'
      const out = res.stderr + res.stdout;
      // Try to find a line with "SyntaxError: ..."
      const errMatch = out.match(/SyntaxError:\s*(.+)/);
      if (!errMatch) continue;
      const message = errMatch[1].trim();
      // Try to find the file:line at the start
      const locMatch = out.match(/[^:\n]+:(\d+)\s*$/m);
      const line = locMatch ? parseInt(locMatch[1]) : 1;
      diagnostics.push({
        file: relPath,
        line,
        column: 1,
        severity: "error",
        code: "syntax",
        message,
        source: "syntax",
      });
    }
  }

  return diagnostics;
}

/**
 * Fallback TypeScript check via compiler API when the project has
 * .ts/.tsx files but no tsconfig.json. Builds a Program in-memory with
 * sensible defaults and runs the same diagnostic extraction.
 */
export async function runTypeScriptFallback(workDir: string): Promise<Diagnostic[]> {
  const ts = loadTypeScript(workDir);
  if (!ts) return [];

  // Find .ts/.tsx files in the workspace (cap at 200)
  const skipDirs = new Set(["node_modules", ".git", "dist", "build", ".next", "out"]);
  const tsFiles: string[] = [];

  function findTs(dir: string, rel: string) {
    if (tsFiles.length > 200) return;
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      const full = path.join(dir, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      let stat: fs.Stats;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        findTs(full, relPath);
      } else if (stat.isFile()) {
        const ext = path.extname(entry).toLowerCase();
        if (ext === ".ts" || ext === ".tsx") tsFiles.push(full);
      }
    }
  }
  findTs(workDir, "");

  if (tsFiles.length === 0) return [];

  // Use the compiler API directly with sensible default options
  const compilerOptions: import("typescript").CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    lib: ["lib.dom.d.ts", "lib.esnext.d.ts"],
    allowJs: true,
    checkJs: false,
    skipLibCheck: true,
    strict: false,
    noEmit: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    isolatedModules: true,
  };

  const program = ts.createProgram({
    rootNames: tsFiles,
    options: compilerOptions,
  });

  const allDiagnostics = ts.getPreEmitDiagnostics(program);
  return allDiagnostics
    .map((d) => formatTsDiagnostic(ts, d, workDir))
    .filter((d): d is Diagnostic => d !== null);
}

// ─── JSON syntax ─────────────────────────────────────────────────

export async function runJsonCheck(workDir: string): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const skipDirs = new Set(["node_modules", ".git", "dist", "build", ".next", "out", ".cache"]);

  function walk(dir: string, rel: string) {
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      const full = path.join(dir, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      let stat: fs.Stats;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        walk(full, relPath);
      } else if (stat.isFile() && (entry.endsWith(".json") || entry === ".eslintrc")) {
        if (stat.size > 1_000_000) continue; // skip huge JSONs
        try {
          const content = fs.readFileSync(full, "utf8");
          JSON.parse(content);
        } catch (err: any) {
          // Try to extract line/column from JSON.parse error
          const msg = err.message || String(err);
          const lineMatch = msg.match(/line (\d+)/i);
          const colMatch = msg.match(/column (\d+)/i);
          const positionMatch = msg.match(/position (\d+)/i);
          let line = lineMatch ? parseInt(lineMatch[1]) : 1;
          let column = colMatch ? parseInt(colMatch[1]) : 1;
          if (positionMatch && line === 1 && column === 1) {
            const pos = parseInt(positionMatch[1]);
            try {
              const content = fs.readFileSync(full, "utf8");
              const upTo = content.slice(0, pos);
              line = upTo.split("\n").length;
              const lastNl = upTo.lastIndexOf("\n");
              column = lastNl >= 0 ? pos - lastNl : pos + 1;
            } catch {}
          }
          diagnostics.push({
            file: relPath,
            line,
            column,
            severity: "error",
            code: "json-parse",
            message: msg.replace(/^Unexpected token .* in JSON at position \d+/, "Invalid JSON: " + msg.split("\n")[0]),
            source: "json",
          });
        }
      }
    }
  }

  walk(workDir, "");
  return diagnostics;
}

// ─── Generic helpers for non-JS languages ───────────────────────

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out",
  ".cache", ".vite", "coverage", ".turbo", ".vercel",
  "__pycache__", ".venv", "venv", "env", ".mypy_cache", ".pytest_cache",
  "target", "vendor",
]);

function findFilesByExt(workDir: string, exts: Set<string>, cap = 500): string[] {
  const out: string[] = [];
  function walk(dir: string, rel: string) {
    if (out.length >= cap) return;
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (out.length >= cap) return;
      if (SKIP_DIRS.has(entry)) continue;
      const full = path.join(dir, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      let stat: fs.Stats;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.isDirectory()) walk(full, relPath);
      else if (stat.isFile()) {
        const ext = path.extname(entry).toLowerCase();
        if (exts.has(ext)) out.push(relPath);
      }
    }
  }
  walk(workDir, "");
  return out;
}

function fileExistsAny(workDir: string, names: string[]): boolean {
  return names.some((n) => fs.existsSync(path.join(workDir, n)));
}

// ─── Python ──────────────────────────────────────────────────────

interface PyrightDiagnostic {
  file: string;
  severity: "error" | "warning" | "information";
  message: string;
  range: { start: { line: number; character: number } };
  rule?: string;
}

interface PyrightOutput {
  generalDiagnostics: PyrightDiagnostic[];
  summary?: { errorCount: number; warningCount: number };
}

/** Find pyright in the project's venv or on PATH */
async function findPyright(workDir: string): Promise<{ cmd: string; args: string[] } | null> {
  // 1. Local node_modules (if installed via npm)
  const localNode = findLocalBin(workDir, "pyright");
  if (localNode) return { cmd: process.execPath, args: [localNode] };

  // 2. Project venv
  const venvCandidates = isWindows
    ? ["venv\\Scripts\\pyright.exe", ".venv\\Scripts\\pyright.exe"]
    : ["venv/bin/pyright", ".venv/bin/pyright"];
  for (const c of venvCandidates) {
    const full = path.join(workDir, c);
    if (fs.existsSync(full)) return { cmd: full, args: [] };
  }

  // 3. Global pyright on PATH
  if (await commandExists(isWindows ? "pyright.cmd" : "pyright")) {
    return { cmd: isWindows ? "pyright.cmd" : "pyright", args: [] };
  }
  return null;
}

/**
 * Run Python type checking. Prefers pyright (fast, structured JSON output);
 * falls back to per-file `python -m py_compile` for syntax-only checks if
 * pyright isn't available.
 */
export async function runPythonCheck(workDir: string): Promise<Diagnostic[]> {
  const pyFiles = findFilesByExt(workDir, new Set([".py"]), 500);
  if (pyFiles.length === 0) return [];

  // Prefer pyright
  const pr = await findPyright(workDir);
  if (pr) {
    const result = await runCommand(
      pr.cmd,
      [...pr.args, "--outputjson", "."],
      workDir,
      120_000,
    );
    try {
      // pyright always exits non-zero when diagnostics exist; that's expected.
      const jsonStart = result.stdout.indexOf("{");
      if (jsonStart < 0) return [];
      const parsed = JSON.parse(result.stdout.slice(jsonStart)) as PyrightOutput;
      const out: Diagnostic[] = [];
      for (const d of parsed.generalDiagnostics || []) {
        let filePath = d.file;
        if (path.isAbsolute(filePath)) filePath = path.relative(workDir, filePath);
        filePath = filePath.replace(/\\/g, "/");
        if (filePath.includes("node_modules/") || filePath.includes("/.venv/") || filePath.includes("/venv/")) continue;
        out.push({
          file: filePath,
          line: d.range.start.line + 1,
          column: d.range.start.character + 1,
          severity: d.severity === "information" ? "info" : d.severity,
          code: d.rule,
          message: d.message.split("\n")[0],
          source: "python",
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  // Fallback: py_compile for syntax errors only
  const py = isWindows ? "python" : "python3";
  if (!(await commandExists(py))) return [];

  const out: Diagnostic[] = [];
  const BATCH = 8;
  for (let i = 0; i < pyFiles.length; i += BATCH) {
    const batch = pyFiles.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((rel) =>
        runCommand(py, ["-m", "py_compile", rel], workDir, 10_000),
      ),
    );
    for (let j = 0; j < batch.length; j++) {
      const res = results[j];
      const rel = batch[j];
      if (res.code === 0) continue;
      const err = res.stderr + res.stdout;
      // Match: File "foo.py", line 5
      const locMatch = err.match(/line (\d+)/);
      const msgMatch = err.match(/(SyntaxError|IndentationError|TabError):\s*(.+)/);
      out.push({
        file: rel,
        line: locMatch ? parseInt(locMatch[1]) : 1,
        column: 1,
        severity: "error",
        code: msgMatch ? msgMatch[1] : "syntax",
        message: msgMatch ? msgMatch[2].trim() : err.trim().split("\n").slice(-1)[0],
        source: "python",
      });
    }
  }
  return out;
}

// ─── Go ──────────────────────────────────────────────────────────

/**
 * Run `go vet ./...` for the project. Outputs are line-based:
 *   path/file.go:12:5: message
 */
export async function runGoCheck(workDir: string): Promise<Diagnostic[]> {
  if (!fileExistsAny(workDir, ["go.mod"])) return [];
  if (!(await commandExists("go"))) return [];

  // `go vet ./...` covers the common bug-detection rules.
  const result = await runCommand("go", ["vet", "./..."], workDir, 120_000);
  const out: Diagnostic[] = [];
  // go vet writes to stderr
  const lines = (result.stderr + "\n" + result.stdout).split(/\r?\n/);
  // Pattern: ./path/file.go:line:col: message
  const re = /^(?:\.\/)?(.+?\.go):(\d+):(\d+):\s*(.+)$/;
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    out.push({
      file: m[1].replace(/\\/g, "/"),
      line: parseInt(m[2]),
      column: parseInt(m[3]),
      severity: "warning",
      message: m[4],
      source: "go",
    });
  }
  return out;
}

// ─── Rust ────────────────────────────────────────────────────────

interface CargoMessage {
  reason: string;
  message?: {
    level: "error" | "warning" | "note" | "help";
    message: string;
    code?: { code: string } | null;
    spans: Array<{
      file_name: string;
      line_start: number;
      column_start: number;
      is_primary: boolean;
    }>;
  };
}

/**
 * Run `cargo check --message-format json` and parse the diagnostic stream.
 * Skips compile if no Cargo.toml at root.
 */
export async function runRustCheck(workDir: string): Promise<Diagnostic[]> {
  if (!fileExistsAny(workDir, ["Cargo.toml"])) return [];
  if (!(await commandExists("cargo"))) return [];

  const result = await runCommand(
    "cargo",
    ["check", "--message-format", "json", "--quiet"],
    workDir,
    300_000,
  );
  const out: Diagnostic[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let msg: CargoMessage;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.reason !== "compiler-message" || !msg.message) continue;
    const m = msg.message;
    if (m.level !== "error" && m.level !== "warning") continue;
    const primary = m.spans.find((s) => s.is_primary) || m.spans[0];
    if (!primary) continue;
    out.push({
      file: primary.file_name.replace(/\\/g, "/"),
      line: primary.line_start,
      column: primary.column_start,
      severity: m.level,
      code: m.code?.code,
      message: m.message,
      source: "rust",
    });
  }
  return out;
}

// ─── PHP ─────────────────────────────────────────────────────────

/** Per-file `php -l` syntax check. */
export async function runPhpCheck(workDir: string): Promise<Diagnostic[]> {
  const phpFiles = findFilesByExt(workDir, new Set([".php"]), 300);
  if (phpFiles.length === 0) return [];
  if (!(await commandExists("php"))) return [];

  const out: Diagnostic[] = [];
  const BATCH = 8;
  for (let i = 0; i < phpFiles.length; i += BATCH) {
    const batch = phpFiles.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((rel) => runCommand("php", ["-l", rel], workDir, 10_000)),
    );
    for (let j = 0; j < batch.length; j++) {
      const res = results[j];
      const rel = batch[j];
      if (res.code === 0) continue;
      // PHP Parse error: ... in foo.php on line 5
      const m = (res.stdout + res.stderr).match(/(?:Parse error|Fatal error):\s*(.+?)\s+in\s+.+?\s+on line\s+(\d+)/i);
      if (!m) continue;
      out.push({
        file: rel,
        line: parseInt(m[2]),
        column: 1,
        severity: "error",
        message: m[1].trim(),
        source: "php",
      });
    }
  }
  return out;
}

// ─── Ruby ────────────────────────────────────────────────────────

/** Per-file `ruby -c` syntax check. */
export async function runRubyCheck(workDir: string): Promise<Diagnostic[]> {
  const rbFiles = findFilesByExt(workDir, new Set([".rb"]), 300);
  if (rbFiles.length === 0) return [];
  if (!(await commandExists("ruby"))) return [];

  const out: Diagnostic[] = [];
  const BATCH = 8;
  for (let i = 0; i < rbFiles.length; i += BATCH) {
    const batch = rbFiles.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((rel) => runCommand("ruby", ["-c", rel], workDir, 10_000)),
    );
    for (let j = 0; j < batch.length; j++) {
      const res = results[j];
      const rel = batch[j];
      if (res.code === 0) continue;
      // ruby -c output: foo.rb:5: syntax error, unexpected ...
      const m = (res.stderr + res.stdout).match(/^(.+?):(\d+):\s*(.+)$/m);
      if (!m) continue;
      out.push({
        file: rel,
        line: parseInt(m[2]),
        column: 1,
        severity: "error",
        message: m[3].trim(),
        source: "ruby",
      });
    }
  }
  return out;
}

// ─── Aggregator ──────────────────────────────────────────────────

export async function runAllChecks(workDir: string): Promise<{
  diagnostics: Diagnostic[];
  ran: {
    typescript: boolean; eslint: boolean; json: boolean; syntax: boolean;
    python: boolean; go: boolean; rust: boolean; php: boolean; ruby: boolean;
  };
  durationMs: number;
}> {
  const start = Date.now();

  const projectHasTsConfig = hasTsConfig(workDir);
  const projectHasJsConfig = hasJsConfig(workDir);
  const localTsc = findLocalBin(workDir, "tsc");
  const localEslint = findLocalBin(workDir, "eslint");
  const projectHasEslint = !!localEslint && hasEslintConfig(workDir);

  // TypeScript: use real tsconfig OR jsconfig if present, otherwise fallback
  // synthesized config (only if there are .ts/.tsx files AND tsc is available)
  const tsCheck = (projectHasTsConfig || projectHasJsConfig)
    ? runTypeScriptCheck(workDir).catch(() => [])
    : (localTsc ? runTypeScriptFallback(workDir).catch(() => []) : Promise.resolve([] as Diagnostic[]));

  // Always run JS syntax check (no config needed)
  const syntaxCheck = runJsSyntaxCheck(workDir).catch(() => []);

  // ESLint: only if installed and configured
  const eslintCheck = projectHasEslint
    ? runEslintCheck(workDir).catch(() => [])
    : Promise.resolve([] as Diagnostic[]);

  // JSON: always
  const jsonCheck = runJsonCheck(workDir).catch(() => []);

  // Other languages — each one early-exits cheaply if not applicable
  const pyCheck   = runPythonCheck(workDir).catch(() => []);
  const goCheck   = runGoCheck(workDir).catch(() => []);
  const rustCheck = runRustCheck(workDir).catch(() => []);
  const phpCheck  = runPhpCheck(workDir).catch(() => []);
  const rubyCheck = runRubyCheck(workDir).catch(() => []);

  const [
    tsDiags, syntaxDiags, eslintDiags, jsonDiags,
    pyDiags, goDiags, rustDiags, phpDiags, rubyDiags,
  ] = await Promise.all([
    tsCheck, syntaxCheck, eslintCheck, jsonCheck,
    pyCheck, goCheck, rustCheck, phpCheck, rubyCheck,
  ]);

  // Dedupe: if a file already has a TS error, don't add a syntax error for it
  // (TS errors are more informative)
  const filesWithTsErrors = new Set(tsDiags.map((d) => d.file));
  const filteredSyntax = syntaxDiags.filter((d) => !filesWithTsErrors.has(d.file));

  const all = [
    ...tsDiags, ...filteredSyntax, ...eslintDiags, ...jsonDiags,
    ...pyDiags, ...goDiags, ...rustDiags, ...phpDiags, ...rubyDiags,
  ];

  return {
    diagnostics: all,
    ran: {
      typescript: projectHasTsConfig || projectHasJsConfig || (!!localTsc && tsDiags.length > 0),
      eslint: projectHasEslint,
      json: true,
      syntax: true,
      python: pyDiags.length > 0 || findFilesByExt(workDir, new Set([".py"]), 1).length > 0,
      go: fileExistsAny(workDir, ["go.mod"]),
      rust: fileExistsAny(workDir, ["Cargo.toml"]),
      php: findFilesByExt(workDir, new Set([".php"]), 1).length > 0,
      ruby: findFilesByExt(workDir, new Set([".rb"]), 1).length > 0,
    },
    durationMs: Date.now() - start,
  };
}
