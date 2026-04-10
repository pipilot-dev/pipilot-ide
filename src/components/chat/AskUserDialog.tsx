import { useState, useEffect, useRef } from "react";
import { MessageSquare, Check, ArrowRight, X } from "lucide-react";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

interface Question {
  question: string;
  header?: string;
  options: { label: string; description: string }[];
  multiSelect?: boolean;
}

interface AskUserDialogProps {
  requestId: string;
  questions: Question[];
  onAnswer: (requestId: string, answers: Record<string, string>) => void;
}

export function AskUserDialog({ requestId, questions, onAnswer }: AskUserDialogProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { injectFonts(); }, []);

  // Trap Escape key — but DON'T close (user must answer)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (allAnswered) handleSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, customTexts]);

  const handleSelect = (questionText: string, label: string, multiSelect?: boolean) => {
    setAnswers((prev) => {
      if (multiSelect) {
        const current = prev[questionText] || "";
        const labels = current ? current.split(", ") : [];
        if (labels.includes(label)) {
          return { ...prev, [questionText]: labels.filter((l) => l !== label).join(", ") };
        }
        return { ...prev, [questionText]: [...labels, label].join(", ") };
      }
      return { ...prev, [questionText]: label };
    });
  };

  const isSelected = (questionText: string, label: string) => {
    const val = answers[questionText] || "";
    return val.split(", ").includes(label);
  };

  const handleSubmit = () => {
    const finalAnswers = { ...answers };
    for (const [q, text] of Object.entries(customTexts)) {
      if (text.trim()) finalAnswers[q] = text.trim();
    }
    onAnswer(requestId, finalAnswers);
  };

  const allAnswered = questions.every(
    (q) => answers[q.question] || customTexts[q.question]?.trim(),
  );
  const answeredCount = questions.filter(
    (q) => answers[q.question] || customTexts[q.question]?.trim(),
  ).length;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(5, 5, 8, 0.7)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontFamily: FONTS.sans,
        animation: "askDialogFade 0.2s ease",
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: "100%",
          maxWidth: 640,
          maxHeight: "min(86vh, 760px)",
          display: "flex",
          flexDirection: "column",
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          boxShadow: `0 24px 80px rgba(0, 0, 0, 0.7), 0 0 0 1px ${C.accentDim}`,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Subtle radial accent in top-right */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -120, right: -120,
            width: 360, height: 360,
            background: `radial-gradient(circle, ${C.accent}10 0%, transparent 60%)`,
            filter: "blur(20px)",
            pointerEvents: "none",
          }}
        />

        {/* Header */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "20px 24px 16px",
            borderBottom: `1px solid ${C.border}`,
            flexShrink: 0,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6, height: 6, borderRadius: "50%",
              background: C.accent,
              boxShadow: `0 0 8px ${C.accent}80`,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 9, fontWeight: 500,
              letterSpacing: "0.18em", textTransform: "uppercase",
              color: C.accent,
            }}
          >
            / Q
          </span>
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 9, fontWeight: 500,
              letterSpacing: "0.18em", textTransform: "uppercase",
              color: C.text,
            }}
          >
            Agent needs your input
          </span>
          <div style={{ flex: 1 }} />
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 9,
              color: C.textDim,
              letterSpacing: "0.05em",
            }}
          >
            {String(answeredCount).padStart(2, "0")} / {String(questions.length).padStart(2, "0")}
          </span>
        </div>

        {/* Display heading */}
        <div
          style={{
            position: "relative",
            padding: "20px 24px 8px",
            flexShrink: 0,
          }}
        >
          <h2
            style={{
              fontFamily: FONTS.display,
              fontSize: "clamp(24px, 4vw, 32px)",
              fontWeight: 400,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              color: C.text,
              margin: 0,
            }}
          >
            help me <span style={{ fontStyle: "italic", color: C.accent }}>decide</span>
            <span style={{ color: C.accent }}>.</span>
          </h2>
          <p
            style={{
              marginTop: 8,
              fontSize: 12,
              color: C.textMid,
              lineHeight: 1.5,
            }}
          >
            Pick the option that fits, or type your own answer below each question.
          </p>
        </div>

        {/* Scrollable questions area */}
        <div
          style={{
            position: "relative",
            flex: 1,
            overflowY: "auto",
            padding: "8px 24px 16px",
            minHeight: 0,
          }}
        >
          {questions.map((q, qi) => {
            const isAnswered = !!(answers[q.question] || customTexts[q.question]?.trim());
            return (
              <div
                key={qi}
                style={{
                  paddingTop: qi === 0 ? 0 : 24,
                  paddingBottom: 4,
                  borderTop: qi === 0 ? "none" : `1px solid ${C.border}`,
                  marginTop: qi === 0 ? 0 : 0,
                }}
              >
                {/* Question label with index */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
                  <span
                    style={{
                      fontFamily: FONTS.mono,
                      fontSize: 9,
                      fontWeight: 500,
                      letterSpacing: "0.05em",
                      color: isAnswered ? C.accent : C.textDim,
                      flexShrink: 0,
                      transition: "color 0.18s",
                    }}
                  >
                    {String(qi + 1).padStart(2, "0")}
                    {isAnswered && <span style={{ marginLeft: 4 }}>✓</span>}
                  </span>
                  <span
                    style={{
                      fontFamily: FONTS.display,
                      fontSize: 18,
                      lineHeight: 1.35,
                      color: C.text,
                    }}
                  >
                    {q.question}
                  </span>
                </div>

                {q.multiSelect && (
                  <div
                    style={{
                      fontFamily: FONTS.mono,
                      fontSize: 9,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: C.textDim,
                      marginBottom: 8,
                      paddingLeft: 30,
                    }}
                  >
                    // multi-select — pick any
                  </div>
                )}

                {/* Options */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    paddingLeft: 30,
                  }}
                >
                  {q.options.map((opt, oi) => {
                    const selected = isSelected(q.question, opt.label);
                    return (
                      <button
                        key={oi}
                        onClick={() => handleSelect(q.question, opt.label, q.multiSelect)}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 12,
                          padding: "10px 14px",
                          background: selected ? `${C.accent}0d` : "transparent",
                          border: `1px solid ${selected ? C.accent : C.border}`,
                          borderRadius: 4,
                          color: C.text,
                          textAlign: "left",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                          fontFamily: FONTS.sans,
                        }}
                        onMouseEnter={(e) => {
                          if (!selected) {
                            e.currentTarget.style.borderColor = C.borderHover;
                            e.currentTarget.style.background = C.surfaceAlt;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!selected) {
                            e.currentTarget.style.borderColor = C.border;
                            e.currentTarget.style.background = "transparent";
                          }
                        }}
                      >
                        {/* Indicator */}
                        <span
                          style={{
                            width: 14, height: 14,
                            borderRadius: q.multiSelect ? 2 : "50%",
                            flexShrink: 0, marginTop: 2,
                            border: `1.5px solid ${selected ? C.accent : C.border}`,
                            background: selected ? C.accent : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transition: "all 0.15s",
                          }}
                        >
                          {selected && <Check size={9} strokeWidth={3} style={{ color: C.bg }} />}
                        </span>

                        {/* Label + description */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 500,
                              color: selected ? C.accent : C.text,
                              transition: "color 0.15s",
                              wordBreak: "break-word",
                            }}
                          >
                            {opt.label}
                          </div>
                          {opt.description && (
                            <div
                              style={{
                                marginTop: 4,
                                fontSize: 11,
                                color: C.textMid,
                                lineHeight: 1.5,
                                wordBreak: "break-word",
                              }}
                            >
                              {opt.description}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}

                  {/* Custom text input */}
                  <div
                    style={{
                      marginTop: 4,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 14px",
                      background: C.surfaceAlt,
                      border: `1px solid ${customTexts[q.question]?.trim() ? C.accent : C.border}`,
                      borderRadius: 4,
                      transition: "border-color 0.15s",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: FONTS.mono,
                        fontSize: 9,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: C.textDim,
                        flexShrink: 0,
                      }}
                    >
                      or
                    </span>
                    <input
                      placeholder="type your own answer..."
                      value={customTexts[q.question] || ""}
                      onChange={(e) => setCustomTexts((prev) => ({ ...prev, [q.question]: e.target.value }))}
                      style={{
                        flex: 1,
                        padding: 0,
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        color: C.text,
                        fontFamily: FONTS.sans,
                        fontSize: 12,
                        minWidth: 0,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer with submit button */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "16px 24px",
            borderTop: `1px solid ${C.border}`,
            background: C.surfaceAlt,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 9,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: C.textDim,
            }}
          >
            ⌘↵ to submit
          </span>
          <button
            onClick={handleSubmit}
            disabled={!allAnswered}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 18px",
              background: allAnswered ? C.accent : "transparent",
              color: allAnswered ? C.bg : C.textFaint,
              border: `1px solid ${allAnswered ? C.accent : C.border}`,
              borderRadius: 4,
              fontFamily: FONTS.mono,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              cursor: allAnswered ? "pointer" : "not-allowed",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              if (allAnswered) {
                e.currentTarget.style.boxShadow = `0 0 24px ${C.accent}50`;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            Submit
            <ArrowRight size={11} strokeWidth={2} />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes askDialogFade {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
