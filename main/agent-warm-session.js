// PiPilot IDE — Long-lived workspace-scoped agent session.
//
// Why this exists:
//   The Claude Agent SDK's `query()` is an async generator that owns one
//   CLI subprocess. The naive call-per-message pattern pays a ~12 s cold
//   start on every single message because the subprocess dies as soon as
//   the generator finishes. Tracked upstream as anthropic/claude-agent-sdk#34.
//
// The fix (this module):
//   Pass an async generator as the prompt and never let it return until
//   close() is called. The generator parks on `await` between user turns,
//   so the subprocess stays warm. A per-workspace WorkspaceAgentSession
//   instance handles inbox/waiter coordination.
//
// Step 1 only — pure primitive, no IPC wiring. The existing cold-spawn
// `agent:send` handler is untouched. Step 2 will wire chat through this;
// step 3 will add a 1-deep idle pool for missions so they stop paying
// the cold start cost in the user's critical path either.

const path = require('node:path');
const { loadSdk, resolveAgentRuntime } = require('./sdk-loader');

class WorkspaceAgentSession {
  /**
   * @param {string} workspaceDir  Project root passed to query() as cwd.
   * @param {object} options       Session-scoped options. These are FROZEN
   *                               at start() time — changing model/MCP
   *                               servers/system prompt after start
   *                               requires close() + new instance. Use
   *                               setModel()/setPermissionMode() for the
   *                               two things the SDK lets us mutate live.
   */
  constructor(workspaceDir, options = {}) {
    if (!workspaceDir) throw new Error('workspaceDir is required');
    this.workspaceDir = workspaceDir;
    this.options = options;

    /** @type {Array<object>} queued user messages waiting for the generator. */
    this._inbox = [];
    /** @type {((msg: object|null) => void) | null} */
    this._waiter = null;
    /** Has close() been called or the SDK stream errored out? */
    this.closed = false;
    /** Active SDK Query handle once start() succeeds. */
    this.q = null;
    /** Captured from the SDK's `system/init` message. Use for resume. */
    this.sessionId = options.resume || undefined;
    /** Last error from the SDK stream pump, if any. */
    this.lastError = null;
    /** Resolves once start() has booted the SDK and the pump is running. */
    this.ready = null;
  }

  /**
   * Boot the long-lived SDK process. Resolves once the SDK is consuming
   * input — does NOT wait for any actual model output. onMessage is fired
   * for every SDKMessage the SDK emits (system, assistant, user-tool-result,
   * stream_event, result, error, etc.).
   *
   * @param {(msg: object) => void} onMessage
   */
  async start(onMessage) {
    if (this.q) throw new Error('session already started');
    if (typeof onMessage !== 'function') throw new Error('onMessage is required');

    const sdk = await loadSdk();
    const runtime = resolveAgentRuntime();
    const inputStream = this._makeInputStream();

    // Build the options the SDK expects. Spread caller options FIRST,
    // then overlay our runtime-critical fields so they can never be
    // clobbered. The previous order had `...this.options` last, which
    // wiped out env (losing ELECTRON_RUN_AS_NODE=1) and made the
    // spawned CLI subprocess hang trying to launch as a GUI Electron
    // app instead of running as Node.
    const sdkOptions = {
      ...this.options,
      cwd: this.workspaceDir,
      permissionMode: this.options.permissionMode || 'bypassPermissions',
      includePartialMessages: this.options.includePartialMessages !== false,
      // Production runtime — Electron's binary as Node, asar.unpacked cli.js.
      executable: runtime.executable,
      executableArgs: runtime.executableArgs,
      pathToClaudeCodeExecutable: runtime.pathToClaudeCodeExecutable,
      env: { ...runtime.extraEnv, ...(this.options.env || {}) },
      // Resume a prior conversation if the caller saved a sessionId.
      // SDK rehydrates message history from ~/.claude/projects/. We
      // keep this AFTER the spread so the explicit value wins.
      resume: this.options.resume || undefined,
    };

    this.q = sdk.query({ prompt: inputStream, options: sdkOptions });

    // Drain output in the background. We don't await this — start()
    // returns as soon as the query handle exists; messages flow async.
    this.ready = (async () => {
      try {
        for await (const msg of this.q) {
          // Capture session_id the first time the SDK hands it to us so
          // we can persist it for next IDE launch.
          if (msg && msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
            this.sessionId = msg.session_id;
          }
          try { onMessage(msg); } catch (handlerErr) {
            console.error('[warm-session] onMessage handler threw:', handlerErr);
          }
        }
      } catch (err) {
        this.lastError = err;
        console.error('[warm-session] stream error:', err);
        try { onMessage({ type: 'error', error: String(err && err.message || err) }); } catch {}
      } finally {
        // The SDK stream ended — either close() was called or the CLI
        // died. Either way, mark closed so future send() calls fail
        // loudly instead of silently queuing forever.
        this.closed = true;
        if (this._waiter) {
          const w = this._waiter; this._waiter = null;
          try { w(null); } catch {}
        }
      }
    })();
  }

