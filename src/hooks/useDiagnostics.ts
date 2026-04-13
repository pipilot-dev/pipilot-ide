import { useCallback, useState, useRef, useEffect } from "react";
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
  ran: { typescript?: boolean; eslint?: boolean; json?: boolean; syntax?: boolean };
  durationMs: number;
}

export interface SeedReport {
  framework: string;
  added: string[];
  skipped: string[];
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
  const [lastSeedReport, setLastSeedReport] = useState<SeedReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Track which projects we've already auto-seeded so we only do it once per session
  const seededRef = useRef<Set<string>>(new Set());

  /** Auto-seed missing config files (.gitignore, jsconfig.json, env.d.ts) */
  const seedMissingConfigs = useCallback(async (): Promise<SeedReport | null> => {
    if (!activeProjectId) return null;
    if (seededRef.current.has(activeProjectId)) return null;
    seededRef.current.add(activeProjectId);
    try {
      const res = await fetch("/api/project/seed-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId }),
      });
      if (!res.ok) return null;
      const report: SeedReport = await res.json();
      if (report.added.length > 0) {
        setLastSeedReport(report);
      }
      return report;
    } catch {
      return null;
    }
  }, [activeProjectId]);

  const runChecks = useCallback(async () => {
    if (!activeProjectId) return null;
    setRunning(true);
    setError(null);
    try {
      // Auto-seed missing config files BEFORE checking, so the very first
      // check on a fresh project gets meaningful diagnostics.
      await seedMissingConfigs();

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
      if (data.ran.syntax) sourcesRun.push("syntax");

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

  // Auto-recheck diagnostics every 10 seconds in the background.
  // Keeps the status bar error/warning counts up-to-date even when the
  // Problems panel is closed.
  useEffect(() => {
    if (!activeProjectId) return;
    // Initial check after a short delay (let the project load)
    const initTimer = setTimeout(() => { runChecks(); }, 2000);
    const interval = setInterval(() => {
      if (!running) runChecks();
    }, 10000);
    return () => { clearTimeout(initTimer); clearInterval(interval); };
  }, [activeProjectId]); // intentionally exclude runChecks/running to avoid reset loops

  return {
    runChecks,
    seedMissingConfigs,
    running,
    lastResult,
    lastSeedReport,
    error,
  };
}
