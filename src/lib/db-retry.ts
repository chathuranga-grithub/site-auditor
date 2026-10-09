// Server-only: the database (Neon) is reached over the internet, so a dropped Wi-Fi, a VPN or the
// database waking up can fail a query with "Error connecting to database: fetch failed". Such
// failures are tried again instead of ending what was running. Anything else (bad SQL, a missing
// table…) fails at once: trying again won't help.

/** How long to wait before each new try of a query (then it fails): about 30s in all. */
const QUERY_RETRY_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

const CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"]);
const MESSAGES = /fetch failed|error connecting to database|socket hang up|other side closed|network|timed? ?out|terminated/i;

/** The database couldn't be reached (not a problem with the query itself). */
export function isConnectionError(err: unknown): boolean {
  let e = err as { message?: unknown; code?: unknown; cause?: unknown; sourceError?: unknown } | undefined;
  for (let i = 0; e && i < 5; i++) {
    if ((typeof e.code === "string" && CODES.has(e.code)) || (typeof e.message === "string" && MESSAGES.test(e.message))) return true;
    e = (e.cause ?? e.sourceError) as typeof e;
  }
  return false;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** Runs a query; can't reach the database: tries again a few times (about 30s) before failing. */
export async function withDbRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await run();
    } catch (err) {
      if (i >= QUERY_RETRY_MS.length || !isConnectionError(err)) throw err;
      if (i === 0) console.warn(`Database not reachable (${err instanceof Error ? err.message : String(err)}); trying again…`);
      await sleep(QUERY_RETRY_MS[i]);
    }
  }
}

/**
 * Background work that must not be lost (a visit counted, visits resumed after a restart): while the
 * database can't be reached, tries again every `everyMs` until it works, or until `signal` stops it
 * (then it throws). `onWait` is told each time it has to wait.
 */
export async function untilDbReachable<T>(run: () => Promise<T>, opts: { signal?: AbortSignal; everyMs?: number; onWait?: (err: unknown) => void } = {}): Promise<T> {
  const { signal, everyMs = 30_000, onWait } = opts;
  for (;;) {
    try {
      return await run();
    } catch (err) {
      if (signal?.aborted || !isConnectionError(err)) throw err;
      onWait?.(err);
      await sleep(everyMs, signal);
      if (signal?.aborted) throw new Error("Stopped.");
    }
  }
}
