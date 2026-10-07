// SEO Auditor mark: rising ranking bars and a magnifying glass on the brand gradient.
// Same drawing as the favicon (src/app/icon.svg).

import { useId } from "react";

export function Logo({ className = "size-7" }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-accent)" />
          <stop offset="1" stopColor="var(--color-accent-2)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id})`} />
      <rect x="6" y="18" width="3.4" height="7" rx="1.2" fill="#fff" fillOpacity=".8" />
      <rect x="11" y="14" width="3.4" height="11" rx="1.2" fill="#fff" fillOpacity=".8" />
      <circle cx="20.5" cy="13" r="5.2" fill="none" stroke="#fff" strokeWidth="2.4" />
      <path d="M24.3 16.8 27 19.5" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  );
}
