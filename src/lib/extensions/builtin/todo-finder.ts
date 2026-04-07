import type { ExtensionManifest } from "../types";

export const manifest: ExtensionManifest = {
  id: "builtin.todo-finder",
  name: "Todo Finder",
  version: "1.0.0",
  description: "Find all TODO and FIXME comments in your project",
  author: "PiPilot",
  icon: "list-checks",
  main: "extension.js",
  activationEvents: ["*"],
  contributes: {
    commands: [{ id: "builtin.todos.find", title: "Find All TODOs", category: "Todo Finder" }],
    activityBarItems: [{ id: "todos", icon: "list-checks", title: "TODOs" }],
    sidebarPanels: [{ id: "todos", title: "TODOs" }],
  },
  categories: ["Productivity"],
  featured: true,
};

export const code = `
function activate(pipilot) {
  var todos = [];

  function scan() {
    return pipilot.workspace.files.list("").then(function(files) {
      var promises = files.filter(function(f) { return f.type === "file"; }).map(function(f) {
        return pipilot.workspace.files.read(f.name).then(function(content) {
          var lines = content.split("\\n");
          var results = [];
          lines.forEach(function(line, i) {
            if (/\\/\\/\\s*(TODO|FIXME|HACK|XXX|BUG)/i.test(line)) {
              results.push({ file: f.name, line: i + 1, text: line.trim() });
            }
          });
          return results;
        }).catch(function() { return []; });
      });
      return Promise.all(promises).then(function(results) {
        todos = [];
        results.forEach(function(r) { todos = todos.concat(r); });
        return todos;
      });
    });
  }

  pipilot.commands.register("builtin.todos.find", function() {
    return scan().then(function(found) {
      pipilot.ui.showNotification({ title: "Todo Finder", message: "Found " + found.length + " TODOs", type: "info" });
    });
  });

  pipilot.ui.registerSidebarPanel("builtin.todo-finder.todos", function(el) {
    el.style.padding = "12px";
    el.style.color = "hsl(220, 14%, 75%)";
    el.style.fontSize = "12px";

    function render() {
      scan().then(function(items) {
        if (items.length === 0) {
          el.innerHTML = '<div style="text-align:center;padding:20px;color:hsl(220,14%,45%)">No TODOs found.<br><br>Add TODO, FIXME, or HACK comments to your code.</div>';
          return;
        }
        var html = '<div style="margin-bottom:8px;font-weight:600;color:hsl(220,14%,65%)">' + items.length + ' TODOs Found</div>';
        items.forEach(function(item) {
          html += '<div style="padding:6px 8px;margin:3px 0;background:hsl(220,13%,20%);border-radius:4px;cursor:pointer" title="' + item.file + ':' + item.line + '">';
          html += '<div style="font-size:10px;color:hsl(207,90%,60%);margin-bottom:2px">' + item.file + ':' + item.line + '</div>';
          html += '<div style="font-size:11px;color:hsl(220,14%,70%);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + item.text.replace(/</g,"&lt;") + '</div>';
          html += '</div>';
        });
        el.innerHTML = html;
      });
    }
    render();
    var interval = setInterval(render, 10000);
    return function() { clearInterval(interval); };
  });
}
module.exports = { activate: activate };
`;
