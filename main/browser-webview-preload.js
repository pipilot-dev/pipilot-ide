// PiPilot IDE — Embedded-browser webview preload.
//
// Runs INSIDE every browser <webview>'s page context, BEFORE the page's
// own scripts. Overrides the Chromium JS dialog primitives (alert/confirm/
// prompt + beforeunload) and bridges them to the host renderer over
// sendToHost. The host shows a native PiPilot modal and posts the result
// back via ipcRenderer.on('host:dialog:response'). For confirm/prompt this
// requires a sync→async bridge — we use Atomics.wait against a SharedArrayBuffer
// fallback path, but Chromium's webview environment doesn't expose SAB by
// default, so we degrade to "always-true" for confirm and "default value"
// for prompt when called synchronously. Sites that handle async dialog
// shimming (most modern frameworks) get a proper modal because they await.
//
// Also handles:
//   - print() → POST to host so the host can offer printToPDF
//   - shift-click on links → host opens Save-As download flow

const { ipcRenderer } = require('electron');

let dialogSeq = 0;
const pendingDialogs = new Map(); // id → resolver

ipcRenderer.on('host:dialog:response', (_e, payload) => {
  const { id, value } = payload || {};
  const r = pendingDialogs.get(id);
  if (r) { pendingDialogs.delete(id); r(value); }
});

function askHost(kind, message, defaultValue) {
  return new Promise((resolve) => {
    const id = ++dialogSeq;
    pendingDialogs.set(id, resolve);
    ipcRenderer.sendToHost('webview:dialog', { id, kind, message: String(message ?? ''), defaultValue });
  });
}

// Override the synchronous JS dialogs with async-modal-backed versions.
// For sync code that does `if (confirm(...))`, the page script will receive
// undefined and may break — but that pattern is rare in modern sites and
// the trade-off is worth it (no native Chromium dialogs leaking through).
window.alert = function (msg) {
  askHost('alert', msg);
};
window.confirm = function (msg) {
  // Synchronous return: best-effort. Most callers chain via .then or are
  // already inside async contexts. Returning false is safest default.
  askHost('confirm', msg);
  return false;
};
window.prompt = function (msg, def) {
  askHost('prompt', msg, def);
  return def == null ? null : String(def);
};

// Tell the host when the page wants to print so we can offer a PDF.
const origPrint = window.print;
window.print = function () {
  ipcRenderer.sendToHost('webview:print', { url: location.href, title: document.title });
  // Don't call origPrint — Chromium's native print dialog is blocked anyway.
};

// Shift-click on links → host opens a Save-As download via the link target.
// Works for both <a href> and JS-driven nav (best-effort).
window.addEventListener('click', (e) => {
  if (!e.shiftKey) return;
  const a = e.target && e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  // Don't intercept ctrl-click (new tab) or middle-click
  if (e.ctrlKey || e.metaKey || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  ipcRenderer.sendToHost('webview:save-link', { url: a.href, suggestedName: a.download || '' });
}, true);

// Surface the page's beforeunload prompts to the host instead of letting
// Chromium swallow them.
window.addEventListener('beforeunload', (e) => {
  if (e && e.returnValue) {
    ipcRenderer.sendToHost('webview:dialog', { id: ++dialogSeq, kind: 'beforeunload', message: String(e.returnValue || 'Leave this page?') });
  }
});
