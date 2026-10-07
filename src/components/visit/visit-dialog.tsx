"use client";

// Visit console: the page details popup, and the PASS / WARN / FAIL styles used in it.

import { useEffect, type ReactNode } from "react";
import { CircleCheck, CircleMinus, CircleX, TriangleAlert, X } from "lucide-react";
import type { CheckStatus } from "@/lib/visit-checklist";

export const ACTIVITY_STYLE: Record<CheckStatus, { icon: typeof CircleCheck; color: string; text: string }> = {
  pass: { icon: CircleCheck, color: "text-status-good", text: "PASS" },
  warn: { icon: TriangleAlert, color: "text-status-warning", text: "WARN" },
  fail: { icon: CircleX, color: "text-status-critical", text: "FAIL" },
  skip: { icon: CircleMinus, color: "text-subtle", text: "NOT RUN" },
};

export function DetailDialog({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8" onClick={onClose} role="dialog" aria-modal="true" aria-label="Page details">
      <div className="relative mx-auto max-w-4xl rounded-xl bg-canvas" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute -top-2 -right-2 z-10 grid size-8 place-items-center rounded-full border border-line bg-surface text-muted shadow-lg hover:text-ink"
        >
          <X className="size-4" />
        </button>
        {children}
      </div>
    </div>
  );
}
