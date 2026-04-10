import { useCallback, useState } from "react";
import { useActiveProject } from "@/contexts/ProjectContext";
import { useProblems, type Problem } from "@/contexts/ProblemsContext";

export interface ServerDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  code?: string;
  message: string;
  source: "typescript" | "eslint" | "json" | "syntax";
}

export interface CheckResult {
  diagnostics: ServerDiagnostic[];
  ran: { typescript?: boolean; eslint?: boolean; json?: boolean };
  durationMs: number;
}

/**
 * Run real linter / type-checker against the project on disk via the
 * agent server. Replaces all problems for the relevant sources in the
 * ProblemsContext with the fresh results.
 */
export function useDiagnostics() {
  const { activeProjectId } = useActiveProject();
  const { setProblemsForSource } = useProblems();
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runChecks = useCallback(async () => {
    if (!activeProjectId) return null;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/diagnostics/check?projectId=${encodeURIComponent(activeProjectId)}&source=all`,
      );
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }
      const data: CheckResult = await res.json();
      setLastResult(data);

      // Map server diagnostics → ProblemsContext shape, grouped per source
      const bySource = new Map<Problem["source"], Omit<Problem, "id" | "timestamp">[]>();
      for (const d of data.diagnostics) {
        const item: Omit<Problem, "id" | "timestamp"> = {
          type: d.severity,
          message: d.message,
          file: d.file,
          line: d.line,
          column: d.column,
          code: d.code,
          source: d.source,
        };
        if (!bySource.has(d.source)) bySource.set(d.source, []);
        bySource.get(d.source)!.push(item);
      }

      // Replace problems for every source we ran (even if empty, so old
      // entries get cleared when there are now no errors)
      const sourcesRun: Problem["source"][] = [];
      if (data.ran.typescript) sourcesRun.push("typescript");
      if (data.ran.eslint) sourcesRun.push("eslint");
      if (data.ran.json) sourcesRun.push("json");

      for (const src of sourcesRun) {
        setProblemsForSource(src, bySource.get(src) || []);
      }

      return data;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setRunning(false);
    }
  }, [activeProjectId, setProblemsForSource]);

  return {
    runChecks,
    running,
    lastResult,
    error,
  };
}
