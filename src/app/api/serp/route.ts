// POST /api/serp  body: { keyword, country, count, language: "local" | "en" }
// Returns the top Google results for a keyword in a country (see src/lib/serp.ts).

import { ENABLED_COUNTRIES, findCountry, isEnabledCountry } from "@/lib/countries";
import { RESULT_COUNTS, type ApiError, type SerpResponse } from "@/lib/rankings-types";
import { SerpError, searchGoogle } from "@/lib/serp";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  let body: { keyword?: unknown; country?: unknown; count?: unknown; language?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be JSON: { keyword, country, count }" }, 400);
  }

  const keyword = typeof body.keyword === "string" ? body.keyword.trim().replace(/\s+/g, " ") : "";
  if (!keyword) return json({ error: "Enter a keyword." }, 400);
  if (keyword.length > 120) return json({ error: "Keyword is too long (max 120 characters)." }, 400);

  const country = typeof body.country === "string" ? findCountry(body.country) : undefined;
  if (!country) return json({ error: "Choose a country." }, 400);
  if (!isEnabledCountry(country.code)) {
    const names = ENABLED_COUNTRIES.map((c) => findCountry(c)?.name ?? c).join(", ");
    return json({ error: `Only ${names} is available for now.` }, 400);
  }

  const count = Number(body.count);
  if (!RESULT_COUNTS.includes(count as (typeof RESULT_COUNTS)[number])) {
    return json({ error: `Number of results must be one of ${RESULT_COUNTS.join(", ")}.` }, 400);
  }

  const language = body.language === "en" ? "en" : "local";

  try {
    return json(await searchGoogle(keyword, country.code, count, language));
  } catch (err) {
    if (err instanceof SerpError) return json({ error: err.message }, err.status);
    return json({ error: "Search failed. Please try again." }, 502);
  }
}

function json(body: SerpResponse | ApiError, status = 200) {
  return Response.json(body, { status });
}
