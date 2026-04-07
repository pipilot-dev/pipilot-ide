import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useCallback } from "react";

const DEFAULTS: Record<string, string> = {
  editorFontSize: "14",
  editorFontFamily: '"Fira Code", "Cascadia Code", monospace',
  editorTabSize: "2",
  editorWordWrap: "on",
  editorMinimap: "false",
  theme: "dark",
  autoSave: "true",
};

export function useSettings() {
  // Load all settings as array, convert to Record
  const rows = useLiveQuery(() => db.settings.toArray(), []) ?? [];

  const settings: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  const get = useCallback((key: string): string => {
    return settings[key] ?? DEFAULTS[key] ?? "";
  }, [settings]);

  const set = useCallback(async (key: string, value: string) => {
    await db.settings.put({ key, value });
  }, []);

  return { settings, get, set, isLoaded: rows.length > 0 || true };
}
