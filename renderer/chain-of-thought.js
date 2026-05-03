/**
 * ChainOfThought — vanilla JS component for AI reasoning UIs
 *
 * Usage (ES module):
 *   import { ChainOfThought } from './chain-of-thought.js';
 *   import './chain-of-thought.css';
 *
 *   const cot = ChainOfThought.create({ open: true });
 *   ChainOfThought.header(cot, 'Thinking...');
 *   const content = ChainOfThought.content(cot);
 *   const step = ChainOfThought.step(content, {
 *     label: 'Searching the web',
 *     iconName: 'globe',
 *     status: 'active',
 *   });
 *   document.body.appendChild(cot);
 *
 * Icons:
 *   Requires lucide icons to render SVGs. Either:
 *   (a) Include lucide CDN script in your HTML, OR
 *   (b) Pass { lucide } in ChainOfThought.init({ lucide }) after importing lucide
 *       yourself. If neither is available, iconName falls back to a bullet dot.
 */

// Module-scoped lucide reference. Resolved lazily: first checks what was passed
// via init(), then falls back to window.lucide (CDN case).
let _lucide = null;

function getLucide() {
  if (_lucide) return _lucide;
  if (typeof window !== 'undefined' && window.lucide) return window.lucide;
  return null;
}

function refreshIcons(/* scope */) {
  const l = getLucide();
  if (!l || !l.createIcons) return;
  // Lucide's createIcons() does not accept an `elements` option — passing one
  // makes it silently render nothing. Call with no args so it scans every
  // [data-lucide] in the document (cheap; lucide skips already-rendered ones).
  try { l.createIcons(); } catch {}
}

// --- DOM helpers -------------------------------------------------
function el(tag, className, attrs = {}) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  return n;
}

// Inline lucide-style SVG registry. Avoids a network dependency on the lucide
// UMD CDN, which is unreliable in Electron (CSP, offline, package path drift).
// Paths are from github.com/lucide-icons/lucide (ISC) and match the rendering
// of <i data-lucide="NAME"> exactly. Add more here as needed.
const ICONS = {
  brain:
    '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>' +
    '<path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>' +
    '<path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>' +
    '<path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/>' +
    '<path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/>' +
    '<path d="M3.477 10.896a4 4 0 0 1 .585-.396"/>' +
    '<path d="M19.938 10.5a4 4 0 0 1 .585.396"/>' +
    '<path d="M6 18a4 4 0 0 1-1.967-.516"/>' +
    '<path d="M19.967 17.484A4 4 0 0 1 18 18"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  search:
    '<circle cx="11" cy="11" r="8"/>' +
    '<path d="m21 21-4.3-4.3"/>',
  globe:
    '<circle cx="12" cy="12" r="10"/>' +
    '<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>' +
    '<path d="M2 12h20"/>',
  image:
    '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>' +
    '<circle cx="9" cy="9" r="2"/>' +
    '<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  lightbulb:
    '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>' +
    '<path d="M9 18h6"/>' +
    '<path d="M10 22h4"/>',
  'check-circle-2':
    '<circle cx="12" cy="12" r="10"/>' +
    '<path d="m9 12 2 2 4-4"/>',
  'file-text':
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>' +
    '<path d="M14 2v4a2 2 0 0 0 2 2h4"/>' +
    '<path d="M10 9H8"/>' +
    '<path d="M16 13H8"/>' +
    '<path d="M16 17H8"/>',
  'book-open':
    '<path d="M12 7v14"/>' +
    '<path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  newspaper:
    '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>' +
    '<path d="M18 14h-8"/>' +
    '<path d="M15 18h-5"/>' +
    '<path d="M10 6h8v4h-8z"/>',
  github:
    '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/>' +
    '<path d="M9 18c-4.51 2-5-2-7-2"/>',
  dot: '<circle cx="12.1" cy="12.1" r="1"/>',
};

function icon(name, extraClass = '') {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', `cot-icon ${extraClass}`.trim());
  svg.innerHTML = ICONS[name] || ICONS.dot;
  return svg;
}

// --- public API --------------------------------------------------

/**
 * Initialize the library. Optional — only needed if you're using a bundled
 * lucide import instead of the CDN global.
 * @param {{ lucide?: object }} opts
 */
function init(opts = {}) {
  if (opts.lucide) _lucide = opts.lucide;
}

/**
 * Create a ChainOfThought root element.
 * @param {{ open?: boolean }} opts
 * @returns {HTMLElement} root element (not yet attached to the DOM)
 */
function create({ open = false } = {}) {
  const root = el('div', 'cot');
  root.dataset.open = String(open);
  return root;
}

