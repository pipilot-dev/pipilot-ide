// PiPilot IDE — Search index worker (runs in a separate Node.js process)
// Spawned by the main process via child_process.fork()
// Communicates via process.send() / process.on('message')

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

const MAX_FILE_SIZE = 500 * 1024;
const MAX_CHUNK_LINES = 50;
const INDEX_VERSION = 2;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.cache', 'dist', 'build',
  '.vite', '.pipilot', '__pycache__', 'coverage', '.claude',
  '.svn', '.hg', 'vendor', 'target', 'out', '.turbo',
  '.vercel', '.netlify', '.parcel-cache', 'bower_components',
]);

const INDEXABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
  '.css', '.scss', '.less', '.html', '.svelte', '.vue',
  '.md', '.yaml', '.yml', '.toml', '.sh', '.bash',
  '.rb', '.php', '.swift', '.kt', '.dart', '.lua',
]);

const INDEXABLE_JSON = new Set([
  'package.json', 'tsconfig.json', 'deno.json', 'composer.json',
  'Cargo.toml', 'pyproject.toml', 'go.mod',
]);

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'as', 'or', 'and', 'but', 'not',
  'no', 'so', 'if', 'then', 'than', 'too', 'very', 'just', 'about',
  'up', 'out', 'it', 'its', 'my', 'we', 'he', 'she', 'they', 'them',
  'that', 'this', 'these', 'those', 'what', 'which', 'who', 'whom',
  'how', 'when', 'where', 'why', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own',
  'const', 'let', 'var', 'function', 'return', 'import', 'from',
  'export', 'default', 'require', 'module', 'class', 'extends',
  'implements', 'interface', 'type', 'enum', 'async', 'await',
  'try', 'catch', 'throw', 'finally', 'new', 'delete', 'typeof',
  'instanceof', 'void', 'null', 'undefined', 'true', 'false',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
  'continue', 'yield', 'super', 'this', 'self', 'def', 'fn',
  'pub', 'mut', 'struct', 'impl', 'trait', 'use', 'mod', 'crate',
  'package', 'func', 'go', 'defer', 'chan', 'select', 'range',
  'print', 'println', 'fmt', 'string', 'int', 'float', 'bool',
  'none', 'pass', 'lambda', 'raise', 'except', 'with',
]);

const DEFINITION_RE = /^\s*(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var)\s+\w/;
const PY_DEF_RE = /^\s*(def|class|async\s+def)\s+\w/;
const GO_DEF_RE = /^\s*(func|type)\s+\w/;
const RUST_DEF_RE = /^\s*(pub\s+)?(fn|struct|enum|impl|trait|mod)\s+\w/;
const GENERAL_DEF_RE = /^\s*(public|private|protected|static)\s+/;

function tokenize(text) {
  let cleaned = text.replace(/[^a-zA-Z0-9_]/g, ' ');
  cleaned = cleaned.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const raw = cleaned.split(/[_\s]+/);
  const tokens = [];
  for (const t of raw) {
    const lower = t.toLowerCase();
    if (lower.length >= 2 && !STOP_WORDS.has(lower)) tokens.push(lower);
  }
  return tokens;
}

function buildTermFreqs(tokens) {
  const freqs = {};
  for (const t of tokens) freqs[t] = (freqs[t] || 0) + 1;
  return freqs;
}

function isDefinitionLine(line) {
  return DEFINITION_RE.test(line) || PY_DEF_RE.test(line) || GO_DEF_RE.test(line) || RUST_DEF_RE.test(line) || GENERAL_DEF_RE.test(line);
}

function chunkFile(content) {
  const lines = content.split('\n');
  const chunks = [];
  let chunkStart = 0;
  let blankCount = 0;
  function flush(end) {
    if (end <= chunkStart) return;
    const text = lines.slice(chunkStart, end).join('\n');
    if (text.trim().length > 0) chunks.push({ startLine: chunkStart + 1, endLine: end, content: text });
    chunkStart = end;
    blankCount = 0;
  }
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '') { blankCount++; if (blankCount >= 2 && i - chunkStart > 1) flush(i - 1); continue; }
    blankCount = 0;
    if (i > chunkStart && isDefinitionLine(lines[i])) flush(i);
    if (i - chunkStart >= MAX_CHUNK_LINES) {
      let splitAt = -1;
      for (let j = i; j > i - 10 && j > chunkStart; j--) { if (lines[j].trim() === '') { splitAt = j; break; } }
      flush(splitAt > chunkStart ? splitAt : i);
    }
  }
  flush(lines.length);
  return chunks;
}

function shouldIndex(filePath) {
  const parts = filePath.replace(/\\/g, '/').split('/');
  for (const p of parts) {
    if (SKIP_DIRS.has(p)) return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);
  if (ext === '.json') return INDEXABLE_JSON.has(base);
  return INDEXABLE_EXTENSIONS.has(ext);
}

function isBinary(buf) {
  const check = buf.subarray(0, Math.min(8192, buf.length));
  for (let i = 0; i < check.length; i++) { if (check[i] === 0) return true; }
  return false;
}

function walkDirSync(dir, basePath) {
  const files = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      files.push(...walkDirSync(path.join(dir, entry.name), basePath ? `${basePath}/${entry.name}` : entry.name));
    } else if (entry.isFile()) {
      const rel = basePath ? `${basePath}/${entry.name}` : entry.name;
      if (shouldIndex(rel)) files.push(rel);
    }
  }
  return files;
}

