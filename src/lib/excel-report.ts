// Styled Excel export: for one scan, the full report (Summary + one sheet per category)
// or a single category; for a bulk scan, an Overview plus combined category sheets.
// Runs in the browser; exceljs is loaded on demand so it isn't in the initial bundle.

import type { Workbook, Worksheet } from "exceljs";
import { exportFileName, friendlyError, homepageProblem, responseTimes, scanWarnings } from "./report";
import type { JobStatus, SiteJob } from "./batch";
import type { ScanResult } from "./types";

export type SectionId = "broken" | "orphans" | "redirects" | "blocked" | "unreachable" | "urls";

type CellValue = string | number | boolean | null;
type Kind = "url" | "status" | "number" | "text" | "flag" | "count" | "badge";

interface ColumnDef {
  header: string;
  width: number;
  kind?: Kind;
  /** For kind "count": tint used when the value is above zero. */
  severity?: Severity;
}

/** Tints for kind "badge" cells (scan status in the bulk overview). */
const BADGE_SEVERITY: Record<string, Severity> = {
  Done: "good",
  Failed: "critical",
  Stopped: "warning",
  Skipped: "notice",
  PASS: "good",
  FAIL: "serious",
};

interface SectionDef {
  id: SectionId;
  /** Sheet name (max 31 chars) and menu label. */
  label: string;
  description: string;
  action: string;
  severity: Severity | null;
  tabColor: string;
  columns: ColumnDef[];
  count: (r: ScanResult) => number;
  /** One array per row, aligned with columns. */
  rows: (r: ScanResult) => CellValue[][];
}

type Severity = "critical" | "serious" | "warning" | "notice" | "good";

// ---------- Palette (ARGB) ----------

const C = {
  ink: "FF1E1B2E",
  muted: "FF6B6880",
  accent: "FF6D28D9",
  headerFill: "FF2E1065",
  headerText: "FFFFFFFF",
  band: "FFF8F7FC",
  border: "FFE4E1EE",
  link: "FF1D4ED8",
};

const SEVERITY_STYLE: Record<Severity, { fill: string; font: string; label: string }> = {
  critical: { fill: "FFFEE2E2", font: "FF991B1B", label: "Critical" },
  serious: { fill: "FFFFEDD5", font: "FF9A3412", label: "High" },
  warning: { fill: "FFFEF3C7", font: "FF92400E", label: "Medium" },
  notice: { fill: "FFF1F5F9", font: "FF475569", label: "Low" },
  good: { fill: "FFDCFCE7", font: "FF166534", label: "OK" },
};

function statusSeverity(status: number): Severity {
  if (status === 0) return "notice";
  if (status >= 500) return "critical";
  if (status >= 400) return "serious";
  if (status >= 300) return "warning";
  return "good";
}

/** One row per (item, source page) so the sheet can be filtered by page. */
function perSource<T extends { foundOn: string[] }>(items: T[], row: (item: T, source: string | null) => CellValue[]) {
  return items.flatMap((item) => (item.foundOn.length ? item.foundOn.map((s) => row(item, s)) : [row(item, null)]));
}

// ---------- Sections ----------

