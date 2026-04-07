import type { ExtensionManifest } from "../types";

export const manifest: ExtensionManifest = {
  id: "builtin.bookmarks",
  name: "File Bookmarks",
  version: "1.0.0",
  description: "Bookmark files for quick access",
  author: "PiPilot",
  icon: "bookmark",
  main: "extension.js",
  activationEvents: ["*"],
  contributes: {
    activityBarItems: [{ id: "bookmarks", icon: "bookmark", title: "Bookmarks" }],
    sidebarPanels: [{ id: "bookmarks", title: "Bookmarks" }],
    commands: [
      { id: "builtin.bookmarks.toggle", title: "Toggle Bookmark", category: "Bookmarks" },
      { id: "builtin.bookmarks.clear", title: "Clear All Bookmarks", category: "Bookmarks" },
    ],
  },
  categories: ["Other"],
  featured: true,
};

export const code = `
function activate(pipilot) {
  pipilot.commands.register("builtin.bookmarks.toggle", function() {
    var file = pipilot.editor.getActiveFile();
    if (!file) return;
    pipilot.state.get("bookmarks").then(function(bookmarks) {
      bookmarks = bookmarks || [];
      var idx = bookmarks.indexOf(file.path);
      if (idx >= 0) {
        bookmarks.splice(idx, 1);
        pipilot.ui.showNotification({ title: "Bookmark Removed", message: file.path, type: "info" });
      } else {
        bookmarks.push(file.path);
        pipilot.ui.showNotification({ title: "Bookmark Added", message: file.path, type: "success" });
      }
      pipilot.state.set("bookmarks", bookmarks);
    });
  });

  pipilot.commands.register("builtin.bookmarks.clear", function() {
    pipilot.state.set("bookmarks", []);
    pipilot.ui.showNotification({ title: "Bookmarks Cleared", message: "All bookmarks removed", type: "info" });
  });

  pipilot.ui.registerSidebarPanel("builtin.bookmarks.bookmarks", function(el) {
    el.style.padding = "12px";
    el.style.color = "hsl(220, 14%, 75%)";
    el.style.fontSize = "12px";

    function render() {
      pipilot.state.get("bookmarks").then(function(bookmarks) {
        bookmarks = bookmarks || [];
        if (bookmarks.length === 0) {
          el.innerHTML = '<div style="text-align:center;padding:20px;color:hsl(220,14%,45%)">No bookmarks yet.<br><br>Use the command palette to bookmark files.</div>';
          return;
        }
        var html = '<div style="margin-bottom:8px;font-weight:600;color:hsl(220,14%,65%)">Bookmarked Files</div>';
        bookmarks.forEach(function(path) {
          html += '<div style="padding:4px 8px;cursor:pointer;border-radius:4px;margin:2px 0;background:hsl(220,13%,20%)" onmouseover="this.style.background=\\'hsl(220,13%,25%)\\'" onmouseout="this.style.background=\\'hsl(220,13%,20%)\\'">' + path + '</div>';
        });
        el.innerHTML = html;
      });
    }
    render();
    var interval = setInterval(render, 3000);
    return function() { clearInterval(interval); };
  });
}
module.exports = { activate: activate };
`;
