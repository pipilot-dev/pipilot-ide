// PiPilot IDE — Search index IPC handlers
// Manages index lifecycle: start on project open, progress to renderer, live updates from watcher

const { getSearchIndex, handleFileChange } = require('./mcp-ide-tools');

module.exports = function register(ipcMain, ctx) {

  // Start indexing a project (called when project opens)
  ipcMain.handle('search-index:start', async (_e, { projectPath }) => {
    if (!projectPath) return { ok: false, error: 'projectPath required' };

    const index = getSearchIndex(projectPath);
    const win = ctx.getWindow?.();

    // Wire progress events to renderer
    index._onProgress = (progress) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('search-index:progress', progress);
      }
    };

    // Don't await — run in background so it doesn't block the UI
    index.indexProject().catch((err) => {
      console.error('[search-index] indexProject failed:', err);
    });

    return { ok: true };
  });

  // Get current index stats
  ipcMain.handle('search-index:stats', async (_e, { projectPath }) => {
    if (!projectPath) return { ok: false };
    const index = getSearchIndex(projectPath);
    return { ok: true, ...index.getStats() };
  });

  // Handle file change from watcher (called from renderer via bus → IPC)
  ipcMain.handle('search-index:file-changed', async (_e, { projectPath, evt }) => {
    handleFileChange(projectPath, evt);
    return { ok: true };
  });
};