export const SECTIONS: SectionDef[] = [
  {
    id: "broken",
    label: "Broken links",
    description: "Internal links returning 4xx/5xx. One row per page that contains the link.",
    action: "Fix or remove the link on the pages listed.",
    severity: "critical",
    tabColor: "FFD03B3B",
    columns: [
      { header: "Broken URL", width: 62, kind: "url" },
      { header: "Status", width: 10, kind: "status" },
      { header: "Found on page", width: 62, kind: "url" },
      { header: "Pages linking", width: 14, kind: "number" },
    ],
    count: (r) => r.brokenLinks.length,
    rows: (r) => perSource(r.brokenLinks, (b, s) => [b.url, b.status, s, b.foundOn.length]),
  },
  {
    id: "orphans",
    label: "Orphan pages",
    description: "In the sitemap but not linked from any crawled page.",
    action: "Link to it from a relevant page, or remove it from the sitemap. Noindex pages are usually intentional.",
    severity: "serious",
    tabColor: "FFEC835A",
    columns: [
      { header: "URL", width: 62, kind: "url" },
      { header: "Status", width: 10, kind: "status" },
      { header: "Final URL", width: 62, kind: "url" },
      { header: "Noindex", width: 10, kind: "flag" },
    ],
    count: (r) => r.orphans.length,
    rows: (r) =>
      r.orphans.map((o) => [o.url, o.status, o.finalUrl && o.finalUrl !== o.url ? o.finalUrl : null, o.noindex]),
  },
  {
    id: "redirects",
    label: "Redirects",
    description: "Internal links pointing at a URL that redirects. One row per linking page.",
    action: "Update the link to the final URL.",
    severity: "notice",
    tabColor: "FFFAB219",
    columns: [
      { header: "Linked URL", width: 56, kind: "url" },
      { header: "Redirects to", width: 56, kind: "url" },
      { header: "Final status", width: 12, kind: "status" },
      { header: "Linked from page", width: 56, kind: "url" },
    ],
    count: (r) => r.redirects.length,
    rows: (r) => perSource(r.redirects, (x, s) => [x.url, x.finalUrl, x.status, s]),
  },
  {
    id: "blocked",
    label: "Cloudflare blocked",
    description: "A bot challenge answered instead of the page, so these weren't checked. Not counted as broken.",
    action: "Whitelist the scanner in Cloudflare (Security → WAF → Custom rules → Skip) and scan again.",
    severity: "warning",
    tabColor: "FF8B5CF6",
    columns: [
      { header: "URL", width: 62, kind: "url" },
      { header: "Status", width: 10, kind: "status" },
      { header: "Found on page", width: 62, kind: "url" },
    ],
    count: (r) => r.blocked.length,
    rows: (r) => perSource(r.blocked, (b, s) => [b.url, b.status, s]),
  },
  {
    id: "unreachable",
    label: "Unreachable",
    description: "No HTTP response at all (timeout, DNS error, blocked redirect).",
    action: "Re-scan. If it keeps happening, check the server.",
    severity: "warning",
    tabColor: "FF646A80",
    columns: [
      { header: "URL", width: 62, kind: "url" },
      { header: "Error", width: 44 },
      { header: "Found on page", width: 62, kind: "url" },
    ],
    count: (r) => r.unreachable.length,
    rows: (r) => perSource(r.unreachable, (u, s) => [u.url, friendlyError(u.error), s]),
  },
  {
    id: "urls",
    label: "All URLs",
    description: "Every URL requested during the crawl.",
    action: "Reference data for investigating the findings.",
    severity: null,
    tabColor: "FF22D3EE",
    columns: [
      { header: "URL", width: 56, kind: "url" },
      { header: "Status", width: 10, kind: "status" },
      { header: "Final URL", width: 48, kind: "url" },
      { header: "Type", width: 12 },
      { header: "Title", width: 44 },
      { header: "Noindex", width: 10, kind: "flag" },
      { header: "Depth", width: 9, kind: "number" },
      { header: "Inlinks", width: 10, kind: "number" },
      { header: "Outlinks", width: 11, kind: "number" },
      { header: "In sitemap", width: 12, kind: "flag" },
      { header: "Response (ms)", width: 15, kind: "number" },
      { header: "Error", width: 32 },
    ],
    count: (r) => r.pages.length,
    rows: (r) =>
      r.pages.map((p) => [
        p.url,
        p.status,
        p.redirected ? p.finalUrl : null,
        shortType(p.contentType),
        p.title,
        p.noindex,
        p.depth,
        p.inlinks,
        p.outlinks,
        p.inSitemap,
        p.durationMs,
        p.error ? friendlyError(p.error) : null,
      ]),
  },
];

// ---------- Public API ----------

/** Builds the workbook and saves it as a download. */
export async function downloadExcel(result: ScanResult, what: "full" | SectionId): Promise<void> {
  const buffer = await buildWorkbook(result, what);
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const suffix = what === "full" ? "full-report" : slug(SECTIONS.find((s) => s.id === what)!.label);
  saveBlob(blob, exportFileName(result, suffix, "xlsx"));
}

/** "full" = Summary sheet + every category with data (All URLs always included). */
export async function buildWorkbook(result: ScanResult, what: "full" | SectionId): Promise<ArrayBuffer> {
  const { Workbook } = (await import("exceljs")).default;
  const wb = new Workbook();
  wb.creator = "Site Auditor";
  wb.created = new Date(result.finishedAt);

  const sections =
    what === "full"
      ? SECTIONS.filter((s) => s.id === "urls" || s.count(result) > 0)
      : SECTIONS.filter((s) => s.id === what);

  if (what === "full") addSummarySheet(wb, result, sections);
  for (const s of sections) addSectionSheet(wb, s, result);

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

// ---------- Bulk (several sites) ----------

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Skipped",
  running: "Stopped",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
  skipped: "Skipped",
};

