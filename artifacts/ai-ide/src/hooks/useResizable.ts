import { useState, useCallback, useRef, useEffect } from "react";

export function useResizable(
  initialSize: number,
  min: number,
  max: number,
  direction: "horizontal" | "vertical" = "horizontal"
) {
  const [size, setSize] = useState(initialSize);
  const [isDragging, setIsDragging] = useState(false);
  const startPos = useRef(0);
  const startSize = useRef(initialSize);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startPos.current = direction === "horizontal" ? e.clientX : e.clientY;
      startSize.current = size;
    },
    [size, direction]
  );

  useEffect(() => {
    if (!isDragging) return;

    const onMove = (e: MouseEvent) => {
      const delta =
        direction === "horizontal"
          ? startPos.current - e.clientX
          : startPos.current - e.clientY;
      const newSize = Math.min(max, Math.max(min, startSize.current + delta));
      setSize(newSize);
    };

    const onUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, direction, min, max]);

  return { size, isDragging, onMouseDown };
}

export function useSidebarResizable(
  initialSize: number,
  min: number,
  max: number
) {
  const [size, setSize] = useState(initialSize);
  const [isDragging, setIsDragging] = useState(false);
  const startPos = useRef(0);
  const startSize = useRef(initialSize);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startPos.current = e.clientX;
      startSize.current = size;
    },
    [size]
  );

  useEffect(() => {
    if (!isDragging) return;

    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - startPos.current;
      const newSize = Math.min(max, Math.max(min, startSize.current + delta));
      setSize(newSize);
    };

    const onUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, min, max]);

  return { size, isDragging, onMouseDown };
}
