"use client";

import { useEffect, useRef, ReactNode } from "react";

/**
 * A vertically user-resizable box using the browser's native CSS `resize`
 * handle (the little diagonal-grip corner, same affordance as a <textarea>)
 * rather than a custom drag implementation - it's free, accessible, and
 * every user already knows it. The chosen height is remembered per browser
 * via localStorage so it sticks across visits; if that fails (private
 * browsing, storage disabled) it just falls back to the default height
 * every time, which is a fine degradation for a convenience feature.
 */
export function ResizableBox({
  children,
  storageKey,
  defaultHeight,
  minHeight = 220,
  maxHeight = 900,
}: {
  children: ReactNode;
  storageKey: string;
  defaultHeight: number;
  minHeight?: number;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) el.style.height = saved;
    } catch {
      // localStorage unavailable - keep the default height.
    }

    const observer = new ResizeObserver(() => {
      try {
        window.localStorage.setItem(storageKey, `${el.offsetHeight}px`);
      } catch {
        // Not persistable this session - the resize itself still works.
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [storageKey]);

  return (
    <div
      ref={ref}
      className="resize-y overflow-hidden rounded-md border border-outline-variant"
      style={{ height: defaultHeight, minHeight, maxHeight }}
    >
      {children}
    </div>
  );
}