const OVERVIEW_COLUMNS: ColumnDef[] = [
  { header: "Site", width: 34, kind: "url" },
  { header: "Status", width: 11, kind: "badge" },
  { header: "Sitemap URLs", width: 14, kind: "number" },
  { header: "Pages crawled", width: 15, kind: "number" },
  { header: "Broken links", width: 14, kind: "count", severity: "critical" },
  { header: "Orphan pages", width: 15, kind: "count", severity: "serious" },
  { header: "Redirects", width: 12, kind: "count", severity: "warning" },
  { header: "Cloudflare", width: 12, kind: "count", severity: "warning" },
  { header: "Unreachable", width: 13, kind: "count", severity: "notice" },
  { header: "Soft-404", width: 11, kind: "badge" },
  { header: "Notes", width: 70 },
];

/** Downloads one workbook covering every site in a bulk scan. */
export async function downloadBatchExcel(jobs: SiteJob[]): Promise<void> {
  const buffer = await buildBatchWorkbook(jobs);
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  saveBlob(blob, `site-audit-bulk-${new Date().toISOString().slice(0, 10)}-${jobs.length}-sites.xlsx`);
}

/** Overview (one row per site) + one combined sheet per category with a "Site" column. */
export async function buildBatchWorkbook(jobs: SiteJob[]): Promise<ArrayBuffer> {
  const { Workbook } = (await import("exceljs")).default;
  const wb = new Workbook();
  wb.creator = "Site Auditor";
  wb.created = new Date();

  const scanned = jobs.filter((j) => j.result);
  addTableSheet(wb, {
    name: "Overview",
    description: "One row per site. The category sheets list every issue across all sites.",
    meta: `${jobs.length} sites  ·  exported ${formatDate(new Date().toISOString())}`,
    tabColor: C.accent,
    columns: OVERVIEW_COLUMNS,
    rows: jobs.map(overviewRow),
  });

  for (const s of SECTIONS.filter((x) => x.id !== "urls")) {
    const rows = scanned.flatMap((j) => s.rows(j.result!).map((r) => [j.host, ...r]));
    addTableSheet(wb, {
      name: s.label,
      description: `${s.description} All sites combined; filter the Site column to see one site.`,
      meta: `${scanned.length} sites  ·  ${rows.length.toLocaleString()} rows`,
      tabColor: s.tabColor,
      columns: [{ header: "Site", width: 28 }, ...s.columns],
      rows,
    });
  }

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function overviewRow(job: SiteJob): CellValue[] {
  const r = job.result;
  const site = r?.origin ?? `https://${job.host}`;
  if (!r) return [site, STATUS_LABEL[job.status], null, null, null, null, null, null, null, null, job.error ?? null];

  const problem = homepageProblem(r);
  const notes = problem ? [problem] : scanWarnings(r);
  const soft = r.soft404 ? (r.soft404.passed ? "PASS" : "FAIL") : null;
  return [
    site,
    STATUS_LABEL[job.status],
    r.sitemapError ? null : r.sitemapCount,
    r.pagesCrawled,
    r.brokenLinks.length,
    r.orphans.length,
    r.redirects.length,
    r.blocked.length,
    r.unreachable.length,
    soft,
    notes.join(" ") || null,
  ];
}

export function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

// ---------- Sheets ----------

const HEADER_ROW = 5;

function addSectionSheet(wb: Workbook, s: SectionDef, result: ScanResult) {
  const rows = s.rows(result);
  addTableSheet(wb, {
    name: s.label,
    description: s.description,
    meta: `${host(result)}  ·  scanned ${formatDate(result.finishedAt)}  ·  ${s.count(result).toLocaleString()} items, ${rows.length.toLocaleString()} rows`,
    tabColor: s.tabColor,
    columns: s.columns,
    rows,
  });
}

/** Title block, frozen styled header, banded rows and column filters. */
function addTableSheet(
  wb: Workbook,
  t: { name: string; description: string; meta: string; tabColor: string; columns: ColumnDef[]; rows: CellValue[][] },
) {
  const ws = wb.addWorksheet(t.name, {
    properties: { tabColor: { argb: t.tabColor } },
    views: [{ state: "frozen", ySplit: HEADER_ROW, showGridLines: false }],
  });
  ws.columns = t.columns.map((c) => ({ width: c.width }));
  writeTitle(ws, t.name, t.description, t.meta);

  const header = ws.getRow(HEADER_ROW);
  t.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    styleHeaderCell(cell, c.kind);
  });
  header.height = 24;

  if (t.rows.length === 0) {
    const cell = ws.getCell(HEADER_ROW + 1, 1);
    cell.value = "Nothing found.";
    cell.font = { italic: true, color: { argb: C.muted } };
    return;
  }

  t.rows.forEach((values, r) => {
    const row = ws.getRow(HEADER_ROW + 1 + r);
    const banded = r % 2 === 1;
    t.columns.forEach((c, i) => writeCell(row.getCell(i + 1), values[i], c, banded));
    row.height = 18;
  });

  ws.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW + t.rows.length, column: t.columns.length },
  };
}

