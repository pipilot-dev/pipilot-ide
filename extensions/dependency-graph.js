// PiPilot IDE Extension: Dependency Graph
// Activity bar button (network icon). Opens a virtual tab that scans JS/TS files
// for import/require statements, builds a dependency map, renders interactive graph.

(function (PiPilot, bus, api, state, db) {

  // ── Activity bar button ──
  var actBar = document.getElementById('activity-bar');
  if (actBar) {
    var btn = document.createElement('button');
    btn.className = 'activity-btn';
    btn.title = 'Dependency Graph';
    btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><line x1="8.5" y1="6" x2="15.5" y2="6"/><line x1="6" y1="8.5" x2="6" y2="15.5"/><line x1="8.5" y1="7.5" x2="15.5" y2="16.5"/><line x1="18" y1="8.5" x2="18" y2="15.5"/></svg>';
    btn.addEventListener('click', openGraph);
    actBar.insertBefore(btn, actBar.lastElementChild);
  }

  // ── Extension map ──
  var JS_EXTS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts'];

  function getExtension(path) {
    var m = path.match(/(\.[^.\\/]+)$/);
    return m ? m[1].toLowerCase() : '';
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function normalizePath(p) {
    return p.replace(/\\/g, '/');
  }

  function getDir(path) {
    var parts = normalizePath(path).split('/');
    parts.pop();
    return parts.join('/') || '.';
  }

  function getBaseName(path) {
    var parts = normalizePath(path).split('/');
    return parts[parts.length - 1] || path;
  }

  function getTopDir(path) {
    var parts = normalizePath(path).split('/');
    return parts.length > 1 ? parts[0] : '(root)';
  }

  // ── Color palette for directories ──
  var DIR_COLORS = [
    '#58a6ff', '#56d364', '#e5a639', '#e5484d', '#bc8cff',
    '#39d0d6', '#f778ba', '#FF6B35', '#79c0ff', '#7ee787',
    '#d2a8ff', '#ffa657', '#ff7b72', '#a5d6ff', '#8b949e'
  ];

  // ── Flatten tree ──
  function flattenTree(nodes, prefix) {
    var files = [];
    if (!nodes || !Array.isArray(nodes)) return files;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node) continue;
      var path = prefix ? prefix + '/' + node.name : node.name;
      if (node.children) {
        files = files.concat(flattenTree(node.children, path));
      } else {
        files.push({ name: node.name, path: path, size: node.size || 0 });
      }
    }
    return files;
  }

  // ── Parse imports from file content ──
  function parseImports(content) {
    var imports = [];
    if (!content) return imports;

    // ES import: import ... from 'path'
    var esImport = /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
    var m;
    while ((m = esImport.exec(content)) !== null) {
      imports.push(m[1]);
    }

    // Dynamic import: import('path')
    var dynImport = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = dynImport.exec(content)) !== null) {
      imports.push(m[1]);
    }

    // require: require('path')
    var reqImport = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = reqImport.exec(content)) !== null) {
      imports.push(m[1]);
    }

    // export ... from 'path'
    var reExport = /export\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
    while ((m = reExport.exec(content)) !== null) {
      imports.push(m[1]);
    }

    return imports;
  }

  // ── Resolve relative import to file path ──
  function resolveImport(importPath, fromFile, allFilePaths) {
    // Skip node_modules / bare specifiers
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }

    var fromDir = getDir(fromFile);
    var parts = normalizePath(fromDir + '/' + importPath).split('/');
    var resolved = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '..') { resolved.pop(); }
      else if (parts[i] !== '.') { resolved.push(parts[i]); }
    }
    var base = resolved.join('/');

    // Try exact match first, then with extensions, then index files
    var candidates = [base];
    for (var e = 0; e < JS_EXTS.length; e++) {
      candidates.push(base + JS_EXTS[e]);
      candidates.push(base + '/index' + JS_EXTS[e]);
    }

    for (var c = 0; c < candidates.length; c++) {
      if (allFilePaths.indexOf(candidates[c]) !== -1) {
        return candidates[c];
      }
    }
    return null;
  }

  // ── Open virtual tab ──
  function exportGraph(format, graphArea) {
    if (!graphArea) return;
    var svg = graphArea.querySelector('svg');
    var nodes = graphArea.querySelectorAll('.depgraph-node');
    if (!svg && !nodes.length) {
      bus.emit('toast:show', { message: 'No graph to export. Click Scan first.', type: 'warn' });
      return;
    }

    var w = parseInt(graphArea.style.width) || graphArea.scrollWidth || 800;
    var h = parseInt(graphArea.style.height) || graphArea.scrollHeight || 600;

    if (format === 'svg') {
      // Build a standalone SVG with embedded nodes
      var svgClone = svg ? svg.cloneNode(true) : document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svgClone.setAttribute('width', w);
      svgClone.setAttribute('height', h);

      // Render nodes as SVG foreignObject
      for (var i = 0; i < nodes.length; i++) {
        var nd = nodes[i];
        var fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        fo.setAttribute('x', parseInt(nd.style.left) || 0);
        fo.setAttribute('y', parseInt(nd.style.top) || 0);
        fo.setAttribute('width', parseInt(nd.style.width) || 150);
        fo.setAttribute('height', 40);
        var body = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
        body.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        body.style.cssText = nd.style.cssText.replace(/position\s*:\s*absolute\s*;?/i, '');
        body.textContent = nd.textContent;
        fo.appendChild(body);
        svgClone.appendChild(fo);
      }

      var svgData = new XMLSerializer().serializeToString(svgClone);
      var blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svgData], { type: 'image/svg+xml' });
      downloadBlob(blob, 'dependency-graph.svg');
      bus.emit('toast:show', { message: 'SVG exported', type: 'ok' });

    } else if (format === 'png') {
      // Render to canvas via html2canvas-like approach using SVG foreignObject
      var canvas = document.createElement('canvas');
      var scale = 2; // retina
      canvas.width = w * scale;
      canvas.height = h * scale;
      var ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.fillStyle = '#16161a';
      ctx.fillRect(0, 0, w, h);

      // Draw edges from SVG
      var lines = svg ? svg.querySelectorAll('line') : [];
      for (var l = 0; l < lines.length; l++) {
        var ln = lines[l];
        ctx.beginPath();
        ctx.moveTo(parseFloat(ln.getAttribute('x1')), parseFloat(ln.getAttribute('y1')));
        ctx.lineTo(parseFloat(ln.getAttribute('x2')), parseFloat(ln.getAttribute('y2')));
        ctx.strokeStyle = ln.getAttribute('stroke') || '#444';
        ctx.lineWidth = 1;
        ctx.globalAlpha = parseFloat(ln.getAttribute('opacity') || '0.6');
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Draw arrowhead
        var ax = parseFloat(ln.getAttribute('x2'));
        var ay = parseFloat(ln.getAttribute('y2'));
        var fx = parseFloat(ln.getAttribute('x1'));
        var fy = parseFloat(ln.getAttribute('y1'));
        var angle = Math.atan2(ay - fy, ax - fx);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - 8 * Math.cos(angle - 0.4), ay - 8 * Math.sin(angle - 0.4));
        ctx.lineTo(ax - 8 * Math.cos(angle + 0.4), ay - 8 * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fillStyle = '#555';
        ctx.fill();
      }

      // Draw nodes
      ctx.font = '11px JetBrains Mono, monospace';
      for (var n = 0; n < nodes.length; n++) {
        var node = nodes[n];
        var nx = parseInt(node.style.left) || 0;
        var ny = parseInt(node.style.top) || 0;
        var nw = parseInt(node.style.width) || 150;
        var nh = 36;
        var bg = node.style.borderColor || '#444';
        var isOrphan = node.style.borderStyle === 'dashed';

        // Node background
        ctx.fillStyle = '#232329';
        ctx.strokeStyle = bg;
        ctx.lineWidth = isOrphan ? 1.5 : 1;
        if (isOrphan) ctx.setLineDash([4, 3]); else ctx.setLineDash([]);
        ctx.beginPath();
        ctx.roundRect(nx, ny, nw, nh, 6);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        // Node text
        ctx.fillStyle = '#d9d9de';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.textContent.trim().slice(0, 22), nx + 8, ny + nh / 2);
      }

      canvas.toBlob(function (blob) {
        if (blob) {
          downloadBlob(blob, 'dependency-graph.png');
          bus.emit('toast:show', { message: 'PNG exported (' + canvas.width + 'x' + canvas.height + ')', type: 'ok' });
        }
      }, 'image/png');
    }
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  function openGraph() {
    if (!PiPilot.editor || !PiPilot.editor.openVirtualTab) return;
    PiPilot.editor.openVirtualTab({
      id: 'ext://dependency-graph',
      name: 'Dependency Graph',
      mount: function (container) {
        container.innerHTML = '';
        container.style.cssText = 'overflow:auto;padding:0;font-family:var(--font-sans);color:var(--text);background:var(--bg);position:relative;';

        var toolbar = document.createElement('div');
        toolbar.style.cssText = 'padding:12px 20px;border-bottom:1px solid var(--border,#333);display:flex;align-items:center;gap:12px;background:var(--surface,#1a1a22);';
        toolbar.innerHTML = '<span style="font-weight:600;font-size:15px;">Dependency Graph</span>' +
          '<button id="depgraph-refresh" style="background:var(--accent,#6c8cff);color:#fff;border:none;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:12px;">Scan</button>' +
          '<span id="depgraph-status" style="color:var(--text-dim,#888);font-size:12px;"></span>' +
          '<label style="margin-left:auto;font-size:11px;color:var(--text-dim,#888);display:flex;align-items:center;gap:4px;">' +
            '<input type="checkbox" id="depgraph-orphans" checked> Show orphans</label>' +
          '<select id="depgraph-export" style="background:var(--surface-alt,#232329);color:var(--text,#ccc);border:1px solid var(--border,#333);border-radius:4px;padding:3px 8px;font-size:11px;cursor:pointer;">' +
            '<option value="">Export...</option>' +
            '<option value="png">PNG Image</option>' +
            '<option value="svg">SVG File</option>' +
          '</select>';
        container.appendChild(toolbar);

        var legend = document.createElement('div');
        legend.id = 'depgraph-legend';
        legend.style.cssText = 'padding:6px 20px;font-size:11px;color:var(--text-dim,#888);display:flex;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--border,#333);';
        container.appendChild(legend);

        var graphArea = document.createElement('div');
        graphArea.id = 'depgraph-area';
        graphArea.style.cssText = 'position:relative;min-height:600px;padding:20px;';
        container.appendChild(graphArea);

        var refreshBtn = toolbar.querySelector('#depgraph-refresh');
        if (refreshBtn) refreshBtn.addEventListener('click', function () { buildGraph(container); });

        var orphanCheck = toolbar.querySelector('#depgraph-orphans');
        if (orphanCheck) orphanCheck.addEventListener('change', function () { buildGraph(container); });

        var exportSelect = toolbar.querySelector('#depgraph-export');
        if (exportSelect) exportSelect.addEventListener('change', function () {
          var format = exportSelect.value;
          if (!format) return;
          exportSelect.value = '';
          exportGraph(format, graphArea);
        });

        buildGraph(container);
      }
    });
  }

  function buildGraph(container) {
    var statusEl = container.querySelector('#depgraph-status');
    var graphArea = container.querySelector('#depgraph-area');
    var legendEl = container.querySelector('#depgraph-legend');
    var orphanCheck = container.querySelector('#depgraph-orphans');
    var showOrphans = orphanCheck ? orphanCheck.checked : true;

    if (!graphArea) return;
    graphArea.innerHTML = '';
    if (legendEl) legendEl.innerHTML = '';
    if (statusEl) statusEl.textContent = 'Scanning...';

    var projectPath = state && state.projectPath;
    if (!projectPath) {
      if (statusEl) statusEl.textContent = 'No project open.';
      return;
    }

    api.files.tree(projectPath).then(function (tree) {
      var allFiles = flattenTree(Array.isArray(tree) ? tree : (tree && tree.children ? tree.children : []), '');

      // Filter JS/TS files, skip node_modules etc
      var skipDirs = ['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'coverage'];
      var jsFiles = [];
      var allPaths = [];
      for (var i = 0; i < allFiles.length; i++) {
        var f = allFiles[i];
        var norm = normalizePath(f.path);
        var skip = false;
        for (var s = 0; s < skipDirs.length; s++) {
          if (norm.indexOf(skipDirs[s] + '/') === 0 || norm.indexOf('/' + skipDirs[s] + '/') !== -1) {
            skip = true; break;
          }
        }
        if (skip) continue;
        allPaths.push(norm);
        if (JS_EXTS.indexOf(getExtension(norm)) !== -1) {
          jsFiles.push(norm);
        }
      }

      if (jsFiles.length === 0) {
        if (statusEl) statusEl.textContent = 'No JS/TS files found.';
        return;
      }

      if (jsFiles.length > 300) {
        jsFiles = jsFiles.slice(0, 300);
        if (statusEl) statusEl.textContent = 'Limiting to 300 files...';
      }

      // Read all files and parse imports
      var readPromises = [];
      for (var j = 0; j < jsFiles.length; j++) {
        (function (filePath) {
          readPromises.push(
            api.files.read(projectPath + '/' + filePath)
              .then(function (res) {
                return { path: filePath, content: res && res.content ? res.content : '' };
              })
              .catch(function () { return { path: filePath, content: '' }; })
          );
        })(jsFiles[j]);
      }

      Promise.all(readPromises).then(function (fileResults) {
        // Build adjacency map
        var edges = []; // {from, to}
        var nodeSet = {};
        var importedBy = {}; // who imports this file
        var importsFrom = {}; // what this file imports

        for (var k = 0; k < fileResults.length; k++) {
          var fr = fileResults[k];
          nodeSet[fr.path] = true;
          var rawImports = parseImports(fr.content);
          importsFrom[fr.path] = [];

          for (var m = 0; m < rawImports.length; m++) {
            var resolved = resolveImport(rawImports[m], fr.path, allPaths);
            if (resolved && resolved !== fr.path) {
              edges.push({ from: fr.path, to: resolved });
              nodeSet[resolved] = true;
              importsFrom[fr.path].push(resolved);
              if (!importedBy[resolved]) importedBy[resolved] = [];
              importedBy[resolved].push(fr.path);
            }
          }
        }

        var nodeList = Object.keys(nodeSet);

        // Identify orphans (no imports and not imported)
        var orphans = [];
        var connected = [];
        for (var n = 0; n < nodeList.length; n++) {
          var nd = nodeList[n];
          var hasImports = importsFrom[nd] && importsFrom[nd].length > 0;
          var isImported = importedBy[nd] && importedBy[nd].length > 0;
          if (!hasImports && !isImported) {
            orphans.push(nd);
          } else {
            connected.push(nd);
          }
        }

        var displayNodes = showOrphans ? nodeList : connected;

        // Directory color mapping
        var dirColorMap = {};
        var dirIdx = 0;
        for (var d = 0; d < displayNodes.length; d++) {
          var dir = getTopDir(displayNodes[d]);
          if (!dirColorMap[dir]) {
            dirColorMap[dir] = DIR_COLORS[dirIdx % DIR_COLORS.length];
            dirIdx++;
          }
        }

        // Render legend
        if (legendEl) {
          var dirs = Object.keys(dirColorMap);
          for (var lg = 0; lg < dirs.length; lg++) {
            var chip = document.createElement('span');
            chip.style.cssText = 'display:flex;align-items:center;gap:4px;';
            chip.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + dirColorMap[dirs[lg]] + ';"></span>' + escapeHtml(dirs[lg]);
            legendEl.appendChild(chip);
          }
          var orphanChip = document.createElement('span');
          orphanChip.style.cssText = 'display:flex;align-items:center;gap:4px;color:#e5484d;';
          orphanChip.textContent = 'Orphans: ' + orphans.length;
          legendEl.appendChild(orphanChip);
        }

        if (statusEl) statusEl.textContent = displayNodes.length + ' files, ' + edges.length + ' edges, ' + orphans.length + ' orphans';

        // ── Layout: simple force-directed-ish grid ──
        var positions = {};
        var cols = Math.max(Math.ceil(Math.sqrt(displayNodes.length)), 3);
        var cellW = 200;
        var cellH = 100;
        var marginX = 40;
        var marginY = 30;

        for (var p = 0; p < displayNodes.length; p++) {
          var col = p % cols;
          var row = Math.floor(p / cols);
          // Add some jitter so it looks more natural
          var jx = ((p * 37) % 30) - 15;
          var jy = ((p * 53) % 20) - 10;
          positions[displayNodes[p]] = {
            x: marginX + col * cellW + jx,
            y: marginY + row * cellH + jy
          };
        }

        var totalW = marginX * 2 + cols * cellW;
        var totalH = marginY * 2 + Math.ceil(displayNodes.length / cols) * cellH;
        graphArea.style.width = totalW + 'px';
        graphArea.style.height = totalH + 'px';

        // ── Draw edges as SVG lines ──
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', totalW);
        svg.setAttribute('height', totalH);
        svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';

        // Arrowhead marker
        var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', 'depgraph-arrow');
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '10');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '6');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('orient', 'auto');
        var arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
        arrowPath.setAttribute('fill', '#555');
        marker.appendChild(arrowPath);
        defs.appendChild(marker);
        svg.appendChild(defs);

        var nodeW = 150;
        var nodeH = 36;

        for (var e = 0; e < edges.length; e++) {
          var fromPos = positions[edges[e].from];
          var toPos = positions[edges[e].to];
          if (!fromPos || !toPos) continue;

          var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', fromPos.x + nodeW / 2);
          line.setAttribute('y1', fromPos.y + nodeH / 2);
          line.setAttribute('x2', toPos.x + nodeW / 2);
          line.setAttribute('y2', toPos.y + nodeH / 2);
          line.setAttribute('stroke', '#444');
          line.setAttribute('stroke-width', '1');
          line.setAttribute('marker-end', 'url(#depgraph-arrow)');
          line.setAttribute('opacity', '0.6');
          svg.appendChild(line);
        }
        graphArea.appendChild(svg);

        // ── Draw nodes ──
        for (var nd2 = 0; nd2 < displayNodes.length; nd2++) {
          var filePath = displayNodes[nd2];
          var pos = positions[filePath];
          if (!pos) continue;

          var isOrphan = orphans.indexOf(filePath) !== -1;
          var dir = getTopDir(filePath);
          var color = dirColorMap[dir] || '#8b949e';

          var nodeEl = document.createElement('div');
          nodeEl.className = 'depgraph-node';
          nodeEl.style.cssText = 'position:absolute;left:' + pos.x + 'px;top:' + pos.y + 'px;' +
            'width:' + nodeW + 'px;height:' + nodeH + 'px;' +
            'background:var(--surface,#1e1e26);' +
            'border:1.5px solid ' + (isOrphan ? '#e5484d' : color) + ';' +
            'border-radius:6px;' +
            'display:flex;align-items:center;justify-content:center;' +
            'padding:4px 8px;box-sizing:border-box;' +
            'cursor:pointer;font-size:10px;font-family:var(--font-mono,monospace);' +
            'color:var(--text,#ccc);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
            'transition:transform 0.15s,box-shadow 0.15s;z-index:1;' +
            (isOrphan ? 'opacity:0.6;border-style:dashed;' : '');

          nodeEl.title = filePath + (isOrphan ? ' (orphan)' : '') +
            (importedBy[filePath] ? '\nImported by: ' + importedBy[filePath].join(', ') : '') +
            (importsFrom[filePath] && importsFrom[filePath].length ? '\nImports: ' + importsFrom[filePath].join(', ') : '');

          nodeEl.textContent = getBaseName(filePath);

          nodeEl.addEventListener('mouseenter', function () {
            this.style.transform = 'scale(1.08)';
            this.style.boxShadow = '0 2px 12px rgba(0,0,0,0.4)';
            this.style.zIndex = '10';
          });
          nodeEl.addEventListener('mouseleave', function () {
            this.style.transform = '';
            this.style.boxShadow = '';
            this.style.zIndex = '1';
          });

          (function (fp) {
            nodeEl.addEventListener('click', function () {
              if (PiPilot.editor && PiPilot.editor.openFile) {
                var fullPath = (projectPath + '/' + fp).replace(/\/\//g, '/');
                PiPilot.editor.openFile(fullPath);
              }
            });
          })(filePath);

          graphArea.appendChild(nodeEl);
        }

      }).catch(function (err) {
        if (statusEl) statusEl.textContent = 'Error reading files: ' + (err && err.message ? err.message : err);
      });

    }).catch(function (err) {
      if (statusEl) statusEl.textContent = 'Error scanning project: ' + (err && err.message ? err.message : err);
    });
  }

  console.log('[ext:dependency-graph] loaded');
})(PiPilot, bus, api, state, db);
