// PiPilot IDE Extension: Project Stats Dashboard
// Activity bar button opens a virtual tab with project statistics:
// total files, LOC, language breakdown, largest files, dependency count.

(function (PiPilot, bus, api, state, db) {

  // ── Activity bar button ──
  var actBar = document.getElementById('activity-bar');
  if (actBar) {
    var btn = document.createElement('button');
    btn.className = 'activity-btn';
    btn.title = 'Project Stats';
    btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 17V11"/><path d="M12 17V7"/><path d="M16 17V13"/></svg>';
    btn.addEventListener('click', openDashboard);
    actBar.insertBefore(btn, actBar.lastElementChild);
  }

  // ── Language detection by extension ──
  var EXT_LANG = {
    '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
    '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript',
    '.py': 'Python', '.pyw': 'Python',
    '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
    '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust',
    '.c': 'C', '.h': 'C', '.cpp': 'C++', '.hpp': 'C++', '.cc': 'C++',
    '.cs': 'C#', '.swift': 'Swift', '.php': 'PHP',
    '.html': 'HTML', '.htm': 'HTML', '.vue': 'Vue',
    '.css': 'CSS', '.scss': 'SCSS', '.sass': 'Sass', '.less': 'Less',
    '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML',
    '.xml': 'XML', '.svg': 'SVG',
    '.md': 'Markdown', '.mdx': 'MDX',
    '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell', '.bat': 'Batch', '.ps1': 'PowerShell',
    '.sql': 'SQL', '.graphql': 'GraphQL', '.gql': 'GraphQL',
    '.r': 'R', '.lua': 'Lua', '.dart': 'Dart', '.ex': 'Elixir', '.exs': 'Elixir',
    '.zig': 'Zig', '.nim': 'Nim', '.v': 'V', '.sol': 'Solidity',
    '.svelte': 'Svelte', '.astro': 'Astro',
  };

  function getExtension(path) {
    var m = path.match(/(\.[^.\\/]+)$/);
    return m ? m[1].toLowerCase() : '';
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

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

  // ── Color palette for charts ──
  var COLORS = [
    '#FF6B35', '#58a6ff', '#56d364', '#e5a639', '#e5484d',
    '#bc8cff', '#39d0d6', '#f778ba', '#8b949e', '#79c0ff',
    '#7ee787', '#d2a8ff', '#ffa657', '#ff7b72', '#a5d6ff'
  ];

  function openDashboard() {
    PiPilot.editor.openVirtualTab({
      id: 'ext://project-stats',
      name: 'Project Stats',
      mount: function (container) {
        container.innerHTML = '';
        container.style.cssText = 'overflow:auto;padding:24px 32px;font-family:var(--font-sans);color:var(--text);background:var(--bg);';

        var wrapper = document.createElement('div');
        wrapper.style.cssText = 'max-width:900px;margin:0 auto;';
        wrapper.innerHTML = '<h2 style="color:var(--text-strong);margin:0 0 24px 0;font-size:20px;">\uD83D\uDCCA Project Statistics</h2>' +
          '<div id="pstats-loading" style="color:var(--text-dim);font-size:13px;">Scanning project files...</div>' +
          '<div id="pstats-content" style="display:none;"></div>';
        container.appendChild(wrapper);

        scanProject(wrapper);
      }
    });
  }

  function scanProject(wrapper) {
    var projectPath = state && state.projectPath;
    if (!projectPath) {
      var loading = wrapper.querySelector('#pstats-loading');
      if (loading) loading.textContent = 'No project open.';
      return;
    }

    // Fetch tree
    var treePromise = api.files.tree(projectPath);

    // Try to read package.json
    var pkgPromise = api.files.read(projectPath + '/package.json').catch(function () { return null; });

    Promise.all([treePromise, pkgPromise]).then(function (results) {
      var tree = results[0];
      var pkgResult = results[1];

      var allFiles = flattenTree(Array.isArray(tree) ? tree : (tree && tree.children ? tree.children : []), '');

      // Filter out common non-code directories
      var skipDirs = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.cache', 'coverage', '.turbo'];
      var files = allFiles.filter(function (f) {
        for (var i = 0; i < skipDirs.length; i++) {
          if (f.path.indexOf(skipDirs[i] + '/') === 0 || f.path.indexOf('/' + skipDirs[i] + '/') >= 0) return false;
        }
        return true;
      });

      // Language breakdown
      var langCount = {};
      var langFiles = {};
      var totalFiles = files.length;
      var codeFiles = 0;

      for (var i = 0; i < files.length; i++) {
        var ext = getExtension(files[i].name);
        var lang = EXT_LANG[ext];
        if (lang) {
          codeFiles++;
          langCount[lang] = (langCount[lang] || 0) + 1;
          if (!langFiles[lang]) langFiles[lang] = [];
          langFiles[lang].push(files[i]);
        }
      }

      // Sort languages by count
      var langs = Object.keys(langCount).sort(function (a, b) { return langCount[b] - langCount[a]; });

      // Top 10 largest files
      var sortedBySize = files.slice().sort(function (a, b) { return (b.size || 0) - (a.size || 0); });
      var top10 = sortedBySize.slice(0, 10);

      // Dependencies from package.json
      var depCount = 0;
      var devDepCount = 0;
      if (pkgResult && pkgResult.content) {
        try {
          var pkg = JSON.parse(pkgResult.content);
          depCount = pkg.dependencies ? Object.keys(pkg.dependencies).length : 0;
          devDepCount = pkg.devDependencies ? Object.keys(pkg.devDependencies).length : 0;
        } catch (e) {}
      }

      // ── Render ──
      var loading = wrapper.querySelector('#pstats-loading');
      var content = wrapper.querySelector('#pstats-content');
      if (loading) loading.style.display = 'none';
      if (content) content.style.display = 'block';

      var html = '';

      // Summary cards
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:28px;">';
      html += statCard('Total Files', totalFiles, '\uD83D\uDCC1');
      html += statCard('Code Files', codeFiles, '\uD83D\uDCDD');
      html += statCard('Languages', langs.length, '\uD83C\uDF10');
      html += statCard('Dependencies', depCount, '\uD83D\uDCE6');
      html += statCard('Dev Dependencies', devDepCount, '\uD83D\uDD27');
      html += '</div>';

      // Language breakdown bar chart
      if (langs.length > 0) {
        html += '<h3 style="color:var(--text-strong);font-size:15px;margin:0 0 12px 0;">Language Breakdown</h3>';
        html += '<div style="margin-bottom:28px;">';
        var maxCount = langCount[langs[0]];
        for (var j = 0; j < langs.length && j < 15; j++) {
          var lang = langs[j];
          var count = langCount[lang];
          var pct = Math.round((count / codeFiles) * 100);
          var barWidth = Math.max(4, Math.round((count / maxCount) * 100));
          var color = COLORS[j % COLORS.length];
          html += '<div style="display:flex;align-items:center;margin-bottom:6px;font-size:12px;">';
          html += '<span style="width:100px;color:var(--text-mid);text-align:right;padding-right:10px;flex-shrink:0;">' + escapeHtml(lang) + '</span>';
          html += '<div style="flex:1;display:flex;align-items:center;gap:8px;">';
          html += '<div style="height:18px;width:' + barWidth + '%;background:' + color + ';border-radius:3px;min-width:4px;transition:width 0.3s;"></div>';
          html += '<span style="color:var(--text-dim);font-size:11px;white-space:nowrap;">' + count + ' files (' + pct + '%)</span>';
          html += '</div></div>';
        }
        html += '</div>';
      }

      // Top 10 largest files
      if (top10.length > 0) {
        html += '<h3 style="color:var(--text-strong);font-size:15px;margin:0 0 12px 0;">Top 10 Largest Files</h3>';
        html += '<div style="margin-bottom:28px;">';
        for (var k = 0; k < top10.length; k++) {
          var f = top10[k];
          html += '<div style="display:flex;justify-content:space-between;padding:4px 8px;font-size:12px;border-bottom:1px solid var(--border);cursor:pointer;" data-filepath="' + escapeHtml(f.path) + '">';
          html += '<span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;">' + escapeHtml(f.path) + '</span>';
          html += '<span style="color:var(--text-dim);flex-shrink:0;padding-left:12px;">' + formatSize(f.size || 0) + '</span>';
          html += '</div>';
        }
        html += '</div>';
      }

      if (content) {
        content.innerHTML = html;

        // Click handlers for file links
        var fileRows = content.querySelectorAll('[data-filepath]');
        for (var r = 0; r < fileRows.length; r++) {
          fileRows[r].addEventListener('click', (function (p) {
            return function () {
              var fullPath = projectPath + '/' + p;
              PiPilot.editor.openFile(fullPath);
            };
          })(fileRows[r].getAttribute('data-filepath')));
        }
      }
    }).catch(function (err) {
      var loading = wrapper.querySelector('#pstats-loading');
      if (loading) loading.textContent = 'Error scanning project: ' + (err.message || err);
    });
  }

  function statCard(label, value, icon) {
    return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;text-align:center;">' +
      '<div style="font-size:22px;margin-bottom:4px;">' + icon + '</div>' +
      '<div style="font-size:24px;font-weight:700;color:var(--text-strong);">' + value + '</div>' +
      '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + escapeHtml(label) + '</div>' +
      '</div>';
  }

  console.log('[ext:project-stats] loaded');
})(PiPilot, bus, api, state, db);