function addSummarySheet(wb: Workbook, result: ScanResult, included: SectionDef[]) {
  const ws = wb.addWorksheet("Summary", {
    properties: { tabColor: { argb: C.accent } },
    views: [{ showGridLines: false }],
  });
  ws.columns = [{ width: 28 }, { width: 14 }, { width: 14 }, { width: 80 }];

  writeTitle(ws, "Site audit report", result.origin, `Generated by Site Auditor  ·  ${formatDate(result.finishedAt)}`);
  ws.getCell("A2").value = { text: result.origin, hyperlink: result.origin };
  ws.getCell("A2").font = { size: 11, color: { argb: C.link }, underline: true };

  // Scan details
  let r = 5;
  r = writeHeading(ws, r, "Scan details");
  const times = responseTimes(result);
  const soft = result.soft404;
  const details: [string, CellValue, Severity?][] = [
    ["Status", result.cancelled ? "Stopped early" : "Completed", result.cancelled ? "warning" : "good"],
    ["Sitemap URLs", result.sitemapError ? "Not found" : result.sitemapCount],
    ["Pages crawled", result.pagesCrawled],
    ["Requests", result.urlsChecked],
    ["Page limit reached", result.truncated ? "Yes" : "No", result.truncated ? "warning" : undefined],
    ["Median response (ms)", times.median],
    ["p95 response (ms)", times.p95],
    ["Soft-404 test", soft ? (soft.passed ? "PASS" : `FAIL (${soft.status})`) : "Not run", soft ? (soft.passed ? "good" : "serious") : undefined],
    ["Started", formatDate(result.startedAt)],
    ["Finished", formatDate(result.finishedAt)],
  ];
  for (const [label, value, severity] of details) {
    const key = ws.getCell(r, 1);
    key.value = label;
    key.font = { color: { argb: C.muted } };
    const val = ws.getCell(r, 2);
    val.value = value;
    val.font = { bold: true, color: { argb: C.ink } };
    val.alignment = { horizontal: "left" };
    if (typeof value === "number") val.numFmt = "#,##0";
    if (severity) paintSeverity(val, severity);
    ws.getRow(r).height = 18;
    r++;
  }

  // Findings
  r = writeHeading(ws, r + 1, "Findings");
  const head = ws.getRow(r);
  ["Category", "Count", "Severity", "What to do"].forEach((h, i) => {
    const cell = head.getCell(i + 1);
    cell.value = h;
    styleHeaderCell(cell, i === 1 ? "number" : "text");
  });
  head.height = 24;
  r++;

  const sheetNames = new Set(included.map((s) => s.label));
  for (const s of SECTIONS.filter((x) => x.severity)) {
    const n = s.count(result);
    const row = ws.getRow(r);
    const name = row.getCell(1);
    if (n > 0 && sheetNames.has(s.label)) {
      name.value = { text: s.label, hyperlink: `#'${s.label}'!A1` };
      name.font = { bold: true, color: { argb: C.link }, underline: true };
    } else {
      name.value = s.label;
      name.font = { bold: true, color: { argb: C.ink } };
    }
    const count = row.getCell(2);
    count.value = n;
    count.numFmt = "#,##0";
    count.font = { bold: true, color: { argb: C.ink } };
    count.alignment = { horizontal: "right" };
    const sev = row.getCell(3);
    const severity = n > 0 ? s.severity! : "good";
    sev.value = SEVERITY_STYLE[severity].label;
    paintSeverity(sev, severity);
    const action = row.getCell(4);
    action.value = n > 0 ? s.action : "—";
    action.font = { color: { argb: C.muted } };
    action.alignment = { wrapText: true, vertical: "middle" };
    for (let c = 1; c <= 4; c++) bottomBorder(row.getCell(c));
    row.height = 20;
    r++;
  }

  // Notes
  const problem = homepageProblem(result);
  const notes = problem ? [problem] : scanWarnings(result);
  if (notes.length) {
    r = writeHeading(ws, r + 1, "Notes");
    for (const note of notes) {
      ws.mergeCells(r, 1, r, 4);
      const cell = ws.getCell(r, 1);
      cell.value = `•  ${note}`;
      cell.font = { color: { argb: C.ink } };
      cell.alignment = { wrapText: true, vertical: "top" };
      ws.getRow(r).height = Math.max(18, Math.ceil(note.length / 120) * 16);
      r++;
    }
  }
}

