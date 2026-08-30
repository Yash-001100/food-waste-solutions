"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: "EAN13",
        width: 1.6,
        height: 48,
        fontSize: 12,
        margin: 4,
        background: "transparent",
        lineColor: "#0b0b0b",
      });
    } catch {
      // Not a valid EAN-13 - leave the svg empty rather than throwing.
    }
  }, [value]);

  return <svg ref={ref} className="max-w-full" />;
}
