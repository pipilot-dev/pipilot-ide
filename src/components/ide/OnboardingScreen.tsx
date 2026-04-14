/**
 * OnboardingScreen — Full-screen first-launch experience.
 * Shows once on first visit, then never again (persisted to localStorage).
 * Inspired by VS Code's Get Started screen.
 */

import { useState, useCallback } from "react";
import {
  Rocket, Terminal, MessageSquare, FolderOpen, GitBranch,
  Cloud, Shield, Eye, Sparkles, ChevronRight, ChevronLeft,
  Keyboard, Check, ExternalLink,
} from "lucide-react";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

injectFonts();

const STORAGE_KEY = "pipilot:onboarding-complete";

interface OnboardingScreenProps {
  onComplete: () => void;
}

interface Step {
  title: string;
  subtitle: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  features?: { icon: React.ReactNode; label: string; desc: string }[];
  action?: { label: string; onClick: () => void };
}

export function useOnboarding() {
  const [show, setShow] = useState(() => {
    try { return !localStorage.getItem(STORAGE_KEY); } catch { return true; }
  });
  const complete = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, "true"); } catch {}
    setShow(false);
  }, []);
  return { showOnboarding: show, completeOnboarding: complete };
}

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [step, setStep] = useState(0);

  const steps: Step[] = [
    {
      title: "Welcome to PiPilot IDE",
      subtitle: "Your AI-native code editor",
      description: "PiPilot combines a powerful code editor, integrated terminal, cloud management, and an autonomous AI agent — all in one workspace. Build full-stack apps faster than ever.",
      icon: <Rocket size={40} />,
      color: C.accent,
      features: [
        { icon: <MessageSquare size={16} />, label: "AI Agent", desc: "Autonomous coding assistant that reads, writes, and creates files" },
        { icon: <Terminal size={16} />, label: "Integrated Terminal", desc: "Full PTY terminal with Rust-powered IPC" },
        { icon: <Eye size={16} />, label: "Live Preview", desc: "See your app running with hot reload" },
        { icon: <Cloud size={16} />, label: "Cloud Management", desc: "GitHub, Vercel, Supabase, Cloudflare built-in" },
      ],
    },
    {
      title: "Your Workspace",
      subtitle: "Open a folder or create a new project",
      description: "PiPilot works with any project on your machine. Open an existing folder, clone from GitHub, or let the AI generate a new project from a description.",
      icon: <FolderOpen size={40} />,
      color: "#61afef",
      features: [
        { icon: <FolderOpen size={16} />, label: "Open Folder", desc: "Open any local project from your file system" },
        { icon: <GitBranch size={16} />, label: "Clone Repo", desc: "Clone any GitHub repository directly" },
        { icon: <Sparkles size={16} />, label: "Generate with AI", desc: "Describe what you want and the agent builds it" },
        { icon: <Rocket size={16} />, label: "Templates", desc: "Start from React, Next.js, Expo, and more" },
      ],
    },
    {
      title: "Meet the AI Agent",
      subtitle: "Your autonomous coding partner",
      description: "Press Ctrl+Shift+I to open the AI chat. Describe what you want — the agent reads your codebase, creates files, installs dependencies, and runs your project. Every change is checkpointed so you can revert instantly.",
      icon: <MessageSquare size={40} />,
      color: "#c678dd",
      features: [
        { icon: <MessageSquare size={16} />, label: "Agent Mode", desc: "AI reads/writes files, runs commands autonomously" },
        { icon: <Shield size={16} />, label: "Checkpoints", desc: "Every AI action is git-committed — revert any change" },
        { icon: <Eye size={16} />, label: "Live Preview", desc: "Agent can screenshot and iterate on your UI" },
        { icon: <Sparkles size={16} />, label: "MCP Tools", desc: "Context7, DeepWiki, and custom MCP servers" },
      ],
    },
    {
      title: "Keyboard Shortcuts",
      subtitle: "Work faster with shortcuts",
      description: "PiPilot is keyboard-first. Here are the essentials to get you started:",
      icon: <Keyboard size={40} />,
      color: "#e5c07b",
      features: [
        { icon: <span style={{ fontFamily: FONTS.mono, fontSize: 11 }}>⌘P</span>, label: "Quick Open", desc: "Open any file by name" },
        { icon: <span style={{ fontFamily: FONTS.mono, fontSize: 11 }}>⌘⇧I</span>, label: "AI Chat", desc: "Toggle the AI assistant panel" },
        { icon: <span style={{ fontFamily: FONTS.mono, fontSize: 11 }}>⌘`</span>, label: "Terminal", desc: "Toggle the integrated terminal" },
        { icon: <span style={{ fontFamily: FONTS.mono, fontSize: 11 }}>⌘B</span>, label: "Sidebar", desc: "Toggle the sidebar panel" },
        { icon: <span style={{ fontFamily: FONTS.mono, fontSize: 11 }}>⌘,</span>, label: "Settings", desc: "Open preferences" },
        { icon: <span style={{ fontFamily: FONTS.mono, fontSize: 11 }}>⌘S</span>, label: "Save", desc: "Save the current file" },
      ],
    },
    {
      title: "You're All Set!",
      subtitle: "Start building something amazing",
      description: "You can always revisit the walkthroughs from the Welcome page. Explore the sidebar to find the file explorer, source control, extensions, cloud management, and more.",
      icon: <Check size={40} />,
      color: "#98c379",
      action: {
        label: "Get Started",
        onClick: () => {
          try { localStorage.setItem(STORAGE_KEY, "true"); } catch {}
          onComplete();
        },
      },
    },
  ];

  const current = steps[step];
  const isLast = step === steps.length - 1;
  const isFirst = step === 0;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999,
      background: C.bg, color: C.text, fontFamily: FONTS.sans,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      overflow: "hidden",
    }}>
      {/* Background gradient */}
      <div style={{
        position: "absolute", top: -200, left: "50%", transform: "translateX(-50%)",
        width: 900, height: 500,
        background: `radial-gradient(ellipse at center, ${current.color}08 0%, transparent 70%)`,
        pointerEvents: "none", transition: "background 0.5s",
      }} />

      {/* Skip button */}
      <button onClick={() => { try { localStorage.setItem(STORAGE_KEY, "true"); } catch {} onComplete(); }}
        style={{
          position: "absolute", top: 20, right: 24,
          background: "none", border: "none", color: C.textDim,
          fontSize: 11, fontFamily: FONTS.mono, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4,
        }}>
        Skip <ChevronRight size={12} />
      </button>

      {/* Step indicator dots */}
      <div style={{ display: "flex", gap: 8, marginBottom: 32 }}>
        {steps.map((_, i) => (
          <button key={i} onClick={() => setStep(i)} style={{
            width: i === step ? 24 : 8, height: 8, borderRadius: 4,
            background: i === step ? current.color : i < step ? `${current.color}60` : C.border,
            border: "none", cursor: "pointer",
            transition: "all 0.3s ease",
          }} />
        ))}
      </div>

      {/* Icon */}
      <div style={{
        width: 80, height: 80, borderRadius: 20,
        background: `${current.color}12`, border: `1px solid ${current.color}25`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: current.color, marginBottom: 20,
        transition: "all 0.3s ease",
      }}>
        {current.icon}
      </div>

      {/* Title */}
      <h1 style={{
        fontFamily: FONTS.display, fontSize: 32, fontWeight: 400,
        margin: "0 0 6px", color: "#e8e8ed",
        transition: "color 0.3s",
      }}>
        {current.title}
      </h1>
      <p style={{
        fontFamily: FONTS.mono, fontSize: 12, color: current.color,
        margin: "0 0 12px", letterSpacing: "0.04em",
      }}>
        {current.subtitle}
      </p>
      <p style={{
        maxWidth: 520, textAlign: "center", fontSize: 13,
        color: C.textMid, lineHeight: 1.7, margin: "0 0 28px",
      }}>
        {current.description}
      </p>

      {/* Features grid */}
      {current.features && (
        <div style={{
          display: "grid",
          gridTemplateColumns: current.features.length > 4 ? "repeat(3, 1fr)" : "repeat(2, 1fr)",
          gap: 10, maxWidth: 560, width: "100%", marginBottom: 32,
        }}>
          {current.features.map((f, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: "10px 12px", borderRadius: 8,
              background: C.surface, border: `1px solid ${C.border}`,
            }}>
              <span style={{ color: current.color, flexShrink: 0, marginTop: 1 }}>{f.icon}</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.text, marginBottom: 2 }}>{f.label}</div>
                <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.4 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Action button (last step) */}
      {current.action && (
        <button onClick={current.action.onClick} style={{
          padding: "12px 32px", borderRadius: 8,
          background: current.color, color: C.bg,
          fontFamily: FONTS.mono, fontSize: 13, fontWeight: 700,
          border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 8,
          letterSpacing: "0.02em",
        }}>
          <Rocket size={16} /> {current.action.label}
        </button>
      )}

      {/* Navigation */}
      <div style={{
        display: "flex", gap: 10, marginTop: current.action ? 16 : 0,
      }}>
        {!isFirst && (
          <button onClick={() => setStep(step - 1)} style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "8px 16px", borderRadius: 6,
            background: "transparent", border: `1px solid ${C.border}`,
            color: C.textMid, fontFamily: FONTS.mono, fontSize: 11,
            cursor: "pointer",
          }}>
            <ChevronLeft size={12} /> Back
          </button>
        )}
        {!isLast && (
          <button onClick={() => setStep(step + 1)} style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "8px 16px", borderRadius: 6,
            background: current.color, border: "none",
            color: C.bg, fontFamily: FONTS.mono, fontSize: 11,
            fontWeight: 600, cursor: "pointer",
          }}>
            Next <ChevronRight size={12} />
          </button>
        )}
      </div>

      {/* Footer */}
      <div style={{
        position: "absolute", bottom: 20,
        fontSize: 10, color: C.textFaint, fontFamily: FONTS.mono,
      }}>
        PiPilot IDE v0.1.0
      </div>
    </div>
  );
}
