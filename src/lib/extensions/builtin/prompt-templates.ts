import type { ExtensionManifest } from "../types";

export const manifest: ExtensionManifest = {
  id: "builtin.prompt-templates",
  name: "Prompt Templates",
  version: "1.0.0",
  description: "Quick AI prompt templates via /template command",
  author: "PiPilot",
  icon: "message-square-plus",
  main: "extension.js",
  activationEvents: ["*"],
  contributes: {
    chatCommands: [{ name: "template", description: "Insert a prompt template (refactor, test, explain, review, optimize)" }],
  },
  categories: ["AI"],
  featured: true,
};

export const code = `
function activate(pipilot) {
  var templates = {
    refactor: "Please refactor the current code to improve readability, reduce complexity, and follow best practices. Keep the same functionality.",
    test: "Please write comprehensive tests for the current code. Cover edge cases, error handling, and normal operation.",
    explain: "Please explain this code in detail. What does it do? How does it work? What are the key concepts?",
    review: "Please review this code for bugs, security issues, performance problems, and suggest improvements.",
    optimize: "Please optimize this code for better performance. Identify bottlenecks and suggest faster alternatives.",
    document: "Please add comprehensive JSDoc comments and documentation to this code.",
    debug: "I'm having an issue with this code. Please help me identify and fix any bugs.",
  };

  pipilot.chat.addSlashCommand({
    name: "template",
    description: "Insert a prompt template",
    handler: function(args) {
      var key = (args || "").trim().toLowerCase();
      if (!key || !templates[key]) {
        var available = Object.keys(templates).join(", ");
        return Promise.resolve("Available templates: " + available + "\\n\\nUsage: /template <name>");
      }
      return Promise.resolve(templates[key]);
    }
  });

  pipilot.terminal.registerCommand("templates", function() {
    var lines = ["Available prompt templates:"];
    Object.keys(templates).forEach(function(k) {
      lines.push("  " + k + " - " + templates[k].slice(0, 60) + "...");
    });
    return Promise.resolve(lines.join("\\n"));
  });
}
module.exports = { activate: activate };
`;
