# Site Auditor

Internal tool for engineers and SEO specialists, with two tools: **Site Audit** and **Keyword Rankings** (see below).

**Site Audit:** paste a website URL (usually WordPress) and it reports:

- **Orphan pages**: URLs in the sitemap that no crawled page links to
- **Broken internal links**: internal links returning 4xx/5xx, with the pages they were found on
- **Redirects**: internal links that point at a URL which redirects
- **Blocked by Cloudflare**: URLs where a bot challenge answered instead of the page

## Checking several sites at once

Paste a list into the URL box (one site per line, or separated by commas), or **import a file**, then click **Scan N sites**. Up to 200 sites per batch. A full batch takes roughly 20–35 minutes, and the browser tab must stay open. For more sites, split the list into batches.

- **Import CSV / Excel:** click **Sample CSV** to get the template (a single `url` column), fill it in, then click **Import CSV / Excel** or drop the file onto the box.
  - Accepts `.csv` (comma, semicolon or tab), `.xlsx` and `.txt`.
  - Uses a column named `url`, `website`, `domain`, `site` or `link` if there is one, otherwise the first column.
  - Imported sites are added to the box so you can review them before scanning.
- **In parallel:** 3 sites are scanned at the same time, and the rest start automatically as slots free up. Each site uses 10 parallel requests. That's under about 200 requests a minute per site, which stays below common WordPress security-plugin limits.
- **Clean-up:** duplicates (`example.com`, `https://www.example.com/`) and invalid entries are removed, and a note says what was skipped.
- **Queue:** shows each site's live status, pages crawled, and broken/orphan/redirect counts.
- **Failures:** a site that fails doesn't stop the batch. **Stop all** stops the current site and skips the rest.
- **Details:** click a finished site to open its full results and single-site exports.
- **Download all sites (.xlsx):** an **Overview** sheet (one row per site) plus combined Broken links / Orphan pages / Redirects / Cloudflare / Unreachable sheets, each with a **Site** column to filter by.
- **Copy summary:** a plain-text summary of every site, with the first few broken links and orphans for each.

## Keyword Rankings

The second tool, at `/rankings`. Enter a **keyword** (e.g. `iphone`). It shows the **top 5 or 10 Google results as a person in that country sees them**, and analyses each ranking page's on-page SEO.

- **Country:** for now only **Vietnam** is enabled, via `ENABLED_COUNTRIES` in `src/lib/countries.ts`. The other 194 countries are already listed with their names and search languages, so adding a country back means adding its code there.
- **Local search:** each search sends Google the country (`gl=vn`), the country's search language (`hl=vi`, Vietnamese) and a location inside the country ("Vietnam").
  - A **Vietnamese / English** switch lets you check English-language rankings too.
  - If a location name isn't recognised, the search retries with country and language only.
- **Check on Google:** opens the same search on Google, so you can compare. Your own location can still change what Google shows you.

- **Charts:** word count by position, response time by position, and an SEO checklist showing how many of the top results pass each check.
- **The 9 checks:**
  - title length 30–60 characters
  - meta description 70–160 characters
  - exactly one H1
  - HTTPS
  - mobile viewport tag
  - canonical tag
  - structured data (schema)
  - social preview image (og:image)
  - image alt text
- **Table:** one row per result. Click a row for the full details.
- **Exports:** **Excel** and **Copy summary**.

**Search results** come from a SERP API, because scraping Google directly is blocked and against its terms. Set at least one key in `.env.local` and in Vercel:

