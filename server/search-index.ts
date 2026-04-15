/**
 * search-index.ts — Local BM25/TF-IDF semantic code search engine.
 *
 * No external APIs, no embeddings — pure local computation.
 * Indexes code files into logical chunks (functions, classes, blocks),
 * builds an inverted index, and ranks results by BM25 relevance.
 *
 * Usage:
 *   const index = new CodeSearchIndex("/path/to/project");
 *   await index.indexProject();
 *   const results = index.search("how does authentication work?");
 */

import * as fs from "fs";
import * as path from "path";

// ── Constants ────────────────────────────────────────────────────────────────

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const MAX_FILE_SIZE = 500 * 1024; // 500KB
const MAX_CHUNK_LINES = 50;
const YIELD_EVERY = 100; // yield to event loop every N files

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", ".cache", "dist", "build",
  ".vite", ".pipilot", "__pycache__", "coverage", ".claude",
  ".svn", ".hg", "vendor", "target", "out", ".turbo",
  ".vercel", ".netlify", ".parcel-cache", "bower_components",
]);

const INDEXABLE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp",
  ".css", ".scss", ".less", ".html", ".svelte", ".vue",
  ".md", ".yaml", ".yml", ".toml", ".sh", ".bash",
  ".rb", ".php", ".swift", ".kt", ".dart", ".lua",
]);

// JSON files: only index well-known config files
const INDEXABLE_JSON = new Set([
  "package.json", "tsconfig.json", "deno.json", "composer.json",
  "Cargo.toml", "pyproject.toml", "go.mod",
]);

const STOP_WORDS = new Set([
  // English
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "to", "of", "in",
  "for", "on", "with", "at", "by", "as", "or", "and", "but", "not",
  "no", "so", "if", "then", "than", "too", "very", "just", "about",
  "up", "out", "it", "its", "my", "we", "he", "she", "they", "them",
  "that", "this", "these", "those", "what", "which", "who", "whom",
  "how", "when", "where", "why", "all", "each", "every", "both",
  "few", "more", "most", "other", "some", "such", "only", "own",
  // Code keywords (common across languages — too frequent to be useful)
  "const", "let", "var", "function", "return", "import", "from",
  "export", "default", "require", "module", "class", "extends",
  "implements", "interface", "type", "enum", "async", "await",
  "try", "catch", "throw", "finally", "new", "delete", "typeof",
  "instanceof", "void", "null", "undefined", "true", "false",
  "if", "else", "for", "while", "do", "switch", "case", "break",
  "continue", "yield", "super", "this", "self", "def", "fn",
  "pub", "mut", "struct", "impl", "trait", "use", "mod", "crate",
  "package", "func", "go", "defer", "chan", "select", "range",
  "print", "println", "fmt", "string", "int", "float", "bool",
  "none", "pass", "lambda", "raise", "except", "with",
]);

// Regex to detect definition boundaries (start of a new semantic block)
const DEFINITION_RE = /^\s*(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var)\s+\w/;
const PY_DEF_RE = /^\s*(def|class|async\s+def)\s+\w/;
const GO_DEF_RE = /^\s*(func|type)\s+\w/;
const RUST_DEF_RE = /^\s*(pub\s+)?(fn|struct|enum|impl|trait|mod)\s+\w/;
const GENERAL_DEF_RE = /^\s*(public|private|protected|static)\s+/;

// ── Types ────────────────────────────────────────────────────────────────────

interface ChunkDoc {
  id: string;
  file: string;       // relative path (forward slashes)
  startLine: number;   // 1-indexed
  endLine: number;
  content: string;
  termFreqs: Map<string, number>;
  length: number;      // total token count
}

export interface SearchResult {
  file: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;       // normalized 0-100
}

export interface IndexStats {
  filesIndexed: number;
  totalChunks: number;
  totalTerms: number;
  ready: boolean;
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  // 1. Replace non-alphanumeric with spaces (keep underscores temporarily)
  let cleaned = text.replace(/[^a-zA-Z0-9_]/g, " ");

  // 2. Split camelCase: "handlePaymentRetry" → "handle Payment Retry"
  cleaned = cleaned.replace(/([a-z0-9])([A-Z])/g, "$1 $2");

  // 3. Split on underscores and whitespace
  const raw = cleaned.split(/[_\s]+/);

  // 4. Lowercase, filter stop words, min length 2
  const tokens: string[] = [];
  for (const t of raw) {
    const lower = t.toLowerCase();
    if (lower.length >= 2 && !STOP_WORDS.has(lower)) {
      tokens.push(lower);
    }
  }
  return tokens;
}

function buildTermFreqs(tokens: string[]): Map<string, number> {
  const freqs = new Map<string, number>();
  for (const t of tokens) {
    freqs.set(t, (freqs.get(t) || 0) + 1);
  }
  return freqs;
}

