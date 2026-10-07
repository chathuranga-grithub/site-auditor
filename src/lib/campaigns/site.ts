// Small URL helpers for Auto CTR.

/** "https://www.example.vn/page" → "example.vn" */
export function stripWwwHost(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Today's date in Vietnam, YYYY-MM-DD (campaign days follow the Vietnam calendar). */
export function todayInVietnam(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}