/**
 * Attach a header (collapsible trigger) to the root.
 * @param {HTMLElement} root  result of create()
 * @param {string} [labelText]
 * @returns {HTMLElement} the header button
 */
function header(root, labelText = 'Chain of Thought') {
  const btn = el('button', 'cot-header', { type: 'button' });
  btn.setAttribute('aria-expanded', root.dataset.open);
  btn.appendChild(icon('brain'));
  const span = el('span', 'cot-header-label', { text: labelText });
  btn.appendChild(span);
  btn.appendChild(icon('chevron-down', 'chevron'));

  btn.addEventListener('click', () => {
    const next = root.dataset.open !== 'true';
    root.dataset.open = String(next);
    btn.setAttribute('aria-expanded', String(next));
    root.dispatchEvent(new CustomEvent('cot:toggle', { detail: { open: next } }));
  });

  root.appendChild(btn);
  refreshIcons(btn);
  return btn;
}

/**
 * Attach a content (collapsible body) container to the root.
 * @param {HTMLElement} root
 * @returns {HTMLElement} the content container — pass this to step(), etc.
 */
function content(root) {
  const c = el('div', 'cot-content');
  root.appendChild(c);
  return c;
}

/**
 * Add a reasoning step.
 * @param {HTMLElement} container  result of content()
 * @param {{
 *   iconName?: string,
 *   label: string|Node,
 *   description?: string,
 *   status?: 'complete'|'active'|'pending',
 * }} opts
 * @returns {{ element: HTMLElement, body: HTMLElement, setStatus: (s: string) => void }}
 */
function step(container, {
  iconName = 'dot',
  label,
  description,
  status = 'complete',
} = {}) {
  const s = el('div', 'cot-step');
  s.dataset.status = status;

  // Hide the icon column entirely when there's no label — saves the user
  // from seeing the same icon stacked twice (header icon + step icon) in
  // single-step cards, where the card header already conveys the meaning.
  const hasLabel = (typeof label === 'string' && label.length > 0) || label instanceof Node;
  if (hasLabel) {
    const iconWrap = el('div', 'cot-step-icon-wrap');
    iconWrap.appendChild(icon(iconName));
    iconWrap.appendChild(el('div', 'cot-step-connector'));
    s.appendChild(iconWrap);
  }

  const body = el('div', 'cot-step-body');
  if (hasLabel) {
    const labelEl = el('div', 'cot-step-label');
    if (typeof label === 'string') labelEl.textContent = label;
    else if (label instanceof Node) labelEl.appendChild(label);
    body.appendChild(labelEl);
  }

  if (description) {
    body.appendChild(el('div', 'cot-step-description', { text: description }));
  }

  s.appendChild(body);
  container.appendChild(s);
  refreshIcons(s);

  return {
    element: s,
    body,
    setStatus: (st) => (s.dataset.status = st),
  };
}

/**
 * Create a badge row inside a step body.
 * @param {HTMLElement} stepBody  the `.body` returned from step()
 * @returns {HTMLElement} the row (pass to searchResult())
 */
function searchResults(stepBody) {
  const row = el('div', 'cot-search-results');
  stepBody.appendChild(row);
  return row;
}

/**
 * Add a single badge to a search results row.
 * @param {HTMLElement} row
 * @param {{ label: string, iconName?: string }} opts
 * @returns {HTMLElement} the badge element
 */
function searchResult(row, { label, iconName = 'globe' } = {}) {
  const badge = el('span', 'cot-badge');
  badge.appendChild(icon(iconName));
  badge.appendChild(document.createTextNode(label));
  row.appendChild(badge);
  refreshIcons(badge);
  return badge;
}

/**
 * Add an image block inside a step body.
 * @param {HTMLElement} stepBody
 * @param {{ src: string, alt?: string, caption?: string }} opts
 * @returns {HTMLElement}
 */
function image(stepBody, { src, alt = '', caption } = {}) {
  const wrap = el('div', 'cot-image');
  const frame = el('div', 'cot-image-frame');
  frame.appendChild(el('img', '', { src, alt }));
  wrap.appendChild(frame);
  if (caption) wrap.appendChild(el('p', 'cot-image-caption', { text: caption }));
  stepBody.appendChild(wrap);
  return wrap;
}

// --- exports -----------------------------------------------------

const ChainOfThought = {
  init,
  create,
  header,
  content,
  step,
  searchResults,
  searchResult,
  image,
};

// Expose on window for plain <script> usage (this project doesn't use
// <script type="module">, so ES export statements would be a parse error).
if (typeof window !== 'undefined') {
  window.ChainOfThought = ChainOfThought;
}
