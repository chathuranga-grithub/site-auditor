# SEO Auditor

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

The third tool, at `/visit-test`. It checks that **every page of a company site works for a visitor in Vietnam**. It works on any site (WordPress or plain PHP).

**What it does:**
1. Gets a proxy from your proxy provider's API, e.g. ShopLike, which returns `{ status: "success", data: { proxy: "ip:port" } }`.
2. Opens a real browser (the **Microsoft Edge or Google Chrome installed on the computer**) through that proxy.
3. **Checks the proxy IP before opening any page** (location, residential or datacenter network, speed) and stops unless it is in Vietnam: it looks up the IP and country through the proxy (ipinfo.io, with api.country.is as a backup). The test stops, with no pages opened, if it isn't Vietnam or can't be confirmed. Nothing is sent from this computer's own IP, and with a proxy set the browser never falls back to a direct connection.
4. Opens the start page, scrolls it and checks its images.
5. **Finds every internal page:**
   - the sitemap (Yoast, Rank Math, WordPress core `wp-sitemap.xml`, or the one listed in robots.txt), read through the proxy too;
   - links on the start page;
   - links found on every page it visits, so pages missing from the sitemap, and sites with no sitemap, are still covered.
6. **Opens every page once, 3 at a time.** It scrolls each page to the bottom and records its status, load time, JavaScript errors, failed files and broken images. A progress bar shows "Page N of M".
7. Checks that each visible link on the start page can be clicked by a visitor (not hidden or covered).
8. **Phone check** (on by default; switch to "Desktop only" to skip it). Every page is opened again on an Android phone screen (412px wide, touch). It checks the page opens, fits the screen (no sideways scrolling), has the viewport tag, and loads its images.
9. **Phone menu:** on the start page, finds the menu button (☰), taps it and checks the menu opens with links. Done once, because WordPress uses the same menu on every page.
10. Checks the proxy IP again at the end, to catch a proxy that changed IP or country during the test.

**What you see:**
- **Live console** while it runs: a summary (pages checked, OK / warnings / failed, average load, elapsed), then one line per page: time, number, HTTP code, load time, phone result, page, result. The first JavaScript error, failed file, broken image or phone problem is shown under the line. Filters: All / Problems / Failed. Click a line for everything about that page.
- **At the end:** a pass/fail checklist, the list of problems, and Copy summary.
- No screenshots are taken, so even 500 pages stay fast and light.

**Run it:**
1. Run `npm run dev`, then open http://localhost:3000/visit-test.
2. Paste the proxy API link, or save it once in `.env.local` as `PROXY_API_URL`. The link and its token stay on the computer.

**How long it takes:** about 2–4 seconds per page with 3 pages at a time, e.g. 5–10 minutes for a 200-page site on desktop only; the phone check roughly doubles that. Use Stop at any time; the report covers what was done so far.

**Limits:** it's a QA check, not a traffic tool.
- Each page is opened once per test, with no repeats or schedules.
- At most 500 pages per test (the proxy is only valid for about 30 minutes).
- Internal pages only: never external links or ads.
- No search-engine step.
- Links that change state or need a login (logout, cart, checkout, wp-admin, my-account) are never opened.
- If 5 pages in a row can't connect through the proxy (e.g. it expired), the test stops and says so.

**How it treats the proxy:**
- The browser's own background services (Edge/Chrome updates, telemetry, SmartScreen, Bing) are kept off the proxy and blocked, so the proxy carries only the site.
- When a proxy is set, the browser never falls back to a direct connection: if the proxy fails, the page fails.
- If the provider says to wait for a new IP (`"Con lai 177 giay de get proxy moi"`), the previous proxy is reused while it's still valid (`proxyTimeout`). Otherwise the page shows a countdown.

**On Vercel:** the tool is disabled, because there's no browser there and the provider would likely reject Vercel's IPs.

## CTR Tracker (live)

At `/ctr`: **Dashboard**, **Campaigns**, **New campaign**. A campaign follows one keyword for one site for 1–365 days and compares **real** numbers with goals. Nothing is generated: every number comes from real visitors.

- **Every day** (Vercel Cron, 08:00 Vietnam time, `vercel.json`):
  - Google position for the keyword in Vietnam (Serper, 1–2 search credits per campaign);
  - Search Console clicks, impressions, CTR and mobile / desktop split, for 3 days ago (Google's delay);
  - Google Analytics 4 time on page (if a page URL and GA4 property are set).
- **Goals:** target CTR (with the typical CTR for the position as a guide), target position, weekly click growth, time on page.
- **Campaign page:** goal vs real tiles, daily charts, a change log ("new title on 10 Oct") so you can see what helped, and every day's numbers. **Check now** runs today's check on demand.
- Saved in **Postgres (Neon)**: campaigns, daily numbers, change log.

**Setup:**

| Variable | What |
|---|---|
| `DATABASE_URL` | Neon connection string (Vercel → Storage → Create → Neon adds it). Tables are created on first use. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | A Google Cloud service account key (JSON as is, or base64), with the Search Console API and Google Analytics Data API enabled. Add the account's email as a **user in Search Console** for each site and as a **Viewer in GA4**. |
| `CRON_SECRET` | Any long random string; Vercel sends it to the daily job. |
| `SERPER_API_KEY` | Already used by Keyword Rankings. |

## Login

Every page and API needs a login (`src/proxy.ts`); the daily CTR job is the only exception (it checks `CRON_SECRET`).

- Username + password. Accounts are in the `app_users` table in Neon; passwords are stored as **scrypt hashes**, never as typed.
- Session: a signed, httpOnly cookie (HMAC with `AUTH_SECRET`, at least 32 characters), valid 7 days. **Sign out** is at the bottom of the sidebar.
- 5 wrong passwords for a username → that username waits 10 minutes.

**Permissions:** an **admin** can use every tool. A **user** can only use the tools on their account (`audit`, `rankings`, `visit`, `ctr`): the sidebar shows only those, other pages send them back to their tool, and other APIs answer 403.

**Add a user, or change a password / tools** (uses `DATABASE_URL` from `.env.local`):

```
npm run user:create -- <username> "<password>" admin
npm run user:create -- <username> "<password>" user audit
npm run user:create -- <username> "<password>" user audit,rankings,ctr
```

Passwords need at least 8 characters. On Vercel, `AUTH_SECRET` and `DATABASE_URL` must be set in Environment Variables.

## How it works

To stay within Vercel's function time limits, the crawl runs in the **browser**, and each server call does only a small amount of work:

| Part | Job |
|---|---|
| `POST /api/sitemap` | Finds the sitemap (`/sitemap-index.xml`, `/sitemap_index.xml`, `/sitemap.xml`, `/wp-sitemap.xml`, then `robots.txt`; shared code in `src/lib/sitemap.ts`) and returns every page URL |
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
