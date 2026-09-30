// Import a list of sites from a file (CSV, Excel .xlsx or plain text) for bulk scanning,
// plus the downloadable sample CSV. Runs in the browser.

export const IMPORT_ACCEPT = ".csv,.tsv,.txt,.xlsx,text/csv,text/plain";
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
export async function readSiteFile(file: File): Promise<ImportedSites> {
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is too large. Keep it under 2 MB.");
  const name = file.name.toLowerCase();

  if (name.endsWith(".xlsx")) {
    const { Workbook } = (await import("exceljs")).default;
    const wb = new Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) return { sites: [], skipped: 0 };
    const rows: string[][] = [];
    ws.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => cells.push(cell.text.trim()));
      rows.push(cells);
    });
    return extractSites(rows);
  }

  if (name.endsWith(".xls")) throw new Error("Old .xls files aren't supported. Save it as .xlsx or .csv.");

  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (ext && ![".csv", ".txt", ".tsv"].includes(ext)) {
    throw new Error(`${file.name} isn't a CSV file. Use .csv, .xlsx or .txt (download the sample CSV to see the format).`);
  }

  const text = await file.text();
  // Binary content (an image or PDF renamed to .csv) has NUL bytes or many invalid characters.
  const bad = (text.match(/[\u0000\uFFFD]/g) ?? []).length;
  if (bad > 0 && bad / Math.max(1, text.length) > 0.001) {
    throw new Error(`${file.name} doesn't look like a CSV or text file. Save it as CSV (UTF-8) and try again.`);
  }
  return extractSites(parseDelimited(text.replace(/^\uFEFF/, "")));
}

/** CSV or plain text. Plain text (no delimiter) is treated as one site per line. */
export function sitesFromText(text: string): string[] {
  return extractSites(parseDelimited(text.replace(/^\uFEFF/, ""))).sites;
}

export function sitesFromRows(rows: string[][]): string[] {
  return extractSites(rows).sites;
}

export interface ImportedSites {
  sites: string[];
  /** Data rows with nothing usable in the URL column (blank rows, stray separators). */
  skipped: number;
}

/**
 * Picks the URL column: a header like "url" or "website" if present, otherwise the
 * first column. A non-URL first row (e.g. "Name") is treated as a header and skipped.
 */
export function extractSites(rows: string[][]): ImportedSites {
  const isBlank = (r: string[]) => !r.some((c) => c.trim());
  const firstIdx = rows.findIndex((r) => !isBlank(r));
  if (firstIdx < 0) return { sites: [], skipped: 0 };

  const first = rows[firstIdx].map((c) => c.trim());
  let column = first.findIndex((c) => URL_HEADERS.test(c));
  let start = firstIdx + 1;
  if (column < 0) {
    column = 0;
    start = looksLikeSite(first[0] ?? "") ? firstIdx : firstIdx + 1;
  }

  // Trailing blank lines (a final newline) aren't counted as skipped rows.
  const data = rows.slice(start);
  let end = data.length;
  while (end > 0 && isBlank(data[end - 1])) end--;
  const body = data.slice(0, end);

  const sites = body
    .map((r) => (r[column] ?? "").trim())
    .filter((v) => /[a-z0-9]/i.test(v)); // drops blanks and stray separators like ","
  return { sites, skipped: body.length - sites.length };
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
