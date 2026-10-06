// POST /api/serp  body: { keyword, country, count }
// Returns the top Google results for a keyword in a country (see src/lib/serp.ts).

import { findCountry } from "@/lib/countries";
import { RESULT_COUNTS, type ApiError, type SerpResponse } from "@/lib/rankings-types";
import { SerpError, searchGoogle } from "@/lib/serp";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  let body: { keyword?: unknown; country?: unknown; count?: unknown };
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

  const count = Number(body.count);
  if (!RESULT_COUNTS.includes(count as (typeof RESULT_COUNTS)[number])) {
    return json({ error: `Number of results must be one of ${RESULT_COUNTS.join(", ")}.` }, 400);
  }

  try {
    return json(await searchGoogle(keyword, country.code, count));
  } catch (err) {
    if (err instanceof SerpError) return json({ error: err.message }, err.status);
    return json({ error: "Search failed. Please try again." }, 502);
  }
}

function json(body: SerpResponse | ApiError, status = 200) {
  return Response.json(body, { status });
}
