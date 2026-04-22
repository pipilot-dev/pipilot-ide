// PiPilot IDE — Speech recognition IPC handler
// Primary: Groq Whisper API (excellent quality, fast)
// Fallback: Cloudflare Workers AI Whisper (generous free tier, 720 req/min)
// Last resort: Windows native System.Speech (offline, lower quality)

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';

// ── Helper: build multipart body for Whisper APIs ──
function buildMultipart(fileData, fileName, extraFields) {
  const boundary = '----PiPilotSpeech' + Date.now();
  const parts = [];
  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: audio/webm\r\n\r\n`
  );
  parts.push(fileData);
  parts.push('\r\n');
  for (const [key, value] of Object.entries(extraFields || {})) {
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
      `${value}\r\n`
    );
  }
  parts.push(`--${boundary}--\r\n`);
  const body = Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p));
  return { body, boundary };
}

// ── Groq Whisper ──
async function transcribeGroq(audioBuffer) {
  const tmpFile = path.join(os.tmpdir(), `pipilot-speech-${Date.now()}.webm`);
  fs.writeFileSync(tmpFile, audioBuffer);
  try {
    const fileData = fs.readFileSync(tmpFile);
    const { body, boundary } = buildMultipart(fileData, 'audio.webm', {
      model: 'whisper-large-v3-turbo',
      language: 'en',
    });
    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Groq ${resp.status}: ${errText.slice(0, 200)}`);
    }
    const result = await resp.json();
    return result.text || '';
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ── Cloudflare Workers AI Whisper ──
async function transcribeCloudflare(audioBuffer) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/openai/whisper`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/octet-stream',
    },
    body: audioBuffer,
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Cloudflare ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const result = await resp.json();
  // CF returns { result: { text: "..." }, success: true }
  return result?.result?.text || result?.text || '';
}

// ── Unified transcribe: try Groq → Cloudflare → error ──
async function transcribe(audioBuffer) {
  if (GROQ_API_KEY) {
    try { return await transcribeGroq(audioBuffer); } catch (err) {
      console.warn('[speech] Groq failed, trying Cloudflare:', err.message);
    }
  }
  if (CF_ACCOUNT_ID && CF_API_TOKEN) {
    return await transcribeCloudflare(audioBuffer);
  }
  if (GROQ_API_KEY) {
    // Groq was configured but failed, re-throw
    return await transcribeGroq(audioBuffer);
  }
  throw new Error('No speech API configured. Set GROQ_API_KEY or CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN in .env');
}

// ── Windows native fallback (System.Speech) ──
const PS_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$engine.SetInputToDefaultAudioDevice()
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$engine.LoadGrammar($grammar)
Register-ObjectEvent $engine SpeechRecognized -Action {
  [Console]::WriteLine("FINAL:" + $Event.SourceEventArgs.Result.Text)
  [Console]::Out.Flush()
} | Out-Null
Register-ObjectEvent $engine SpeechHypothesized -Action {
  [Console]::WriteLine("INTERIM:" + $Event.SourceEventArgs.Result.Text)
  [Console]::Out.Flush()
} | Out-Null
$engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
[Console]::WriteLine("STARTED:")
[Console]::Out.Flush()
try { while ($true) { Start-Sleep -Milliseconds 200 } } catch {}
$engine.RecognizeAsyncCancel()
$engine.Dispose()
`;

module.exports = function register(ipcMain, ctx) {
  let nativeProc = null;

  ipcMain.handle('speech:info', () => {
    const hasApi = !!(GROQ_API_KEY || (CF_ACCOUNT_ID && CF_API_TOKEN));
    return { groq: !!GROQ_API_KEY, cloudflare: !!(CF_ACCOUNT_ID && CF_API_TOKEN), api: hasApi, native: process.platform === 'win32' };
  });

  // ── Whisper transcription (Groq → Cloudflare fallback) ──
  ipcMain.handle('speech:transcribe', async (_e, { audio }) => {
    try {
      const buf = Buffer.from(audio, 'base64');
      const text = await transcribe(buf);
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ── Native streaming: Windows System.Speech ──
  ipcMain.handle('speech:start-native', async () => {
    if (nativeProc) return { ok: true, already: true };
    if (process.platform !== 'win32') return { ok: false, error: 'Native speech only on Windows' };
    const win = ctx.getWindow?.();
    if (!win || win.isDestroyed()) return { ok: false, error: 'No window' };

    try {
      nativeProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      });
      let buffer = '';
      nativeProc.stdout.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('FINAL:')) {
            win.webContents.send('speech:result', { type: 'final', text: line.slice(6) });
          } else if (line.startsWith('INTERIM:')) {
            win.webContents.send('speech:result', { type: 'interim', text: line.slice(8) });
          }
        }
      });
      nativeProc.on('close', () => {
        nativeProc = null;
        if (win && !win.isDestroyed()) win.webContents.send('speech:result', { type: 'ended' });
      });
      nativeProc.on('error', (err) => {
        nativeProc = null;
        if (win && !win.isDestroyed()) win.webContents.send('speech:result', { type: 'error', text: err.message });
      });
      return { ok: true };
    } catch (err) {
      nativeProc = null;
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('speech:stop-native', async () => {
    if (!nativeProc) return { ok: true };
    try { nativeProc.stdin.end(); nativeProc.kill(); } catch {}
    nativeProc = null;
    return { ok: true };
  });
};
