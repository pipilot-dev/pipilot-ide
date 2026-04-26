// PiPilot IDE — Resumption Diary
//
// Writes a 2-3 sentence "what was I doing" log entry to
// `<projectPath>/.pipilot/diary.md` whenever a meaningful session ends.
// The entry is the source of truth for the Yesterday Card on the
// welcome tab, the Dormant Project Whisper, and the mobile companion's
// "what's running" view.
//
// Triggers a write on:
//   • Project close (renderer emits 'diary:write' with the session info).
//   • Idle timeout (no agent activity for 30 min).
//   • App quit (best-effort, fast write).
//
// Each entry is a single fenced block in `diary.md`:
//
//   ## 2026-04-26 21:47
//   Worked on `bin/codepilot.js`. Got the Ink TUI rendering but stuck
//   on Ctrl+C handling. Last test run: 8/11 passed.
//   <!-- meta: branch=main, files=3, agent_turns=4 -->

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

module.exports = function register(ipcMain) {
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtTime(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function writeEntry(projectPath, entry) {
    if (!projectPath || !entry) return { ok: false, error: 'projectPath + entry required' };
    const dir = path.join(projectPath, '.pipilot');
    const file = path.join(dir, 'diary.md');
    try { await fsp.mkdir(dir, { recursive: true }); } catch {}
    const ts = entry.at || Date.now();
    const meta = entry.meta && Object.keys(entry.meta).length
      ? `\n<!-- meta: ${Object.entries(entry.meta).map(([k, v]) => `${k}=${v}`).join(', ')} -->`
      : '';
    const summary = String(entry.summary || '').trim() || '(no summary)';
    const block = `\n## ${fmtTime(ts)}\n${summary}${meta}\n`;
    try {
      let existing = '';
      try { existing = await fsp.readFile(file, 'utf8'); } catch {}
      // Cap diary size — keep most recent ~100 entries.
      const entries = existing.split(/(?=^## \d{4}-\d{2}-\d{2} )/m).filter(Boolean);
      if (entries.length > 99) entries.splice(0, entries.length - 99);
      const header = entries.length ? '' : '# Project Diary\n\nAutomatic resumption notes written by PiPilot.\n';
      await fsp.writeFile(file, header + entries.join('') + block, 'utf8');
      return { ok: true, file };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // Read the most recent N entries for the Yesterday Card.
  async function readRecent(projectPath, limit = 5) {
    if (!projectPath) return { ok: true, entries: [] };
    const file = path.join(projectPath, '.pipilot', 'diary.md');
    try {
      const raw = await fsp.readFile(file, 'utf8');
      const blocks = raw.split(/(?=^## \d{4}-\d{2}-\d{2} )/m).filter(b => b.startsWith('## '));
      const recent = blocks.slice(-limit).reverse().map(parseEntry).filter(Boolean);
      return { ok: true, entries: recent };
    } catch {
      return { ok: true, entries: [] };
    }
  }

  function parseEntry(block) {
    const m = block.match(/^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2})\n([\s\S]*?)(?:\n<!-- meta: (.*?) -->)?\s*$/);
    if (!m) return null;
    const meta = {};
    if (m[3]) {
      for (const part of m[3].split(',')) {
        const [k, v] = part.split('=').map(s => s.trim());
        if (k) meta[k] = v;
      }
    }
    return { time: m[1], summary: m[2].trim(), meta };
  }

  ipcMain.handle('diary:write', async (_e, { projectPath, entry } = {}) => writeEntry(projectPath, entry));
  ipcMain.handle('diary:read', async (_e, { projectPath, limit } = {}) => readRecent(projectPath, limit || 5));
};