  /**
   * Push a user message into the running session. Returns synchronously —
   * the model's response arrives via onMessage callbacks. Throws if the
   * session was never started or has already closed.
   *
   * @param {string} text
   */
  send(text) {
    if (!this.q) throw new Error('session not started — call start() first');
    if (this.closed) throw new Error('session closed');
    const msg = {
      type: 'user',
      session_id: this.sessionId || '',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [{ type: 'text', text: String(text || '') }],
      },
    };
    if (this._waiter) {
      // Generator is parked on the await — wake it directly without
      // touching the inbox.
      const w = this._waiter; this._waiter = null;
      w(msg);
    } else {
      // Generator hasn't reached the await yet (or is busy). Queue and
      // it'll drain on its next pass.
      this._inbox.push(msg);
    }
  }

  /** Cancel the current turn (model response). Subprocess stays warm. */
  async interrupt() {
    if (this.q && typeof this.q.interrupt === 'function') {
      try { await this.q.interrupt(); } catch (err) {
        console.warn('[warm-session] interrupt failed:', err.message);
      }
    }
  }

  /** Switch model mid-session (no restart). */
  async setModel(model) {
    if (this.q && typeof this.q.setModel === 'function' && model) {
      try { await this.q.setModel(model); } catch (err) {
        console.warn('[warm-session] setModel failed:', err.message);
      }
    }
  }

  /** Switch permission mode mid-session (plan / acceptEdits / etc.). */
  async setPermissionMode(mode) {
    if (this.q && typeof this.q.setPermissionMode === 'function' && mode) {
      try { await this.q.setPermissionMode(mode); } catch (err) {
        console.warn('[warm-session] setPermissionMode failed:', err.message);
      }
    }
  }

  /** Tear down the session — kills the CLI subprocess. */
  async close() {
    if (this.closed && !this.q) return;
    this.closed = true;
    // Wake the input generator so it exits its while-loop cleanly.
    if (this._waiter) {
      const w = this._waiter; this._waiter = null;
      try { w(null); } catch {}
    }
    if (this.q && typeof this.q.close === 'function') {
      try { await this.q.close(); } catch (err) {
        console.warn('[warm-session] close failed:', err.message);
      }
    }
    // Wait for the pump to finish so the caller knows the subprocess is
    // actually gone before they (e.g.) re-open the workspace.
    try { if (this.ready) await this.ready; } catch {}
  }

  /**
   * The async generator the SDK consumes as `prompt`. Lifetime = session
   * lifetime. Drains inbox eagerly, then parks on a Promise the next
   * send() will resolve. Returning ends the SDK stream and the CLI
   * subprocess shuts down — that only happens via close() (which calls
   * the waiter with null) or the closed flag flipping.
   */
  async *_makeInputStream() {
    while (!this.closed) {
      if (this._inbox.length > 0) {
        yield this._inbox.shift();
        continue;
      }
      const next = await new Promise((resolve) => { this._waiter = resolve; });
      if (next === null) return; // close() signalled end-of-stream
      yield next;
    }
  }
}

module.exports = { WorkspaceAgentSession };
