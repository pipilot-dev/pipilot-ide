import type { ExtensionManifest } from "../types";

export const manifest: ExtensionManifest = {
  id: "builtin.word-counter",
  name: "Word Counter",
  version: "1.0.0",
  description: "Shows word and character count in the status bar",
  author: "PiPilot",
  icon: "hash",
  main: "extension.js",
  activationEvents: ["*"],
  contributes: {
    statusBarItems: [{
      id: "wordCount",
      text: "Words: 0",
      icon: "hash",
      alignment: "right",
      priority: 200,
    }],
  },
  categories: ["Other"],
  featured: true,
};

export const code = `
function activate(pipilot) {
  function update() {
    var file = pipilot.editor.getActiveFile();
    if (file && file.content) {
      var words = file.content.trim().split(/\\s+/).filter(function(w) { return w.length > 0; }).length;
      var chars = file.content.length;
      pipilot.ui.updateStatusBarItem("wordCount", { text: "Words: " + words + " | Chars: " + chars });
    } else {
      pipilot.ui.updateStatusBarItem("wordCount", { text: "Words: —" });
    }
  }
  update();
  pipilot.editor.onActiveFileChange(update);
}
module.exports = { activate: activate };
`;
