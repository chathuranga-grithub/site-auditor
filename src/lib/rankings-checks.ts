// On-page SEO checks for the Keyword Rankings report. Each check is a simple pass/fail
// on one ranking page, so pages can be compared ("passed 7/9").

import type { PageSeo } from "./rankings-types";

export interface SeoCheck {
  id: string;
  label: string;
  /** What "pass" means, shown in the detail view. */
  rule: string;
  pass: (p: PageSeo) => boolean;
  /** Current value, shown next to the result. */
  value: (p: PageSeo) => string;
}

const len = (s: string | null) => s?.length ?? 0;

export const SEO_CHECKS: SeoCheck[] = [
  {
    id: "title",
    label: "Title length",
    rule: "30–60 characters",
    pass: (p) => len(p.title) >= 30 && len(p.title) <= 60,
    value: (p) => (p.title ? `${len(p.title)} chars` : "missing"),
  },
  {
    id: "description",
    label: "Meta description",
    rule: "70–160 characters",
    pass: (p) => len(p.description) >= 70 && len(p.description) <= 160,
    value: (p) => (p.description ? `${len(p.description)} chars` : "missing"),
  },
  {
    id: "h1",
    label: "One H1 heading",
    rule: "exactly one <h1>",
    pass: (p) => p.h1Count === 1,
    value: (p) => `${p.h1Count} H1`,
  },
  {
    id: "https",
    label: "HTTPS",
    rule: "served over https://",
    pass: (p) => p.https,
    value: (p) => (p.https ? "yes" : "no"),
  },
  {
    id: "viewport",
    label: "Mobile viewport",
    rule: '<meta name="viewport"> present',
    pass: (p) => p.viewport,
    value: (p) => (p.viewport ? "yes" : "no"),
  },
  {
    id: "canonical",
    label: "Canonical tag",
    rule: "rel=canonical present",
    pass: (p) => !!p.canonical,
    value: (p) => (p.canonical ? (p.canonicalSelf ? "self" : "other URL") : "missing"),
  },
  {
    id: "schema",
    label: "Structured data",
    rule: "JSON-LD schema present",
    pass: (p) => p.schemaTypes.length > 0,
    value: (p) => (p.schemaTypes.length ? p.schemaTypes.slice(0, 3).join(", ") : "none"),
  },
  {
    id: "og",
    label: "Social preview image",
    rule: "og:image present",
    pass: (p) => p.ogImage,
    value: (p) => (p.ogImage ? "yes" : "no"),
  },
  {
    id: "alt",
    label: "Image alt text",
    rule: "every image has alt text",
    pass: (p) => p.imagesMissingAlt === 0,
    value: (p) => (p.images ? `${p.imagesMissingAlt} of ${p.images} missing` : "no images"),
  },
];

/** A page we could actually read (not blocked, responded with HTML). */
export function isAnalyzable(p: PageSeo | undefined): p is PageSeo {
  return !!p && !p.blocked && p.status >= 200 && p.status < 400 && !p.error;
}

export function checksPassed(p: PageSeo): number {
  return SEO_CHECKS.filter((c) => c.pass(p)).length;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