// ---------- Cell styling ----------

function writeTitle(ws: Worksheet, title: string, description: string, meta: string) {
  const t = ws.getCell("A1");
  t.value = title;
  t.font = { size: 18, bold: true, color: { argb: C.ink } };
  ws.getRow(1).height = 30;

  const d = ws.getCell("A2");
  d.value = description;
  d.font = { size: 11, color: { argb: C.muted } };

  const m = ws.getCell("A3");
  m.value = meta;
  m.font = { size: 9, color: { argb: C.muted } };
  ws.getRow(4).height = 8;
}

function writeHeading(ws: Worksheet, row: number, text: string): number {
  const cell = ws.getCell(row, 1);
  cell.value = text.toUpperCase();
  cell.font = { size: 10, bold: true, color: { argb: C.accent } };
  for (let c = 1; c <= 4; c++) {
    ws.getCell(row, c).border = { bottom: { style: "medium", color: { argb: C.accent } } };
  }
  ws.getRow(row).height = 22;
  return row + 1;
}

type ExcelCell = ReturnType<Worksheet["getCell"]>;

function styleHeaderCell(cell: ExcelCell, kind?: Kind) {
  cell.font = { bold: true, size: 10, color: { argb: C.headerText } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.headerFill } };
  cell.alignment = {
    vertical: "middle",
    horizontal:
      kind === "number" ? "right" : kind === "status" || kind === "flag" || kind === "count" || kind === "badge" ? "center" : "left",
    indent: kind === "text" || kind === "url" || kind === undefined ? 1 : 0,
  };
}

function writeCell(cell: ExcelCell, value: CellValue, col: ColumnDef, banded: boolean) {
  const kind = col.kind ?? "text";
  const fill = banded ? C.band : null;
  cell.alignment = { vertical: "middle" };
  cell.font = { size: 10, color: { argb: C.ink } };

  if (value === null || value === "") {
    cell.value = null;
  } else if (kind === "count" && typeof value === "number") {
    // Issue count: tinted by the column's severity when non-zero, green when clean.
    cell.value = value;
    cell.numFmt = "#,##0";
    paintSeverity(cell, value > 0 ? (col.severity ?? "warning") : "good");
    bottomBorder(cell);
    return;
  } else if (kind === "badge" && typeof value === "string") {
    cell.value = value;
    paintSeverity(cell, BADGE_SEVERITY[value] ?? "notice");
    bottomBorder(cell);
    return;
  } else if (kind === "url" && typeof value === "string") {
    cell.value = { text: value, hyperlink: value };
    cell.font = { size: 10, color: { argb: C.link }, underline: true };
  } else if (kind === "status" && typeof value === "number") {
    cell.value = value === 0 ? "ERR" : value;
    cell.alignment = { vertical: "middle", horizontal: "center" };
    paintSeverity(cell, statusSeverity(value));
    bottomBorder(cell);
    return;
  } else if (kind === "flag") {
    cell.value = value ? "Yes" : "";
    cell.alignment = { vertical: "middle", horizontal: "center" };
  } else if (kind === "number" && typeof value === "number") {
    cell.value = value;
    cell.numFmt = "#,##0";
    cell.alignment = { vertical: "middle", horizontal: "right" };
  } else {
    cell.value = value;
  }

  if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  bottomBorder(cell);
}

function paintSeverity(cell: ExcelCell, severity: Severity) {
  const s = SEVERITY_STYLE[severity];
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: s.fill } };
  cell.font = { size: 10, bold: true, color: { argb: s.font } };
  cell.alignment = { ...cell.alignment, horizontal: "center", vertical: "middle" };
}

function bottomBorder(cell: ExcelCell) {
  cell.border = { bottom: { style: "thin", color: { argb: C.border } } };
}

// ---------- Helpers ----------

function host(result: ScanResult) {
  return new URL(result.origin).host;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function shortType(contentType: string | null): string | null {
  if (!contentType) return null;
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (mime.startsWith("image/")) return mime.slice(6).replace("svg+xml", "svg");
  if (mime === "application/pdf") return "pdf";
  return mime.split("/")[1] ?? mime;
}
