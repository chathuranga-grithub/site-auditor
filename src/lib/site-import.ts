// Import a list of sites from a file (CSV, Excel .xlsx or plain text) for bulk scanning,
// plus the downloadable sample CSV. Runs in the browser.

export const IMPORT_ACCEPT = ".csv,.txt,.xlsx,text/csv,text/plain";
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Header names recognised as the URL column (case-insensitive). */
const URL_HEADERS = /^(urls?|website|websites|site|sites|domain|domains|link|links|address|homepage)$/i;

export const SAMPLE_CSV = ["url", "example.com", "https://www.example.org/", "example.net"].join("\r\n");

export function downloadSampleCsv() {
  const blob = new Blob(["\uFEFF" + SAMPLE_CSV + "\r\n"], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = "site-audit-sample.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Reads a dropped or chosen file and returns the site entries found in it. */
export async function readSiteFile(file: File): Promise<string[]> {
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is too large. Keep it under 2 MB.");
  const name = file.name.toLowerCase();

  if (name.endsWith(".xlsx")) {
    const { Workbook } = (await import("exceljs")).default;
    const wb = new Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const rows: string[][] = [];
    ws.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => cells.push(cell.text.trim()));
      rows.push(cells);
    });
    return sitesFromRows(rows);
  }

  if (name.endsWith(".xls")) throw new Error("Old .xls files aren't supported. Save it as .xlsx or .csv.");
  return sitesFromText(await file.text());
}

/** CSV or plain text. Plain text (no delimiter) is treated as one site per line. */
export function sitesFromText(text: string): string[] {
  return sitesFromRows(parseDelimited(text.replace(/^\uFEFF/, "")));
}

/**
 * Picks the URL column: a header like "url" or "website" if present, otherwise the
 * first column. A non-URL first row (e.g. "Name") is treated as a header and skipped.
 */
export function sitesFromRows(rows: string[][]): string[] {
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim()));
  if (nonEmpty.length === 0) return [];

  const first = nonEmpty[0].map((c) => c.trim());
  let column = first.findIndex((c) => URL_HEADERS.test(c));
  let start = 1;
  if (column < 0) {
    column = 0;
    start = looksLikeSite(first[0] ?? "") ? 0 : 1;
  }

  return nonEmpty
    .slice(start)
    .map((r) => (r[column] ?? "").trim())
    .filter((v) => /[a-z0-9]/i.test(v)); // drops blanks and stray separators like ","
}

function looksLikeSite(value: string): boolean {
  return /^(https?:\/\/)?[^\s/]+\.[^\s/]+/i.test(value.trim());
}

/** Minimal RFC 4180 parser; auto-detects comma, semicolon or tab from the first line. */
export function parseDelimited(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", ";", "\t"];
  const counts = candidates.map((d) => firstLine.split(d).length - 1);
  const max = Math.max(...counts);
  const delimiter = max > 0 ? candidates[counts.indexOf(max)] : null;

  // No delimiter: one entry per line.
  if (!delimiter) return text.split(/\r?\n/).map((line) => [line.trim()]);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