// ── Chunker ──────────────────────────────────────────────────────────────────

interface RawChunk {
  startLine: number;
  endLine: number;
  content: string;
}

function isDefinitionLine(line: string): boolean {
  return DEFINITION_RE.test(line)
    || PY_DEF_RE.test(line)
    || GO_DEF_RE.test(line)
    || RUST_DEF_RE.test(line)
    || GENERAL_DEF_RE.test(line);
}

function chunkFile(content: string): RawChunk[] {
  const lines = content.split("\n");
  const chunks: RawChunk[] = [];

  let chunkStart = 0;
  let blankCount = 0;

  const flush = (end: number) => {
    if (end <= chunkStart) return;
    const slice = lines.slice(chunkStart, end);
    const text = slice.join("\n");
    // Skip empty chunks
    if (text.trim().length > 0) {
      chunks.push({
        startLine: chunkStart + 1,
        endLine: end,
        content: text,
      });
    }
    chunkStart = end;
    blankCount = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track blank lines
    if (trimmed === "") {
      blankCount++;
      // 2+ blank lines = chunk boundary
      if (blankCount >= 2 && i - chunkStart > 1) {
        flush(i - 1);
      }
      continue;
    }
    blankCount = 0;

    // Definition line = new chunk (if we have content already)
    if (i > chunkStart && isDefinitionLine(line)) {
      flush(i);
    }

    // Force-split at max chunk size
    if (i - chunkStart >= MAX_CHUNK_LINES) {
      // Try to find a blank line nearby to split cleanly
      let splitAt = -1;
      for (let j = i; j > i - 10 && j > chunkStart; j--) {
        if (lines[j].trim() === "") { splitAt = j; break; }
      }
      flush(splitAt > chunkStart ? splitAt : i);
    }
  }

  // Flush remaining
  flush(lines.length);

  return chunks;
}

// ── File utilities ───────────────────────────────────────────────────────────

function isBinary(buf: Buffer): boolean {
  const check = buf.subarray(0, Math.min(8192, buf.length));
  for (let i = 0; i < check.length; i++) {
    if (check[i] === 0) return true;
  }
  return false;
}

function shouldIndex(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);

  // JSON: only specific config files
  if (ext === ".json") return INDEXABLE_JSON.has(base);

  return INDEXABLE_EXTENSIONS.has(ext);
}

function walkDir(dir: string, basePath: string = ""): string[] {
  const files: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      files.push(...walkDir(path.join(dir, entry.name), basePath ? `${basePath}/${entry.name}` : entry.name));
    } else if (entry.isFile()) {
      const rel = basePath ? `${basePath}/${entry.name}` : entry.name;
      if (shouldIndex(rel)) files.push(rel);
    }
  }
  return files;
}

// ── BM25 Search Index ────────────────────────────────────────────────────────

export class CodeSearchIndex {
  private workDir: string;
  private documents = new Map<string, ChunkDoc>();
  private invertedIndex = new Map<string, Set<string>>();
  private docLengths = new Map<string, number>();
  private fileToDocIds = new Map<string, string[]>();
  private idfCache = new Map<string, number>();
  private avgDocLength = 1;
  private totalDocs = 0;
  private _ready = false;
  private _indexing: Promise<void> | null = null;

