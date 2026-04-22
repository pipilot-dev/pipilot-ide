// PiPilot IDE — Local BM25/TF-IDF semantic code search engine
// Ported from Vite's server/search-index.ts — no external APIs, no embeddings.
// Phase 1: Persistent index (load/save to .pipilot/search-index.json)
// Phase 2: Background indexing with progress events
// Phase 3: Live incremental updates via file hashes

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const MAX_FILE_SIZE = 500 * 1024;
const MAX_CHUNK_LINES = 50;
const BATCH_SIZE = 5;       // Process 5 files per batch
const BATCH_DELAY = 50;     // Sleep 50ms between batches (lets UI breathe)
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
  const freqs = new Map();
  for (const t of tokens) freqs.set(t, (freqs.get(t) || 0) + 1);
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
    if (text.trim().length > 0) {
      chunks.push({ startLine: chunkStart + 1, endLine: end, content: text });
    }
    chunkStart = end;
    blankCount = 0;
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '') {
      blankCount++;
      if (blankCount >= 2 && i - chunkStart > 1) flush(i - 1);
      continue;
    }
    blankCount = 0;
    if (i > chunkStart && isDefinitionLine(lines[i])) flush(i);
    if (i - chunkStart >= MAX_CHUNK_LINES) {
      let splitAt = -1;
      for (let j = i; j > i - 10 && j > chunkStart; j--) {
        if (lines[j].trim() === '') { splitAt = j; break; }
      }
      flush(splitAt > chunkStart ? splitAt : i);
    }
  }
  flush(lines.length);
  return chunks;
}

function isBinary(buf) {
  const check = buf.subarray(0, Math.min(8192, buf.length));
  for (let i = 0; i < check.length; i++) {
    if (check[i] === 0) return true;
  }
  return false;
}

function shouldIndex(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);
  if (ext === '.json') return INDEXABLE_JSON.has(base);
  return INDEXABLE_EXTENSIONS.has(ext);
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function walkDir(dir, basePath) {
  const files = [];
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const sub = await walkDir(path.join(dir, entry.name), basePath ? `${basePath}/${entry.name}` : entry.name);
      files.push(...sub);
      // Sleep between directories to keep main process responsive
      if (files.length % 20 === 0) await sleep(10);
    } else if (entry.isFile()) {
      const rel = basePath ? `${basePath}/${entry.name}` : entry.name;
      if (shouldIndex(rel)) files.push(rel);
    }
  }
  return files;
}

