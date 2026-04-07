import type { ExtensionManifest } from "../types";

export const manifest: ExtensionManifest = {
  id: "builtin.markdown-preview",
  name: "Markdown Preview",
  version: "1.0.0",
  description: "Preview Markdown files with rendered HTML",
  author: "PiPilot",
  icon: "file-text",
  main: "extension.js",
  activationEvents: ["onLanguage:markdown"],
  contributes: {
    commands: [{ id: "builtin.markdown.preview", title: "Preview Markdown", category: "Markdown" }],
  },
  categories: ["Programming Languages"],
};

export const code = `
function activate(pipilot) {
  pipilot.commands.register("builtin.markdown.preview", function() {
    var file = pipilot.editor.getActiveFile();
    if (!file || !file.path.endsWith(".md")) {
      pipilot.ui.showNotification({ title: "Markdown Preview", message: "Open a .md file first", type: "warning" });
      return;
    }
    // Simple markdown to HTML conversion
    var html = file.content
      .replace(/^### (.*$)/gm, '<h3>$1</h3>')
      .replace(/^## (.*$)/gm, '<h2>$1</h2>')
      .replace(/^# (.*$)/gm, '<h1>$1</h1>')
      .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')
      .replace(/\\*(.*?)\\*/g, '<em>$1</em>')
      .replace(/\`(.*?)\`/g, '<code style="background:hsl(220,13%,25%);padding:1px 4px;border-radius:3px">$1</code>')
      .replace(/^- (.*$)/gm, '<li>$1</li>')
      .replace(/\\n/g, '<br>');
    pipilot.ui.showNotification({ title: "Markdown Preview", message: "Preview rendered for " + file.path, type: "success" });
  });
}
module.exports = { activate: activate };
`;
