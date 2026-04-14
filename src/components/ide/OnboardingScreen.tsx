/**
 * OnboardingScreen — First-launch experience.
 * "Midnight Studio" aesthetic: warm dark surfaces, orange accent,
 * DM Sans display, Geist Mono code, atmospheric gradients.
 */

import { useState, useCallback } from "react";
import {
  Rocket, Terminal, MessageSquare, FolderOpen, GitBranch,
  Cloud, Shield, Eye, Sparkles, ChevronRight, ChevronLeft,
  Keyboard, Check, Zap, Layers, Bot, Code2,
} from "lucide-react";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

injectFonts();

const STORAGE_KEY = "pipilot:onboarding-complete";

interface OnboardingScreenProps {
  onComplete: () => void;
}

interface Feature {
  icon: React.ReactNode;
  label: string;
  desc: string;
}

interface Step {
  tag: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  features?: Feature[];
  isLast?: boolean;
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

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "true"); } catch {}
    onComplete();
  };

  const steps: Step[] = [
    {
      tag: "welcome",
      title: "Welcome to PiPilot",
      description: "An AI-native code editor that combines a powerful workspace, autonomous coding agent, and cloud management — designed for the way you actually build software.",
      icon: <Rocket size={36} strokeWidth={1.5} />,
      features: [
        { icon: <Bot size={15} />, label: "AI Agent", desc: "Autonomous assistant that reads, writes, and ships code" },
        { icon: <Terminal size={15} />, label: "Terminal", desc: "Full PTY shell with zero-latency Rust IPC" },
        { icon: <Eye size={15} />, label: "Live Preview", desc: "Built-in browser with DOM inspector" },
        { icon: <Cloud size={15} />, label: "Cloud Ops", desc: "GitHub, Vercel, Supabase, Cloudflare — all built-in" },
      ],
    },
    {
      tag: "workspace",
      title: "Start anywhere",
      description: "Open a local folder, clone from GitHub, or describe what you want and let the AI build it from scratch. Your projects live in ~/PiPilot/workspaces — browse them from any tool.",
      icon: <FolderOpen size={36} strokeWidth={1.5} />,
      features: [
        { icon: <FolderOpen size={15} />, label: "Open Folder", desc: "Any directory on your machine" },
        { icon: <GitBranch size={15} />, label: "Clone", desc: "Pull any GitHub repo directly" },
        { icon: <Sparkles size={15} />, label: "Generate", desc: "Describe it — the agent builds it" },
        { icon: <Layers size={15} />, label: "Templates", desc: "React, Next.js, Expo, and more" },
      ],
    },
    {
      tag: "agent",
      title: "Your coding partner",
      description: "The AI agent reads your codebase, creates files, installs packages, runs commands, and iterates on your UI — all while checkpointing every change. Revert anything with one click.",
      icon: <Bot size={36} strokeWidth={1.5} />,
      features: [
        { icon: <MessageSquare size={15} />, label: "Agent Mode", desc: "Full autonomy — reads, writes, executes" },
        { icon: <Shield size={15} />, label: "Checkpoints", desc: "Git-backed — every action is reversible" },
        { icon: <Code2 size={15} />, label: "Context", desc: "Attach files, errors, or preview DOM" },
        { icon: <Zap size={15} />, label: "MCP Tools", desc: "Context7, DeepWiki, and custom servers" },
      ],
    },
    {
      tag: "shortcuts",
      title: "Keyboard-first",
      description: "Essential shortcuts to move fast. Everything is accessible from the keyboard.",
      icon: <Keyboard size={36} strokeWidth={1.5} />,
      features: [
        { icon: <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: C.accent }}>⌘P</span>, label: "Quick Open", desc: "Jump to any file" },
        { icon: <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: C.accent }}>⌘⇧I</span>, label: "AI Chat", desc: "Toggle agent panel" },
        { icon: <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: C.accent }}>⌘`</span>, label: "Terminal", desc: "Toggle shell" },
        { icon: <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: C.accent }}>⌘B</span>, label: "Sidebar", desc: "Toggle explorer" },
        { icon: <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: C.accent }}>⌘,</span>, label: "Settings", desc: "Preferences" },
        { icon: <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: C.accent }}>⌘S</span>, label: "Save", desc: "Save current file" },
      ],
    },
    {
      tag: "ready",
      title: "You're ready",
      description: "Explore the sidebar, open a project, and start building. The walkthroughs are always available from the Welcome page if you need them.",
      icon: <Check size={36} strokeWidth={1.5} />,
      isLast: true,
    },
  ];

  const current = steps[step];
  const progress = ((step + 1) / steps.length) * 100;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999,
      background: C.bg, color: C.text, fontFamily: FONTS.sans,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* ── Atmospheric background ── */}
      {/* Warm gradient glow from top-left — "Midnight Studio" feel */}
      <div style={{
        position: "absolute", top: -100, left: -100,
        width: 700, height: 700,
        background: `radial-gradient(circle, ${C.accent}06 0%, transparent 65%)`,
        pointerEvents: "none",
      }} />
      {/* Subtle noise texture */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E")`,
        pointerEvents: "none", opacity: 0.4,
      }} />

      {/* ── Top bar ── */}
      <div style={{
        display: "flex", alignItems: "center", padding: "16px 24px",
        borderBottom: `1px solid ${C.border}`, flexShrink: 0,
        position: "relative", zIndex: 1,
      }}>
        {/* Progress bar */}
        <div style={{ flex: 1, height: 2, background: C.border, borderRadius: 1, overflow: "hidden" }}>
          <div style={{
            width: `${progress}%`, height: "100%",
            background: `linear-gradient(90deg, ${C.accent}, ${C.accentLight})`,
            transition: "width 0.4s ease",
          }} />
        </div>
        <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: C.textDim, marginLeft: 12, flexShrink: 0 }}>
          {step + 1}/{steps.length}
        </span>
        <button onClick={dismiss} style={{
          marginLeft: 16, background: "none", border: "none",
          color: C.textDim, fontFamily: FONTS.mono, fontSize: 10,
          cursor: "pointer", padding: "4px 8px",
        }}
          onMouseEnter={(e) => { e.currentTarget.style.color = C.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = C.textDim; }}
        >
          Skip
        </button>
      </div>

      {/* ── Main content ── */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "0 24px", position: "relative", zIndex: 1,
        maxWidth: 600, margin: "0 auto", width: "100%",
      }}>
        {/* Icon */}
        <div style={{
          width: 72, height: 72, borderRadius: 18,
          background: C.surface,
          border: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: C.accent, marginBottom: 24,
          boxShadow: `0 0 40px ${C.accent}08`,
        }}>
          {current.icon}
        </div>

        {/* Tag */}
        <span style={{
          fontFamily: FONTS.mono, fontSize: 9, fontWeight: 600,
          color: C.accent, letterSpacing: "0.12em",
          textTransform: "uppercase", marginBottom: 8,
        }}>
          {current.tag}
        </span>

        {/* Title */}
        <h1 style={{
          fontFamily: FONTS.display, fontSize: 28, fontWeight: 400,
          color: C.text, margin: "0 0 10px", textAlign: "center",
          letterSpacing: "-0.02em",
        }}>
          {current.title}
        </h1>

        {/* Description */}
        <p style={{
          fontSize: 13, color: C.textMid, lineHeight: 1.7,
          margin: "0 0 28px", textAlign: "center", maxWidth: 480,
        }}>
          {current.description}
        </p>

        {/* Feature cards */}
        {current.features && (
          <div style={{
            display: "grid",
            gridTemplateColumns: current.features.length > 4 ? "repeat(3, 1fr)" : "repeat(2, 1fr)",
            gap: 8, width: "100%", marginBottom: 32,
          }}>
            {current.features.map((f, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: "10px 12px", borderRadius: 8,
                background: C.surface, border: `1px solid ${C.border}`,
                transition: "border-color 0.2s",
              }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.borderHover; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.border; }}
              >
                <span style={{ color: C.accent, flexShrink: 0, marginTop: 2 }}>{f.icon}</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.text, marginBottom: 1 }}>{f.label}</div>
                  <div style={{ fontSize: 10, color: C.textDim, lineHeight: 1.4 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Last step: big CTA */}
        {current.isLast && (
          <button onClick={dismiss} style={{
            padding: "12px 28px", borderRadius: 8,
            background: C.accent, color: "#fff",
            fontFamily: FONTS.display, fontSize: 14, fontWeight: 600,
            border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 8,
            boxShadow: `0 4px 20px ${C.accent}30`,
            transition: "transform 0.15s, box-shadow 0.15s",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = `0 6px 24px ${C.accent}40`; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = `0 4px 20px ${C.accent}30`; }}
          >
            <Rocket size={16} /> Open PiPilot
          </button>
        )}

        {/* Navigation */}
        <div style={{ display: "flex", gap: 8, marginTop: current.isLast ? 0 : 4 }}>
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "7px 14px", borderRadius: 6,
              background: "transparent", border: `1px solid ${C.border}`,
              color: C.textMid, fontFamily: FONTS.mono, fontSize: 10,
              cursor: "pointer", transition: "border-color 0.15s",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.borderHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; }}
            >
              <ChevronLeft size={11} /> Back
            </button>
          )}
          {!current.isLast && (
            <button onClick={() => setStep(step + 1)} style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "7px 14px", borderRadius: 6,
              background: C.accent, border: "none",
              color: "#fff", fontFamily: FONTS.mono, fontSize: 10,
              fontWeight: 600, cursor: "pointer",
              transition: "background 0.15s",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.accentHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = C.accent; }}
            >
              Next <ChevronRight size={11} />
            </button>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{
        padding: "12px 24px", textAlign: "center",
        fontFamily: FONTS.mono, fontSize: 9, color: C.textFaint,
        borderTop: `1px solid ${C.border}`, flexShrink: 0,
        position: "relative", zIndex: 1,
      }}>
        pipilot ide v0.1.0
      </div>
    </div>
  );
}