async function fileHash(absPath) {
  try {
    const stat = await fsp.stat(absPath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch { return null; }
}

// Sync version only for single-file updates (non-blocking since it's one call)
function fileHashSync(absPath) {
  try {
    const stat = fs.statSync(absPath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch { return null; }
}

class CodeSearchIndex {
  constructor(workDir) {
    this.workDir = workDir;
    this.documents = new Map();
    this.invertedIndex = new Map();
    this.docLengths = new Map();
    this.fileToDocIds = new Map();
    this.idfCache = new Map();
    this.fileHashes = new Map(); // relPath -> hash (for change detection)
    this.avgDocLength = 1;
    this.totalDocs = 0;
    this._ready = false;
    this._indexing = null;
    this._onProgress = null; // callback: ({ phase, filesTotal, filesProcessed, pct }) => void
  }

  // ── Persistence ──

  _indexPath() {
    return path.join(this.workDir, '.pipilot', 'search-index.json');
  }

  async save() {
    const indexPath = this._indexPath();
    try {
      await fsp.mkdir(path.dirname(indexPath), { recursive: true });

      // Serialize: convert Maps to plain objects, Sets to arrays, termFreqs to objects
      const docs = {};
      for (const [id, doc] of this.documents) {
        docs[id] = {
          file: doc.file, startLine: doc.startLine, endLine: doc.endLine,
          content: doc.content, length: doc.length,
          termFreqs: Object.fromEntries(doc.termFreqs),
        };
      }
      const inverted = {};
      for (const [term, set] of this.invertedIndex) {
        inverted[term] = [...set];
      }
      const hashes = Object.fromEntries(this.fileHashes);
      const fileDocIds = {};
      for (const [file, ids] of this.fileToDocIds) {
        fileDocIds[file] = ids;
      }

      const data = {
        version: INDEX_VERSION,
        workDir: this.workDir,
        savedAt: Date.now(),
        totalDocs: this.totalDocs,
        avgDocLength: this.avgDocLength,
        documents: docs,
        invertedIndex: inverted,
        fileHashes: hashes,
        fileToDocIds: fileDocIds,
      };

      await fsp.writeFile(indexPath, JSON.stringify(data), 'utf8');
      console.log(`[search-index] Saved index: ${this.fileToDocIds.size} files, ${this.documents.size} chunks`);
    } catch (err) {
      console.warn('[search-index] Failed to save index:', err.message);
    }
  }

  async load() {
    const indexPath = this._indexPath();
    try {
      const raw = await fsp.readFile(indexPath, 'utf8');
      const data = JSON.parse(raw);
      if (data.version !== INDEX_VERSION || data.workDir !== this.workDir) {
        console.log('[search-index] Index version/path mismatch, will rebuild');
        return false;
      }

      // Restore documents (yield every 500 to keep main process responsive)
      const docEntries = Object.entries(data.documents);
      for (let i = 0; i < docEntries.length; i++) {
        const [id, doc] = docEntries[i];
        this.documents.set(id, {
          ...doc,
          termFreqs: new Map(Object.entries(doc.termFreqs)),
        });
        this.docLengths.set(id, doc.length);
        if ((i + 1) % 500 === 0) await sleep(10);
      }

      // Restore inverted index (yield every 1000 terms)
      const termEntries = Object.entries(data.invertedIndex);
      for (let i = 0; i < termEntries.length; i++) {
        const [term, docIds] = termEntries[i];
        this.invertedIndex.set(term, new Set(docIds));
        if ((i + 1) % 1000 === 0) await sleep(10);
      }

      // Restore file hashes and doc IDs
      this.fileHashes = new Map(Object.entries(data.fileHashes));
      for (const [file, ids] of Object.entries(data.fileToDocIds)) {
        this.fileToDocIds.set(file, ids);
      }

      this.totalDocs = data.totalDocs || this.documents.size;
      this.avgDocLength = data.avgDocLength || 1;
      await this._recomputeIdf();

      console.log(`[search-index] Loaded index: ${this.fileToDocIds.size} files, ${this.documents.size} chunks`);
      return true;
    } catch {
      return false;
    }
  }

  // ── Indexing ──

  async indexProject() {
    if (this._indexing) return this._indexing;
    this._indexing = this._doIndex();
    return this._indexing;
  }

  indexFile(filePath) {
    const rel = this._toRelative(filePath);
    if (!rel || !shouldIndex(rel)) return;
    this.removeFile(filePath);
    const abs = path.isAbsolute(filePath) ? filePath : path.join(this.workDir, filePath);
    this._processFile(rel, abs);
    this.fileHashes.set(rel, fileHashSync(abs));
    this._recomputeIdf().catch(() => {});
    // Debounced save (don't block on every single file change)
    this._scheduleSave();
  }

  removeFile(filePath) {
    const rel = this._toRelative(filePath);
    if (!rel) return;
    const docIds = this.fileToDocIds.get(rel);
    if (!docIds) return;
    for (const docId of docIds) {
      const doc = this.documents.get(docId);
      if (doc) {
        for (const term of doc.termFreqs.keys()) {
          const set = this.invertedIndex.get(term);
          if (set) { set.delete(docId); if (set.size === 0) this.invertedIndex.delete(term); }
        }
        this.docLengths.delete(docId);
        this.documents.delete(docId);
      }
    }
    this.fileToDocIds.delete(rel);
    this.fileHashes.delete(rel);
    this.totalDocs = this.documents.size;
    this._updateAvgDocLength();
    this._scheduleSave();
  }

  // ── Search ──

  search(query, maxResults = 20) {
    if (this.totalDocs === 0) return [];
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
    const queryTerms = [...new Set(queryTokens)];

    const candidates = new Set();
    for (const term of queryTerms) {
      const postings = this.invertedIndex.get(term);
      if (postings) for (const docId of postings) candidates.add(docId);
    }
    if (candidates.size === 0) return [];

    const scored = [];
    for (const docId of candidates) {
      const doc = this.documents.get(docId);
      if (!doc) continue;
      let score = 0;
      let matchedTerms = 0;
      const dl = doc.length;
      for (const term of queryTerms) {
        const tf = doc.termFreqs.get(term) || 0;
        if (tf === 0) continue;
        const idf = this.idfCache.get(term) || 0;
        if (idf <= 0) continue;
        const numerator = tf * (BM25_K1 + 1);
        const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * dl / this.avgDocLength);
        score += idf * (numerator / denominator);
        matchedTerms++;
      }
      if (score <= 0) continue;
      const coverage = matchedTerms / queryTerms.length;
      if (queryTerms.length >= 3 && coverage < 0.3) continue;
      score *= (0.5 + 0.5 * coverage);
      scored.push({ docId, score, matchedTerms });
    }

    scored.sort((a, b) => b.score - a.score);
    const topScore = scored.length > 0 ? scored[0].score : 0;
    const filtered = scored.filter(s => s.score >= topScore * 0.15);
    const topN = filtered.slice(0, maxResults);
    const maxScore = topN.length > 0 ? topN[0].score : 1;

    return topN.map(({ docId, score }) => {
      const doc = this.documents.get(docId);
      const lines = doc.content.split('\n');
      const snippet = lines.slice(0, 5).join('\n').slice(0, 300);
      return {
        file: doc.file, startLine: doc.startLine, endLine: doc.endLine,
        snippet, score: Math.round((score / maxScore) * 100),
      };
    });
  }

  getStats() {
    return { filesIndexed: this.fileToDocIds.size, totalChunks: this.documents.size, totalTerms: this.invertedIndex.size, ready: this._ready };
  }

  // ── Internal ──

  async _doIndex() {
    // Phase 1: Try loading persisted index
    const loaded = await this.load();
    if (loaded) {
      // Phase 3: Incremental update — only re-index changed/new files
      const allFiles = await walkDir(this.workDir, '');
      const currentFiles = new Set(allFiles);
      let changed = 0, added = 0, removed = 0;

      // Remove files that no longer exist
      for (const rel of [...this.fileHashes.keys()]) {
        if (!currentFiles.has(rel)) {
          this.removeFile(rel);
          removed++;
        }
      }

      // Check for new/changed files (lazy — batch + sleep)
      const toReindex = [];
      for (let i = 0; i < allFiles.length; i++) {
        const rel = allFiles[i];
        const abs = path.join(this.workDir, rel);
        const currentHash = await fileHash(abs);
        const storedHash = this.fileHashes.get(rel);
        if (currentHash !== storedHash) {
          toReindex.push(rel);
        }
        if ((i + 1) % BATCH_SIZE === 0) await sleep(BATCH_DELAY);
      }

      if (toReindex.length > 0 || removed > 0) {
        const total = toReindex.length;
        for (let i = 0; i < toReindex.length; i++) {
          const rel = toReindex[i];
          const abs = path.join(this.workDir, rel);
          const isNew = !this.fileHashes.has(rel);
          this.removeFile(rel);
          this._processFile(rel, abs);
          this.fileHashes.set(rel, await fileHash(abs));
          if (isNew) added++; else changed++;

          if (this._onProgress) {
            this._onProgress({ phase: 'updating', filesTotal: total, filesProcessed: i + 1, pct: Math.round(((i + 1) / total) * 100) });
          }
          if ((i + 1) % BATCH_SIZE === 0) await sleep(BATCH_DELAY);
        }
        await this._recomputeIdf();
        console.log(`[search-index] Incremental update: +${added} ~${changed} -${removed} files`);
        await this.save();
      } else {
        console.log('[search-index] Index is up to date, no changes');
      }

      this._ready = true;
      this._indexing = null;
      if (this._onProgress) this._onProgress({ phase: 'ready', filesTotal: this.fileToDocIds.size, filesProcessed: this.fileToDocIds.size, pct: 100 });
      return;
    }

    // No saved index — full build with progress
    const files = await walkDir(this.workDir, '');
    const total = files.length;
    if (this._onProgress) this._onProgress({ phase: 'indexing', filesTotal: total, filesProcessed: 0, pct: 0 });

    for (let i = 0; i < files.length; i++) {
      const relPath = files[i];
      const absPath = path.join(this.workDir, relPath);
      this._processFile(relPath, absPath);
      this.fileHashes.set(relPath, await fileHash(absPath));

      if (this._onProgress && (i + 1) % BATCH_SIZE === 0) {
        this._onProgress({ phase: 'indexing', filesTotal: total, filesProcessed: i + 1, pct: Math.round(((i + 1) / total) * 100) });
      }
      // Sleep between batches — keeps app responsive during full index
      if ((i + 1) % BATCH_SIZE === 0) await sleep(BATCH_DELAY);
    }
    await this._recomputeIdf();
    this._ready = true;
    this._indexing = null;

    console.log(`[search-index] Full index: ${this.fileToDocIds.size} files, ${this.documents.size} chunks, ${this.invertedIndex.size} terms`);
    if (this._onProgress) this._onProgress({ phase: 'ready', filesTotal: total, filesProcessed: total, pct: 100 });

    // Save to disk for next launch
    await this.save();
  }

  _processFile(relPath, absPath) {
    let buf;
    try {
      const stat = fs.statSync(absPath);
      if (stat.size > MAX_FILE_SIZE || stat.size === 0) return;
      buf = fs.readFileSync(absPath);
    } catch { return; }
    if (isBinary(buf)) return;
    const content = buf.toString('utf8');
    const chunks = chunkFile(content);
    const docIds = [];
    for (const chunk of chunks) {
      const tokens = tokenize(chunk.content);
      if (tokens.length < 2) continue;
      const docId = `${relPath}:${chunk.startLine}`;
      const termFreqs = buildTermFreqs(tokens);
      const doc = { id: docId, file: relPath, startLine: chunk.startLine, endLine: chunk.endLine, content: chunk.content, termFreqs, length: tokens.length };
      this.documents.set(docId, doc);
      this.docLengths.set(docId, tokens.length);
      docIds.push(docId);
      for (const term of termFreqs.keys()) {
        let set = this.invertedIndex.get(term);
        if (!set) { set = new Set(); this.invertedIndex.set(term, set); }
        set.add(docId);
      }
    }
    if (docIds.length > 0) this.fileToDocIds.set(relPath, docIds);
    this.totalDocs = this.documents.size;
    this._updateAvgDocLength();
  }

  async _recomputeIdf() {
    this.idfCache.clear();
    const N = this.totalDocs;
    if (N === 0) return;
    let count = 0;
    for (const [term, postings] of this.invertedIndex) {
      const df = postings.size;
      this.idfCache.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
      count++;
      if (count % 2000 === 0) await sleep(10);
    }
  }

  _updateAvgDocLength() {
    if (this.totalDocs === 0) { this.avgDocLength = 1; return; }
    let sum = 0;
    for (const len of this.docLengths.values()) sum += len;
    this.avgDocLength = sum / this.totalDocs;
  }

  _toRelative(filePath) {
    if (path.isAbsolute(filePath)) {
      const rel = path.relative(this.workDir, filePath).replace(/\\/g, '/');
      if (rel.startsWith('..')) return null;
      return rel;
    }
    return filePath.replace(/\\/g, '/');
  }

  // Debounced save — batch rapid file changes into one write
  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => { this.save().catch(() => {}); }, 3000);
  }
}

module.exports = { CodeSearchIndex };