function fileHashSync(absPath) {
  try {
    const stat = fs.statSync(absPath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch { return null; }
}

function indexPath(workDir) {
  return path.join(workDir, '.pipilot', 'search-index.json');
}

function loadIndex(workDir) {
  try {
    const raw = fs.readFileSync(indexPath(workDir), 'utf8');
    const data = JSON.parse(raw);
    if (data.version !== INDEX_VERSION || data.workDir !== workDir) return null;
    return data;
  } catch { return null; }
}

function saveIndex(workDir, data) {
  try {
    fs.mkdirSync(path.join(workDir, '.pipilot'), { recursive: true });
    fs.writeFileSync(indexPath(workDir), JSON.stringify(data), 'utf8');
  } catch (err) {
    process.send({ type: 'error', message: 'Failed to save index: ' + err.message });
  }
}

// ── Main indexing logic ──
function doIndex(workDir) {
  const existing = loadIndex(workDir);
  const allFiles = walkDirSync(workDir, '');
  const currentFiles = new Set(allFiles);
  const total = allFiles.length;

  // Data structures
  const documents = {};       // docId -> { file, startLine, endLine, content, termFreqs, length }
  const invertedIndex = Object.create(null);   // term -> [docId, ...] (no prototype pollution)
  const fileHashes = {};      // rel -> hash
  const fileToDocIds = {};    // rel -> [docId, ...]

  // If we have an existing index, load it and do incremental
  let existingHashes = {};
  let reused = 0;
  if (existing) {
    existingHashes = existing.fileHashes || {};
    // Copy unchanged files from existing index
    for (const rel of allFiles) {
      const abs = path.join(workDir, rel);
      const currentHash = fileHashSync(abs);
      const storedHash = existingHashes[rel];
      if (currentHash && currentHash === storedHash && existing.fileToDocIds[rel]) {
        // Reuse existing data
        fileHashes[rel] = currentHash;
        fileToDocIds[rel] = existing.fileToDocIds[rel];
        for (const docId of existing.fileToDocIds[rel]) {
          if (existing.documents[docId]) {
            documents[docId] = existing.documents[docId];
          }
        }
        reused++;
      }
    }
  }

  // Index new/changed files
  let processed = 0;
  for (let i = 0; i < allFiles.length; i++) {
    const rel = allFiles[i];
    if (fileHashes[rel]) { processed++; continue; } // already reused

    const abs = path.join(workDir, rel);
    try {
      const stat = fs.statSync(abs);
      if (stat.size > MAX_FILE_SIZE || stat.size === 0) { processed++; continue; }
      const buf = fs.readFileSync(abs);
      if (isBinary(buf)) { processed++; continue; }
      const content = buf.toString('utf8');
      const chunks = chunkFile(content);
      const docIds = [];
      for (const chunk of chunks) {
        const tokens = tokenize(chunk.content);
        if (tokens.length < 2) continue;
        const docId = `${rel}:${chunk.startLine}`;
        documents[docId] = {
          file: rel, startLine: chunk.startLine, endLine: chunk.endLine,
          content: chunk.content, termFreqs: buildTermFreqs(tokens), length: tokens.length,
        };
        docIds.push(docId);
      }
      if (docIds.length > 0) fileToDocIds[rel] = docIds;
      fileHashes[rel] = fileHashSync(abs);
    } catch { /* skip unreadable files */ }

    processed++;
    // Send progress every 20 files
    if (processed % 20 === 0) {
      process.send({ type: 'progress', phase: existing ? 'updating' : 'indexing', filesTotal: total, filesProcessed: processed, pct: Math.round((processed / total) * 100) });
    }
  }

  // Build inverted index
  for (const [docId, doc] of Object.entries(documents)) {
    for (const term of Object.keys(doc.termFreqs)) {
      if (!invertedIndex[term]) invertedIndex[term] = [];
      invertedIndex[term].push(docId);
    }
  }

  // Compute stats
  const totalDocs = Object.keys(documents).length;
  let sumLengths = 0;
  for (const doc of Object.values(documents)) sumLengths += doc.length;
  const avgDocLength = totalDocs > 0 ? sumLengths / totalDocs : 1;

  // Compute IDF
  const idfCache = {};
  for (const [term, postings] of Object.entries(invertedIndex)) {
    const df = postings.length;
    idfCache[term] = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
  }

  // Save to disk
  const indexData = {
    version: INDEX_VERSION,
    workDir: workDir,
    savedAt: Date.now(),
    totalDocs,
    avgDocLength,
    documents,
    invertedIndex,
    fileHashes,
    fileToDocIds,
  };
  saveIndex(workDir, indexData);

  const filesIndexed = Object.keys(fileToDocIds).length;
  const msg = existing
    ? `Incremental: reused ${reused}, re-indexed ${processed - reused} of ${total} files`
    : `Full index: ${filesIndexed} files, ${totalDocs} chunks`;

  // Send final result back to main process
  process.send({
    type: 'done',
    stats: { filesIndexed, totalChunks: totalDocs, totalTerms: Object.keys(invertedIndex).length },
    message: msg,
  });
}

// ── Listen for commands from main process ──
process.on('message', function (msg) {
  if (msg.type === 'index') {
    try {
      doIndex(msg.workDir);
    } catch (err) {
      process.send({ type: 'error', message: err.message });
    }
    process.exit(0);
  }
});

process.send({ type: 'ready' });
