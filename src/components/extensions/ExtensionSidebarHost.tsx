import { useEffect, useRef } from "react";
import { useExtensions } from "@/hooks/useExtensions";

interface ExtensionSidebarHostProps {
  panelId: string;
}

export function ExtensionSidebarHost({ panelId }: ExtensionSidebarHostProps) {
  const { host } = useExtensions();
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | void>(undefined);

  useEffect(() => {
    if (!host || !containerRef.current) return;

    const panel = host.getSidebarPanel(panelId);
    if (panel?.renderFn) {
      cleanupRef.current = panel.renderFn(containerRef.current);
    }

    return () => {
      if (typeof cleanupRef.current === "function") {
        cleanupRef.current();
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [host, panelId]);

  return (
    <div
      ref={containerRef}
      style={{ height: "100%", overflowY: "auto" }}
    />
  );
}
