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

**Search results** are read from Google in a real browser (Puppeteer, with Google Chrome installed on the computer, else Microsoft Edge) through the **Vietnam proxy** from the proxy API (Settings). It only reads the result list; it never clicks a result.

- Works only when the app runs on a computer (`npm run dev`), and for **Vietnam** only (the proxy is in Vietnam).
- Google sometimes answers a proxy IP with a CAPTCHA; the search then waits up to 2 minutes for it to be solved in the browser window (by you, or an extension in the Chrome profile; the app doesn't touch it). Not solved: that search fails (a visit opens the site directly) and the next one gets a new IP.

Page analysis (`/api/analyze`) uses the same SSRF-safe fetch as Site Audit.

## Auto CTR (live)

At `/ctr`: **Dashboard**, **Campaigns**, **New campaign**. A campaign follows one keyword for one site for 1–365 days and compares **real** numbers with goals. Nothing is generated: every number comes from real visitors.

- **Every day** from 08:00 Vietnam time:
  - Google position for the keyword in Vietnam, read in a browser through the Vietnam proxy. Runs on the computer running the app (`src/lib/campaigns/scheduler.ts`); if it was off, it catches up when the app starts. Before searching it checks the proxy's IP is in Vietnam and isn't the computer's own; a failed check (CAPTCHA, wrong IP) is tried again up to 3 times that day, 30 minutes apart;
  - Search Console clicks, impressions, CTR and mobile / desktop split, for 3 days ago (Google's delay);
  - Google Analytics 4 time on page (if a page URL and GA4 property are set). These two run on Vercel Cron (`vercel.json`) too.
- **Goals:** target CTR (with the typical CTR for the position as a guide), target position, weekly click growth, time on page.
- **Campaign page:** goal vs real tiles, visits today and so far against the visit plan, and every day's numbers. **Check ranking** runs today's check on demand.
- Saved in **Postgres (Neon)**: campaigns and daily numbers, including visits done per day.
- **Site visit:** while a campaign runs, the computer running the app visits every page of the site in a real browser (Chrome, else Edge) through a Vietnam proxy, and the campaign page shows the live console. Each day it runs the campaign's target visits from its visit plan (day 1 visits, grown by the daily increase %), one after another, each with a new proxy IP. Visits already done that day count toward the target, so a restart or a pause and resume only runs what's left. It runs when the campaign starts, then again once a day from 08:00 Vietnam time (and when the app starts or the campaign is resumed). Not on Vercel (no browser there).
- **Proxy links:** an admin saves one proxy API link (e.g. ShopLike) or a list of them (pasted one per line) in **Settings**; links can be added, replaced or removed one by one. They are stored **encrypted** in the database (AES-256-GCM, key derived from `AUTH_SECRET`) and never shown in full again. `PROXY_API_URL` in `.env.local` still works as a fallback (one link, or several separated by spaces or commas). For now visits and searches use the first link. If `AUTH_SECRET` changes, save the links again.
- **Chrome profile:** optional, in **Settings → Browser**: pick one of the computer's Chrome profiles by name. The app copies it (without caches) into `%LOCALAPPDATA%\SiteAuditor\chrome-profiles\<name>`, since Chrome won't let automation use a profile inside its own folder; ranking checks use the copy, and each visit gets its own copy of it (`visit-1`, `visit-2`…), since Chrome can't open one profile twice. **Update** saves it again after changing the profile in Chrome. Chrome locks extensions and sign-ins to its own profile folder, so they don't carry over: **Open** opens the saved profile in Chrome to add extensions and sign in, and visits and ranking checks use them from then on (extensions are never turned off). With a saved profile, only Google Chrome is used (never Edge), and each visit and ranking check first makes sure Chrome opened that profile; the visit console shows the browser, profile and extensions. `CHROME_PROFILE_DIR` in `.env.local` can point at a profile folder instead. None = a fresh temporary profile each time.

**Setup:**

| Variable | What |
|---|---|
| `DATABASE_URL` | Neon connection string (Vercel → Storage → Create → Neon adds it). Tables are created on first use. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | A Google Cloud service account key (JSON as is, or base64), with the Search Console API and Google Analytics Data API enabled. Add the account's email as a **user in Search Console** for each site and as a **Viewer in GA4**. |
| `CRON_SECRET` | Any long random string; Vercel sends it to the daily job. |

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
