import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export interface Problem {
  id: string;
  type: "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  source: "preview" | "terminal" | "editor" | "typescript" | "eslint" | "json" | "syntax";
  timestamp: Date;
}

interface ProblemsContextValue {
  problems: Problem[];
  addProblem: (p: Omit<Problem, "id" | "timestamp">) => void;
  clearProblems: (source?: string) => void;
  setProblemsForSource: (source: Problem["source"], items: Omit<Problem, "id" | "timestamp">[]) => void;
  errorCount: number;
  warningCount: number;
}

const ProblemsContext = createContext<ProblemsContextValue | null>(null);

export function ProblemsProvider({ children }: { children: ReactNode }) {
  const [problems, setProblems] = useState<Problem[]>([]);

  const addProblem = useCallback((p: Omit<Problem, "id" | "timestamp">) => {
    const problem: Problem = {
      ...p,
      id: Math.random().toString(36).slice(2, 9),
      timestamp: new Date(),
    };
    setProblems((prev) => [problem, ...prev].slice(0, 200));
  }, []);

  const clearProblems = useCallback((source?: string) => {
    if (source) {
      setProblems((prev) => prev.filter((p) => p.source !== source));
    } else {
      setProblems([]);
    }
  }, []);

  /** Replace all problems from a given source with a new batch */
  const setProblemsForSource = useCallback(
    (source: Problem["source"], items: Omit<Problem, "id" | "timestamp">[]) => {
      const now = new Date();
      const fresh: Problem[] = items.map((p) => ({
        ...p,
        id: Math.random().toString(36).slice(2, 9),
        timestamp: now,
      }));
      setProblems((prev) => {
        const filtered = prev.filter((p) => p.source !== source);
        return [...fresh, ...filtered].slice(0, 1000);
      });
    },
    [],
  );

  const errorCount = problems.filter((p) => p.type === "error").length;
  const warningCount = problems.filter((p) => p.type === "warning").length;

  return (
    <ProblemsContext.Provider
      value={{ problems, addProblem, clearProblems, setProblemsForSource, errorCount, warningCount }}
    >
      {children}
    </ProblemsContext.Provider>
  );
}

export function useProblems() {
  const ctx = useContext(ProblemsContext);
  if (!ctx) throw new Error("useProblems must be used within ProblemsProvider");
  return ctx;
}