| Variable | Service | Free allowance |
|---|---|---|
| `SERPER_API_KEY` | [serper.dev](https://serper.dev) | 2,500 searches, one-time, no card |
| `SERPAPI_API_KEY` | [serpapi.com](https://serpapi.com) | 250 searches per month |

**How the keys are used:**
- Serper is used first. If it fails or its credits run out, the tool switches to SerpApi automatically.
- Top 5 or Top 10 costs **1 search**.
- Without a key, the tool shows "Search isn't set up yet".

Page analysis (`/api/analyze`) uses the same SSRF-safe fetch as Site Audit.

## Visit Test (runs on your computer only)

The third tool, at `/visit-test`. It checks that a **company site works for a visitor in Vietnam**.

**What it does:**
1. Gets a proxy from your proxy provider's API, e.g. ShopLike, which returns `{ status: "success", data: { proxy: "ip:port" } }`.
2. Opens the site in a real browser (the **Microsoft Edge or Google Chrome installed on the computer**) through that proxy.
3. Confirms the real exit IP, country and network.
4. Scrolls the page and checks images load.
5. **Clicks up to 3, 5 or 10 internal links** like a visitor, and checks each page loads without errors.

The report includes screenshots, load times, JavaScript errors, failed files, broken images, and a plain-language list of problems.

**Run it:**
1. Run `npm run dev`, then open http://localhost:3000/visit-test.
2. Paste the proxy API link, or save it once in `.env.local` as `PROXY_API_URL`. The link and its token stay on the computer.

**Limits:** it's a QA check, not a traffic tool.
- One visit per click, with no repeats or schedules.
- At most 10 internal pages per visit.
- Internal links only: never external links or ads.
- No search-engine step.
- Links that change state or need a login (logout, cart, checkout, wp-admin) are never clicked.

**How it treats the proxy:**
- The browser's own background services (Edge/Chrome updates, telemetry, SmartScreen, Bing) are kept off the proxy and blocked, so the proxy carries only the site.
- If the provider says to wait for a new IP (`"Con lai 177 giay de get proxy moi"`), the previous proxy is reused while it's still valid (`proxyTimeout`). Otherwise the page shows a countdown.

**On Vercel:** the tool is disabled, because there's no browser there and the provider would likely reject Vercel's IPs.

## How it works

To stay within Vercel's function time limits, the crawl runs in the **browser**, and each server call does only a small amount of work:

| Part | Job |
|---|---|
| `POST /api/sitemap` | Finds the sitemap (`/sitemap-index.xml`, `/sitemap_index.xml`, `/sitemap.xml`, then `robots.txt`) and returns every page URL |
| `POST /api/fetch` | Fetches **one** URL and returns its status, final URL, title, noindex flag and internal links |
| `src/lib/crawler.ts` | Runs in the browser: crawls breadth-first from the homepage, 10 requests at a time, up to 500 HTML pages |

The server refuses private and local addresses (localhost, 10.x, 192.168.x, cloud metadata, etc.). It checks the resolved IP on every redirect hop.

## Run locally

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. It redirects to the Site Audit tool.

Other scripts: `npm run build` (production build and type-check), `npm run lint`.

## Deploy

The app deploys to Vercel with no configuration and needs no environment variables. Both API routes set `runtime = "nodejs"` and `maxDuration = 30`. Each call handles one URL, so a normal request finishes in a few seconds.

1. Push the repo to GitHub.
2. On vercel.com, choose **Add New → Project** and import the repo.
3. Keep the detected defaults (Framework: Next.js) and click **Deploy**.

After that, every push to `main` deploys automatically.

**Login (not enabled):** `main` has no login, so anyone with the link can use the tool. A finished **Sign in with Google** login, limited to `@grithub.ae` accounts, is kept on the `feature/google-login` branch. Its README explains the Google and Vercel setup. To turn it back on, revert the commit "Remove Google login from main" (`git revert <that commit>`).

## Reading the results

**Summary tiles**

- **Sitemap**: number of URLs listed in the sitemap(s).
- **Crawled**: HTML pages fetched by following links from the homepage.
- **Requests**: pages plus files that only got a status check (images, PDFs, etc.).
- **Median resp. / p95**: server response time per page, measured from Vercel.
- **Soft-404**: requests a made-up URL. **PASS** means the site correctly answers 404. **FAIL** means missing pages return 200 or a redirect, which can hide broken links.

**Tabs**

| Tab | What it means | What to do |
|---|---|---|
| Broken links | Link target returned 4xx/5xx. *Found on* lists every page containing the link. | Fix or remove the link on those pages. |
| Orphans | In the sitemap, but no crawled page links to it. A `noindex` tag means it's probably intentional. | Link to it from a relevant page, or remove it from the sitemap. |
| Redirects | The link works but goes through a redirect first. | Update the link to the final URL. |
| Cloudflare | A bot challenge answered, so the URL wasn't checked. These are **not** counted as broken. | Whitelist the scanner in Cloudflare (Security → WAF → Custom rules → Skip) and scan again. |
| Unreachable | No HTTP response (timeout, DNS error). Only shown when there are some. | Re-scan. If it keeps happening, check the server. |
| All URLs | Every URL requested: status, type, click depth, links in/out, in sitemap, response time. Searchable and sortable. | Use it to investigate. |

**Warnings to watch for**

- *"The site has more than N pages…"*: the 500-page limit was reached, so some orphans may be false positives.
- *"No sitemap found"*: broken links were still checked, but orphans can't be detected.
- *"The scan was stopped early"*: results are partial and orphans weren't calculated.

**Export**

Click **Export** (top right). Every row in the menu is a one-click download:

- **Full report**: Excel workbook with a **Summary** sheet (scan details, findings with severity and what to do, notes) and one sheet per category. Category names on the Summary link to their sheets.
- **One category**: Broken links, Orphan pages, Redirects, Cloudflare blocked, Unreachable or All URLs on its own. Empty categories are greyed out.
- **Raw scan data**: the scan as JSON, for scripts.

**Copy report** copies a plain-text summary for chat or email.

The Excel sheets have frozen headers, filters on every column, clickable URLs and color-coded status cells. Broken links, redirects and blocked URLs get one row per linking page, so you can filter by the page that needs fixing.

## Project layout

```
src/
  app/                 routes (audit/ = Site Audit tool, api/ = server endpoints)
  components/
    shell/             sidebar + mobile menu shared by all tools
    ui/                reusable table, tabs, tiles, badges
    audit/             Site Audit screens
  config/tools.ts      tool registry: add an entry here to add a tool to the sidebar
  lib/                 crawler, URL helpers, SSRF-safe fetch, report/CSV builders, types
```

To add a tool, create `src/app/<name>/page.tsx` and add it to `src/config/tools.ts`.
