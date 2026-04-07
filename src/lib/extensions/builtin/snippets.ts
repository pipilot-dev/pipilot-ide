import type { ExtensionManifest } from "../types";

export const manifest: ExtensionManifest = {
  id: "builtin.snippets",
  name: "Snippet Manager",
  version: "1.0.0",
  description: "Save and reuse code snippets",
  author: "PiPilot",
  icon: "scissors",
  main: "extension.js",
  activationEvents: ["*"],
  contributes: {
    commands: [
      { id: "builtin.snippets.save", title: "Save Selection as Snippet", category: "Snippets" },
      { id: "builtin.snippets.list", title: "List Snippets", category: "Snippets" },
    ],
    activityBarItems: [{ id: "snippets", icon: "scissors", title: "Snippets" }],
    sidebarPanels: [{ id: "snippets", title: "Snippets" }],
  },
  categories: ["Productivity"],
};

export const code = `
function activate(pipilot) {
  pipilot.commands.register("builtin.snippets.save", function() {
    var file = pipilot.editor.getActiveFile();
    if (!file) {
      pipilot.ui.showNotification({ title: "Snippets", message: "No file open", type: "warning" });
      return;
    }
    var name = "snippet-" + Date.now().toString(36);
    var content = file.content.slice(0, 500);
    pipilot.state.get("snippets").then(function(snippets) {
      snippets = snippets || [];
      snippets.unshift({ name: name, content: content, language: file.language, createdAt: new Date().toISOString() });
      pipilot.state.set("snippets", snippets);
      pipilot.ui.showNotification({ title: "Snippet Saved", message: name, type: "success" });
    });
  });

  pipilot.terminal.registerCommand("snippets", function(args) {
    return pipilot.state.get("snippets").then(function(snippets) {
      snippets = snippets || [];
      if (snippets.length === 0) return "No snippets saved. Use the command palette to save snippets.";
      var lines = ["Saved snippets (" + snippets.length + "):"];
      snippets.forEach(function(s, i) {
        lines.push("  [" + i + "] " + s.name + " (" + (s.language || "text") + ") - " + s.content.slice(0, 40).replace(/\\n/g, " ") + "...");
      });
      return lines.join("\\n");
    });
  });

  pipilot.ui.registerSidebarPanel("builtin.snippets.snippets", function(el) {
    el.style.padding = "12px";
    el.style.color = "hsl(220, 14%, 75%)";
    el.style.fontSize = "12px";

    function render() {
      pipilot.state.get("snippets").then(function(snippets) {
        snippets = snippets || [];
        if (snippets.length === 0) {
          el.innerHTML = '<div style="text-align:center;padding:20px;color:hsl(220,14%,45%)">No snippets yet.<br><br>Save code from the editor using the command palette.</div>';
          return;
        }
        var html = '<div style="margin-bottom:8px;font-weight:600;color:hsl(220,14%,65%)">' + snippets.length + ' Snippets</div>';
        snippets.forEach(function(s) {
          html += '<div style="padding:6px 8px;margin:3px 0;background:hsl(220,13%,20%);border-radius:4px">';
          html += '<div style="font-size:11px;font-weight:500;color:hsl(207,90%,60%);margin-bottom:2px">' + s.name + '</div>';
          html += '<div style="font-size:10px;color:hsl(220,14%,50%);margin-bottom:4px">' + (s.language || "text") + '</div>';
          html += '<pre style="font-size:10px;color:hsl(220,14%,60%);margin:0;white-space:pre-wrap;max-height:60px;overflow:hidden">' + s.content.slice(0, 200).replace(/</g,"&lt;") + '</pre>';
          html += '</div>';
        });
        el.innerHTML = html;
      });
    }
    render();
    var interval = setInterval(render, 5000);
    return function() { clearInterval(interval); };
  });
}
module.exports = { activate: activate };
`;
