import { useState } from "react";
import { MessageSquare, Check } from "lucide-react";

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
    // Merge custom texts into answers
    const finalAnswers = { ...answers };
    for (const [q, text] of Object.entries(customTexts)) {
      if (text.trim()) finalAnswers[q] = text.trim();
    }
    onAnswer(requestId, finalAnswers);
  };

  const allAnswered = questions.every((q) => answers[q.question] || customTexts[q.question]?.trim());

  return (
    <div
      style={{
        borderTop: "1px solid hsl(220 13% 22%)",
        background: "hsl(220 13% 13%)",
        padding: "10px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <MessageSquare size={13} style={{ color: "hsl(280 65% 60%)" }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 14% 80%)" }}>Agent needs your input</span>
      </div>

      {questions.map((q, qi) => (
        <div key={qi} style={{ marginBottom: qi < questions.length - 1 ? 10 : 0 }}>
          <div style={{ fontSize: 12, color: "hsl(220 14% 75%)", marginBottom: 6, lineHeight: 1.4 }}>
            {q.question}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {q.options.map((opt, oi) => (
              <button
                key={oi}
                onClick={() => handleSelect(q.question, opt.label, q.multiSelect)}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "6px 10px", borderRadius: 6, cursor: "pointer", textAlign: "left",
                  border: isSelected(q.question, opt.label)
                    ? "1px solid hsl(207 90% 54%)"
                    : "1px solid hsl(220 13% 25%)",
                  background: isSelected(q.question, opt.label)
                    ? "hsl(207 90% 54% / 0.1)"
                    : "hsl(220 13% 18%)",
                  color: "hsl(220 14% 80%)",
                }}
              >
                <span style={{
                  width: 16, height: 16, borderRadius: q.multiSelect ? 3 : 8, flexShrink: 0, marginTop: 1,
                  border: isSelected(q.question, opt.label)
                    ? "2px solid hsl(207 90% 54%)"
                    : "2px solid hsl(220 13% 35%)",
                  background: isSelected(q.question, opt.label) ? "hsl(207 90% 54%)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {isSelected(q.question, opt.label) && <Check size={10} style={{ color: "#fff" }} />}
                </span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 500 }}>{opt.label}</div>
                  {opt.description && (
                    <div style={{ fontSize: 10, color: "hsl(220 14% 50%)", marginTop: 1 }}>{opt.description}</div>
                  )}
                </div>
              </button>
            ))}

            {/* Other / custom text */}
            <input
              placeholder="Or type your own answer..."
              value={customTexts[q.question] || ""}
              onChange={(e) => setCustomTexts((prev) => ({ ...prev, [q.question]: e.target.value }))}
              style={{
                padding: "5px 10px", fontSize: 11, borderRadius: 6,
                border: "1px solid hsl(220 13% 25%)", background: "hsl(220 13% 18%)",
                color: "hsl(220 14% 80%)", outline: "none",
              }}
            />
          </div>
        </div>
      ))}

      <button
        onClick={handleSubmit}
        disabled={!allAnswered}
        style={{
          marginTop: 8, width: "100%", padding: "7px 0", fontSize: 11, fontWeight: 600,
          borderRadius: 6, border: "none", cursor: allAnswered ? "pointer" : "default",
          background: allAnswered ? "hsl(207 90% 54%)" : "hsl(220 13% 25%)",
          color: allAnswered ? "#fff" : "hsl(220 14% 45%)",
        }}
      >
        Submit Answer
      </button>
    </div>
  );
}