  constructor(workDir: string) {
    this.workDir = workDir;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  async indexProject(): Promise<void> {
    // Guard against concurrent calls
    if (this._indexing) return this._indexing;
    this._indexing = this._doIndex();
    return this._indexing;
  }

  indexFile(filePath: string): void {
    const rel = this._toRelative(filePath);
    if (!rel || !shouldIndex(rel)) return;

    // Remove old data for this file
    this.removeFile(filePath);

    // Process the file
    const abs = path.isAbsolute(filePath) ? filePath : path.join(this.workDir, filePath);
    this._processFile(rel, abs);
    this._recomputeIdf();
  }

  removeFile(filePath: string): void {
    const rel = this._toRelative(filePath);
    if (!rel) return;

    const docIds = this.fileToDocIds.get(rel);
    if (!docIds) return;

    for (const docId of docIds) {
      const doc = this.documents.get(docId);
      if (doc) {
        // Remove from inverted index
        for (const term of doc.termFreqs.keys()) {
          const set = this.invertedIndex.get(term);
          if (set) {
            set.delete(docId);
            if (set.size === 0) this.invertedIndex.delete(term);
          }
        }
        this.docLengths.delete(docId);
        this.documents.delete(docId);
      }
    }

    this.fileToDocIds.delete(rel);
    this.totalDocs = this.documents.size;
    this._updateAvgDocLength();
  }

  search(query: string, maxResults: number = 20): SearchResult[] {
    if (this.totalDocs === 0) return [];

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    // Unique query terms
    const queryTerms = [...new Set(queryTokens)];

    // Collect candidate documents (union of all term posting lists)
    const candidates = new Set<string>();
    for (const term of queryTerms) {
      const postings = this.invertedIndex.get(term);
      if (postings) {
        for (const docId of postings) candidates.add(docId);
      }
    }

    if (candidates.size === 0) return [];

    // Score each candidate with BM25
    const scored: { docId: string; score: number }[] = [];
    for (const docId of candidates) {
      const doc = this.documents.get(docId);
      if (!doc) continue;

      let score = 0;
      const dl = doc.length;

      for (const term of queryTerms) {
        const tf = doc.termFreqs.get(term) || 0;
        if (tf === 0) continue;
        const idf = this.idfCache.get(term) || 0;
        if (idf <= 0) continue;

        // BM25 formula
        const numerator = tf * (BM25_K1 + 1);
        const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * dl / this.avgDocLength);
        score += idf * (numerator / denominator);
      }

      if (score > 0) scored.push({ docId, score });
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Normalize to 0-100 and build results
    const topN = scored.slice(0, maxResults);
    const maxScore = topN.length > 0 ? topN[0].score : 1;

    return topN.map(({ docId, score }) => {
      const doc = this.documents.get(docId)!;
      const lines = doc.content.split("\n");
      const snippet = lines.slice(0, 3).join("\n").slice(0, 200);

      return {
        file: doc.file,
        startLine: doc.startLine,
        endLine: doc.endLine,
        snippet,
        score: Math.round((score / maxScore) * 100),
      };
    });
  }

  getStats(): IndexStats {
    return {
      filesIndexed: this.fileToDocIds.size,
      totalChunks: this.documents.size,
      totalTerms: this.invertedIndex.size,
      ready: this._ready,
    };
  }

  // ── Private implementation ───────────────────────────────────────────────

  private async _doIndex(): Promise<void> {
    const files = walkDir(this.workDir);
    let count = 0;

    for (const relPath of files) {
      const absPath = path.join(this.workDir, relPath);
      this._processFile(relPath, absPath);

      count++;
      // Yield to event loop every N files to keep server responsive
      if (count % YIELD_EVERY === 0) {
        await new Promise<void>((r) => setImmediate(r));
      }
    }

    this._recomputeIdf();
    this._ready = true;
    this._indexing = null;

    console.log(
      `[search-index] Indexed ${this.fileToDocIds.size} files, ` +
      `${this.documents.size} chunks, ${this.invertedIndex.size} terms`
    );
  }

  private _processFile(relPath: string, absPath: string): void {
    let buf: Buffer;
    try {
      const stat = fs.statSync(absPath);
      if (stat.size > MAX_FILE_SIZE || stat.size === 0) return;
      buf = fs.readFileSync(absPath);
    } catch {
      return;
    }

    // Skip binary files
    if (isBinary(buf)) return;

    const content = buf.toString("utf8");
    const chunks = chunkFile(content);
    const docIds: string[] = [];

    for (const chunk of chunks) {
      const tokens = tokenize(chunk.content);
      if (tokens.length < 2) continue; // skip trivial chunks

      const docId = `${relPath}:${chunk.startLine}`;
      const termFreqs = buildTermFreqs(tokens);

      const doc: ChunkDoc = {
        id: docId,
        file: relPath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        content: chunk.content,
        termFreqs,
        length: tokens.length,
      };

      this.documents.set(docId, doc);
      this.docLengths.set(docId, tokens.length);
      docIds.push(docId);

      // Update inverted index
      for (const term of termFreqs.keys()) {
        let set = this.invertedIndex.get(term);
        if (!set) {
          set = new Set();
          this.invertedIndex.set(term, set);
        }
        set.add(docId);
      }
    }

    if (docIds.length > 0) {
      this.fileToDocIds.set(relPath, docIds);
    }

    this.totalDocs = this.documents.size;
    this._updateAvgDocLength();
  }

  private _recomputeIdf(): void {
    this.idfCache.clear();
    const N = this.totalDocs;
    if (N === 0) return;

    for (const [term, postings] of this.invertedIndex) {
      const df = postings.size;
      // BM25 IDF: log((N - df + 0.5) / (df + 0.5) + 1)
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      this.idfCache.set(term, idf);
    }
  }

  private _updateAvgDocLength(): void {
    if (this.totalDocs === 0) {
      this.avgDocLength = 1;
      return;
    }
    let sum = 0;
    for (const len of this.docLengths.values()) sum += len;
    this.avgDocLength = sum / this.totalDocs;
  }

  private _toRelative(filePath: string): string | null {
    if (path.isAbsolute(filePath)) {
      const rel = path.relative(this.workDir, filePath).replace(/\\/g, "/");
      // If it starts with ".." it's outside the workspace
      if (rel.startsWith("..")) return null;
      return rel;
    }
    return filePath.replace(/\\/g, "/");
  }
}
