import { getNodebox, syncFilesToNodebox } from "./nodebox";

/**
 * Run a JavaScript/Node.js script in the Nodebox runtime.
 *
 * Strategy: Write the script as a project file via fs.init(),
 * then run it with a relative path. Nodebox resolves modules
 * relative to its internal root, so absolute paths don't work.
 */

const DEFAULT_TIMEOUT = 3000; // 3 seconds default

export interface RunScriptResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

export async function runScript(
  code: string,
  projectId: string,
  options?: { filename?: string; syncFiles?: boolean; timeout?: number }
): Promise<RunScriptResult> {
  const filename = options?.filename || `_run_${Date.now()}.js`;
  const timeoutMs = (options?.timeout ?? 3) * 1000; // seconds → ms
  const idleMs = Math.min(timeoutMs, 2000); // idle cutoff: 2s or timeout, whichever is shorter

  try {
    const nodebox = await getNodebox();

    // Sync project files so the script can import them
    if (options?.syncFiles !== false) {
      await syncFilesToNodebox(nodebox, projectId);
    }

    // Write the script into the filesystem using fs.init
    // which merges into the existing FS. Use a simple .js file (not .mjs)
    // to avoid module resolution issues.
    await nodebox.fs.init({
      [filename]: code,
    });

    // Create a shell and run it
    const shell = nodebox.shell.create();

    let stdout = "";
    let stderr = "";

    shell.stdout.on("data", (data: string) => {
      stdout += typeof data === "string" ? data : String(data);
    });

    shell.stderr.on("data", (data: string) => {
      stderr += typeof data === "string" ? data : String(data);
    });

    // Track exit and last output time
    let exitCode = 0;
    let exitError: string | undefined;
    let exited = false;
    let lastOutputTime = Date.now();

    shell.on("exit", (code: number, error?: { message: string }) => {
      exited = true;
      exitCode = code;
      if (error) exitError = error.message;
    });

    // Track when output last arrived
    const origStdout = shell.stdout.on.bind(shell.stdout);
    shell.stdout.on("data", () => { lastOutputTime = Date.now(); });
    shell.stderr.on("data", () => { lastOutputTime = Date.now(); });

    await shell.runCommand("node", [filename]);

    // Wait for the script to finish:
    // - If "exit" fires, we're done immediately
    // - If no output for 2 seconds after last output, assume done
    // - Hard timeout at SCRIPT_TIMEOUT
    await new Promise<void>((resolve) => {
      if (exited) { resolve(); return; }

      const IDLE_TIMEOUT = idleMs;
      const check = setInterval(() => {
        if (exited) {
          clearInterval(check);
          resolve();
          return;
        }
        // If we got some output and it's been idle, assume done
        if (stdout.length > 0 || stderr.length > 0) {
          if (Date.now() - lastOutputTime > IDLE_TIMEOUT) {
            clearInterval(check);
            try { shell.kill(); } catch {}
            resolve();
            return;
          }
        }
      }, 200);

      // Hard timeout
      setTimeout(() => {
        clearInterval(check);
        if (!exited) {
          try { shell.kill(); } catch {}
          exitError = exitError || `Script timed out after ${timeoutMs / 1000}s`;
          exitCode = -1;
        }
        resolve();
      }, timeoutMs);
    });

    // Clean up temp script
    try {
      await nodebox.fs.rm("/" + filename);
    } catch {}

    const result: RunScriptResult = {
      success: exitCode === 0,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode,
    };

    if (exitError) {
      result.error = exitError;
    }

    return result;
  } catch (err: any) {
    return {
      success: false,
      stdout: "",
      stderr: "",
      exitCode: -1,
      error: `Failed to run script: ${err?.message || String(err)}`,
    };
  }
}
