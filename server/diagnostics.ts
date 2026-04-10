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
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);

export interface Diagnostic {
  file: string;       // workspace-relative path
  line: number;       // 1-indexed
  column: number;     // 1-indexed
  severity: "error" | "warning" | "info";
  code?: string;      // e.g. "TS2304" or "no-unused-vars"
  message: string;
  source: "typescript" | "eslint" | "json" | "syntax";
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

// ─── TypeScript ──────────────────────────────────────────────────

/**
 * Parse `tsc --pretty false` output. Lines look like:
 *   src/foo.ts(10,5): error TS2304: Cannot find name 'foo'.
 *   src/foo.ts:10:5 - error TS2304: Cannot find name 'foo'.
 * Continuation/context lines are ignored for now.
 */
function parseTscOutput(output: string, workDir: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split(/\r?\n/);

  // Format A: file.ts(line,col): error TSxxxx: message
  const reA = /^(.+?)\((\d+),(\d+)\):\s+(error|warning|info)\s+(TS\d+):\s+(.+)$/;
  // Format B: file.ts:line:col - error TSxxxx: message (with --pretty true)
  const reB = /^(.+?):(\d+):(\d+)\s+-\s+(error|warning|info)\s+(TS\d+):\s+(.+)$/;

  for (const line of lines) {
    let match = line.match(reA) || line.match(reB);
    if (!match) continue;

    let [, filePath, lineNum, colNum, severity, code, message] = match;

    // Normalize path: relative to workDir, forward slashes
    if (path.isAbsolute(filePath)) {
      filePath = path.relative(workDir, filePath);
    }
    filePath = filePath.replace(/\\/g, "/");

    diagnostics.push({
      file: filePath,
      line: parseInt(lineNum) || 1,
      column: parseInt(colNum) || 1,
      severity: (severity as Diagnostic["severity"]) || "error",
      code,
      message: message.trim(),
      source: "typescript",
    });
  }

  return diagnostics;
}

/** Detect if the project has a tsconfig.json (root or any sub-project) */
function hasTsConfig(workDir: string): boolean {
  return fs.existsSync(path.join(workDir, "tsconfig.json"));
}

/** Run tsc --noEmit on the workspace */
export async function runTypeScriptCheck(workDir: string): Promise<Diagnostic[]> {
  // Strategy:
  // 1. If a local tsc exists in node_modules/.bin, use it
  // 2. Otherwise try `npx tsc` (slow first time, then cached)
  // 3. If no tsconfig, infer one quickly with --allowJs and check the workspace
  if (!hasTsConfig(workDir)) {
    return [];
  }

  const localTsc = findLocalBin(workDir, "tsc");
  let result;
  if (localTsc) {
    // Run via node directly to keep PTY clean and exit codes accurate
    result = await runCommand(
      process.execPath,
      [localTsc, "--noEmit", "--pretty", "false"],
      workDir,
      120000,
    );
  } else {
    // Fallback to npx (may need to download if not cached)
    result = await runCommand(
      isWindows ? "npx.cmd" : "npx",
      ["tsc", "--noEmit", "--pretty", "false"],
      workDir,
      120000,
    );
  }

  // tsc exits non-zero when there are errors, but we still want to parse
  return parseTscOutput(result.stdout + "\n" + result.stderr, workDir);
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

// ─── Aggregator ──────────────────────────────────────────────────

export async function runAllChecks(workDir: string): Promise<{
  diagnostics: Diagnostic[];
  ran: { typescript: boolean; eslint: boolean; json: boolean };
  durationMs: number;
}> {
  const start = Date.now();
  const ran = {
    typescript: hasTsConfig(workDir),
    eslint: !!findLocalBin(workDir, "eslint") && hasEslintConfig(workDir),
    json: true,
  };

  const [tsDiags, eslintDiags, jsonDiags] = await Promise.all([
    ran.typescript ? runTypeScriptCheck(workDir).catch(() => []) : Promise.resolve([]),
    ran.eslint ? runEslintCheck(workDir).catch(() => []) : Promise.resolve([]),
    runJsonCheck(workDir).catch(() => []),
  ]);

  const all = [...tsDiags, ...eslintDiags, ...jsonDiags];
  return { diagnostics: all, ran, durationMs: Date.now() - start };
}
