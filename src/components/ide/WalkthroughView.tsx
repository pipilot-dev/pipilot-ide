/**
 * WalkthroughView — multi-step interactive onboarding flow rendered
 * inside an editor tab. Two walkthroughs:
 *   1. "Get Started" — workspace, editor, file tree, terminal basics
 *   2. "AI Power" — AI chat, agent modes, generate, preview & deploy
 *
 * Each step has a rich description, an illustration area, and an
 * action button that triggers the relevant IDE feature. Progress is
 * persisted to localStorage.
 */

import { useState, useEffect, useMemo } from "react";
import {
  FolderOpen, FileText, Terminal, MessageSquare, Sparkles, Play,
  ChevronLeft, ChevronRight, CheckCircle2, Circle, Rocket, Eye,
  PanelLeft, Search, Keyboard, Settings,
} from "lucide-react";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

const F = { d: FONTS.display, m: FONTS.mono, s: FONTS.sans };

interface Step {
  title: string;
  description: string;
  detail: string;
  icon: React.ReactNode;
  accentColor: string;
  actionLabel?: string;
  action?: () => void;
}

interface WalkthroughViewProps {
  walkthroughId: string;
  onOpenPreview?: () => void;
}

export function WalkthroughView({ walkthroughId, onOpenPreview }: WalkthroughViewProps) {
  useEffect(() => { injectFonts(); }, []);

  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem(`pipilot-wt-${walkthroughId}`);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  useEffect(() => {
    localStorage.setItem(`pipilot-wt-${walkthroughId}`, JSON.stringify([...completedSteps]));
  }, [completedSteps, walkthroughId]);

  const markDone = (i: number) => setCompletedSteps((p) => new Set([...p, i]));

  const steps: Step[] = useMemo(() => {
    if (walkthroughId === "get-started") return [
      {
        title: "Welcome to PiPilot IDE",
        description: "Your AI-native code editor. Let\u2019s take a quick tour of the essentials.",
        detail: "PiPilot is a full-featured IDE that runs in your browser. It combines a powerful code editor, integrated terminal, file explorer, and an AI assistant \u2014 all in one workspace.\n\nThis walkthrough will guide you through the core features so you can start building right away.",
        icon: <Rocket size={28} />,
        accentColor: C.accent,
      },
      {
        title: "Open a Folder",
        description: "Connect PiPilot to any directory on your machine.",
        detail: "Click \u201cOpen Folder\u201d to link a directory from your disk. PiPilot will watch the files in real-time \u2014 edits you make in the IDE appear on disk instantly, and vice versa.\n\nYou can also create a new project from scratch using File \u2192 New File or the Generate with AI flow on the Welcome page.",
        icon: <FolderOpen size={28} />,
        accentColor: "#60a5fa",
        actionLabel: "Open a Folder",
        action: () => window.dispatchEvent(new CustomEvent("pipilot:open-folder")),
      },
      {
        title: "Explore the File Tree",
        description: "Navigate your project files using the sidebar explorer.",
        detail: "The file tree on the left shows your project structure. Click any file to open it in a tab. You can:\n\n\u2022 Right-click for context menu (rename, delete, duplicate)\n\u2022 Drag to select multiple files\n\u2022 Ctrl/Cmd+Click to multi-select\n\u2022 Use \u2318B to toggle the sidebar\n\u2022 Use \u2318P to quick-open any file by name",
        icon: <PanelLeft size={28} />,
        accentColor: "#a78bfa",
        actionLabel: "Toggle Sidebar (\u2318B)",
        action: () => window.dispatchEvent(new CustomEvent("pipilot:toggle-sidebar")),
      },
      {
        title: "Edit Code",
        description: "A full-featured editor with syntax highlighting, auto-complete, and multi-tab support.",
        detail: "The editor supports TypeScript, JavaScript, Python, Go, Rust, and many more languages with syntax highlighting and basic IntelliSense.\n\n\u2022 Auto-save is always on \u2014 every keystroke is persisted\n\u2022 \u2318S shows a confirmation toast\n\u2022 \u2318F to find, \u2318H to find and replace\n\u2022 \u2318Z / \u2318\u21e7Z for undo / redo\n\u2022 Multiple tabs with drag-to-reorder and pin support",
        icon: <FileText size={28} />,
        accentColor: "#34d399",
      },
      {
        title: "Use the Terminal",
        description: "Run commands, install packages, and manage your project.",
        detail: "Press \u2318` (backtick) to toggle the integrated terminal. It\u2019s a real PTY connected to your system shell \u2014 you can run npm, git, python, or any CLI tool.\n\nFor linked projects, the terminal opens in the project\u2019s directory. For workspace projects, it opens in the server\u2019s workspace folder.",
        icon: <Terminal size={28} />,
        accentColor: "#fbbf24",
        actionLabel: "Open Terminal (\u2318`)",
        action: () => window.dispatchEvent(new CustomEvent("pipilot:toggle-terminal")),
      },
      {
        title: "You\u2019re Ready!",
        description: "You know the basics. Time to build something amazing.",
        detail: "That\u2019s the core of PiPilot IDE. Here\u2019s a quick cheat sheet:\n\n\u2318P \u2014 Quick Open / Command Palette\n\u2318B \u2014 Toggle Sidebar\n\u2318` \u2014 Toggle Terminal\n\u2318\u21e7I \u2014 Toggle AI Chat\n\u2318, \u2014 Settings\n\nCheck out the \u201cAI Power User\u201d walkthrough next to learn how the AI agent can write code for you!",
        icon: <CheckCircle2 size={28} />,
        accentColor: "#22c55e",
      },
    ];

    // AI Power User walkthrough
    return [
      {
        title: "Meet the AI Agent",
        description: "PiPilot\u2019s AI assistant can build, edit, and refactor your entire project.",
        detail: "The AI Chat panel (\u2318\u21e7I) connects you to PiPilot Agent \u2014 an autonomous coding assistant that can read your files, create new ones, edit existing code, run scripts, and more.\n\nIt works in two modes:\n\u2022 Agent mode \u2014 autonomous building (reads, writes, creates files)\n\u2022 Plan mode \u2014 research and planning only (no file changes)",
        icon: <MessageSquare size={28} />,
        accentColor: "#818cf8",
        actionLabel: "Open AI Chat (\u2318\u21e7I)",
        action: () => window.dispatchEvent(new CustomEvent("pipilot:open-chat")),
      },
      {
        title: "Generate a Project from a Prompt",
        description: "Describe what you want and the agent scaffolds it from scratch.",
        detail: "From the Welcome page, click \u201cGenerate with AI\u201d and describe your project. PiPilot will:\n\n1. Create a new blank workspace\n2. Open the AI chat\n3. Send your description to the agent\n4. The agent creates all the files, installs dependencies, and sets up the project structure\n\nYou can also type directly in the chat to ask for changes at any time.",
        icon: <Sparkles size={28} />,
        accentColor: C.accent,
      },
      {
        title: "Attach Files for Context",
        description: "Give the AI context by attaching files to your message.",
        detail: "In the chat input, type @ to mention a file from your project. The file\u2019s content will be included as context with your message.\n\nYou can also:\n\u2022 Drag files from the explorer into the chat\n\u2022 Attach the Problems panel output to ask for bug fixes\n\u2022 Attach entire folders for broader context",
        icon: <Search size={28} />,
        accentColor: "#f472b6",
      },
      {
        title: "Watch Real-Time Changes",
        description: "The agent writes files on disk \u2014 you see changes instantly.",
        detail: "When the agent creates or edits files, you\u2019ll see:\n\n\u2022 Tool pills in the chat showing each action (create, edit, delete)\n\u2022 The file tree updating in real-time\n\u2022 Open editor tabs refreshing with new content\n\u2022 The terminal available for running the result\n\nThe agent can also take screenshots of your preview and iterate on the design visually.",
        icon: <Eye size={28} />,
        accentColor: "#fb923c",
      },
      {
        title: "Preview & Deploy",
        description: "See your work live and share it with the world.",
        detail: "Click the Play button in the sidebar or use the Web Preview tab to see your project running in an embedded browser.\n\nFor linked projects with a dev server (Vite, Next.js, Express), PiPilot auto-detects and starts it.\n\nWhen you\u2019re ready, use the Deploy feature to publish your static site to free hosting with one click.",
        icon: <Play size={28} />,
        accentColor: "#22d3ee",
        actionLabel: "Open Preview",
        action: () => onOpenPreview?.(),
      },
      {
        title: "You\u2019re an AI Power User!",
        description: "You now know how to leverage AI for maximum productivity.",
        detail: "Tips for getting the best results:\n\n\u2022 Be specific in your prompts \u2014 mention frameworks, styles, and features\n\u2022 Use Plan mode first for complex tasks, then switch to Agent mode\n\u2022 Attach relevant files so the AI has full context\n\u2022 Use \u201cContinue\u201d to resume interrupted sessions\n\u2022 Check the chat session picker to revisit past conversations\n\nHappy building!",
        icon: <Rocket size={28} />,
        accentColor: "#a855f7",
      },
    ];
  }, [walkthroughId, onOpenPreview]);

  const step = steps[currentStep];
  const isDone = completedSteps.has(currentStep);
  const allDone = steps.every((_, i) => completedSteps.has(i));
  const progress = steps.length > 0 ? completedSteps.size / steps.length : 0;

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      background: C.bg, color: C.text, fontFamily: F.s,
      overflow: "hidden",
    }}>
      {/* ── Top progress bar ── */}
      <div style={{ height: 2, background: C.surfaceAlt }}>
        <div style={{
          height: "100%", width: `${progress * 100}%`,
          background: `linear-gradient(90deg, ${C.accent}, ${step.accentColor})`,
          transition: "width 0.4s ease",
        }} />
      </div>

      {/* ── Main content ── */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        maxWidth: 720, width: "100%", margin: "0 auto",
        padding: "48px 40px 32px",
        overflow: "hidden auto",
      }}>
        {/* Step indicator */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          fontFamily: F.m, fontSize: 10, color: C.textDim,
          letterSpacing: "0.08em", textTransform: "uppercase",
          marginBottom: 32,
        }}>
          {steps.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setCurrentStep(i)}
              style={{
                width: i === currentStep ? 28 : 8, height: 8,
                borderRadius: 4, border: "none", cursor: "pointer",
                background: completedSteps.has(i)
                  ? "#22c55e"
                  : i === currentStep
                    ? step.accentColor
                    : C.surfaceAlt,
                transition: "all 0.3s ease",
                opacity: i === currentStep ? 1 : 0.7,
              }}
              title={`Step ${i + 1}: ${steps[i].title}`}
            />
          ))}
          <span style={{ marginLeft: 8 }}>
            Step {currentStep + 1} of {steps.length}
          </span>
        </div>

        {/* Icon + Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: `${step.accentColor}18`,
            border: `1px solid ${step.accentColor}30`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: step.accentColor, flexShrink: 0,
            transition: "all 0.3s ease",
          }}>
            {step.icon}
          </div>
          <div>
            <h2 style={{
              fontFamily: F.d, fontSize: 28, fontWeight: 400,
              lineHeight: 1.1, color: C.text, margin: 0,
            }}>
              {step.title}
            </h2>
            <p style={{
              fontFamily: F.s, fontSize: 13, color: C.textMid,
              margin: "6px 0 0", lineHeight: 1.4,
            }}>
              {step.description}
            </p>
          </div>
        </div>

        {/* Detail content */}
        <div style={{
          marginTop: 24, padding: "20px 24px",
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 8,
          fontFamily: F.s, fontSize: 13, color: C.textMid,
          lineHeight: 1.75, whiteSpace: "pre-line",
        }}>
          {step.detail}
        </div>

        {/* Action button */}
        {step.actionLabel && step.action && (
          <button
            type="button"
            onClick={() => {
              step.action!();
              markDone(currentStep);
            }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              marginTop: 20, padding: "10px 20px",
              background: `${step.accentColor}18`,
              border: `1px solid ${step.accentColor}40`,
              borderRadius: 6, cursor: "pointer",
              fontFamily: F.s, fontSize: 13, fontWeight: 500,
              color: step.accentColor,
              transition: "all 0.15s",
              alignSelf: "flex-start",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = `${step.accentColor}28`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `${step.accentColor}18`; }}
          >
            {step.actionLabel}
            <ChevronRight size={14} />
          </button>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* ── Navigation footer ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginTop: 36, paddingTop: 20,
          borderTop: `1px solid ${C.border}`,
        }}>
          <button
            type="button"
            onClick={() => { setCurrentStep((i) => Math.max(0, i - 1)); }}
            disabled={currentStep === 0}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px",
              background: "transparent", border: `1px solid ${C.border}`,
              borderRadius: 5, cursor: currentStep === 0 ? "not-allowed" : "pointer",
              fontFamily: F.s, fontSize: 12, color: currentStep === 0 ? C.textFaint : C.textMid,
              transition: "all 0.15s",
            }}
          >
            <ChevronLeft size={14} />
            Previous
          </button>

          {/* Mark complete button */}
          <button
            type="button"
            onClick={() => {
              markDone(currentStep);
              if (currentStep < steps.length - 1) {
                setCurrentStep((i) => i + 1);
              }
            }}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 16px",
              background: isDone ? "#22c55e18" : `${step.accentColor}14`,
              border: `1px solid ${isDone ? "#22c55e40" : `${step.accentColor}30`}`,
              borderRadius: 5, cursor: "pointer",
              fontFamily: F.m, fontSize: 10, fontWeight: 600,
              letterSpacing: "0.06em", textTransform: "uppercase",
              color: isDone ? "#22c55e" : step.accentColor,
              transition: "all 0.15s",
            }}
          >
            {isDone ? <CheckCircle2 size={13} /> : <Circle size={13} />}
            {isDone
              ? (currentStep < steps.length - 1 ? "Done \u2014 Next" : "Completed")
              : "Mark Complete"}
          </button>

          <button
            type="button"
            onClick={() => { setCurrentStep((i) => Math.min(steps.length - 1, i + 1)); }}
            disabled={currentStep === steps.length - 1}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px",
              background: "transparent", border: `1px solid ${C.border}`,
              borderRadius: 5,
              cursor: currentStep === steps.length - 1 ? "not-allowed" : "pointer",
              fontFamily: F.s, fontSize: 12,
              color: currentStep === steps.length - 1 ? C.textFaint : C.textMid,
              transition: "all 0.15s",
            }}
          >
            Next
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
