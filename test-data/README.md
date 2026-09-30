# Import test files

Files for testing **Import CSV / Excel** on the Site Audit page. Each row lists what the import should do.

| File | What it tests | Expected result |
|---|---|---|
| `a1-header-url.csv` | Header `url` + 3 sites | 3 sites ready |
| `a2-header-website.csv` | Header `Website` + 2 sites | 2 sites ready |
| `b-no-header.csv` | No header row | 3 sites ready (first row is used as data) |
| `c-url-not-first-column.csv` | 4 columns, URL in the 3rd (`Website`) | 3 sites ready |
| `d1-excel-bom-crlf-quoted.csv` | UTF-8 BOM, `\r\n` line endings, quoted values with commas and `""` | 2 sites ready |
| `d2-excel-semicolon.csv` | Semicolon-separated (Excel in European locales), BOM, `\r\n` | 2 sites ready |
| `e-messy.csv` | Blank rows, spaces, duplicates (www / http / trailing slash), invalid (`abc`, `http://`), private (`127.0.0.1`, `192.168.1.10`, `localhost`) | Imported 11 rows (3 empty rows skipped). 3 sites ready · 2 not valid · 3 not allowed · 3 duplicates |
| `g-sites.xlsx` | Excel workbook, URL in the 2nd column, one blank row | 2 sites ready (1 empty row skipped) |
| `f1-empty.csv` | 0-byte file | Error: "No website addresses found" |
| `f2-header-only.csv` | Header row only | Error: "No website addresses found" |
| `f3-not-a-csv.pdf` | Wrong file type | Error: "isn't a CSV file" |
| `f4-image-renamed.csv` | PNG bytes saved as `.csv` | Error: "doesn't look like a CSV or text file" |

The CSVs use exact bytes (BOM, CRLF, binary), so edit them with care. Many editors silently change line endings or drop the BOM.
