// The app's loader: a spinning ring with what's loading, on a frosted card. Used while a page opens
// (src/app/loading.tsx) and while a page's data loads (dashboard, campaigns, a campaign).

import { Loader2 } from "lucide-react";

export function Loader({ title = "Loading…", detail, className = "" }: { title?: string; detail?: string; className?: string }) {
  return (
    <div className={`flex justify-center ${className}`} role="status" aria-live="polite">
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0f1118]/85 px-5 py-3 shadow-[0_12px_40px_-12px_#8b5cf680] backdrop-blur-md">
        <Loader2 className="size-5 animate-spin text-accent" aria-hidden />
        <div>
          <div className="text-sm font-medium text-ink">{title}</div>
          {detail && <div className="text-[11px] text-subtle">{detail}</div>}
        </div>
      </div>
    </div>
  );
}
