// Server-only: one Google search at a time across every browser the app runs (campaign visits and
// ranking checks), with a short gap between them. The same keyword searched from several IPs at the
// same moment, by browsers set up alike, looks automated to Google, and it answers with CAPTCHAs.
// A turn is held while the results page loads and is read, including any CAPTCHA wait. In memory on
// globalThis (one local computer; survives a dev reload).

/** The gap between one search ending and the next starting. */
const GAP_MS = 20_000;

const g = globalThis as typeof globalThis & { __googleTurn?: { tail: Promise<void> } };
const state = (g.__googleTurn ??= { tail: Promise.resolve() });

/**
 * Waits for this browser's turn to search Google (onWait is called once if it has to wait); call the
 * returned release when the search is done. A stopped visit (signal) gives its turn up.
 */
export async function takeGoogleTurn(signal?: AbortSignal, onWait?: () => void): Promise<() => void> {
  const before = state.tail;
  let release!: () => void;
  const mine = new Promise<void>((resolve) => (release = resolve));
  let searched = false;
  // The next search starts GAP_MS after this one is released (at once if this one gave its turn up).
  state.tail = before.then(() => mine).then(() => (searched ? new Promise((r) => setTimeout(r, GAP_MS)) : undefined));

  // Said only when the turn doesn't come at once.
  const timer = setTimeout(() => onWait?.(), 50);
  try {
    await new Promise<void>((resolve, reject) => {
      before.then(resolve);
      signal?.addEventListener("abort", () => reject(new Error("Stopped.")), { once: true });
    });
  } catch (err) {
    release(); // never block the searches queued after this one
    throw err;
  } finally {
    clearTimeout(timer);
  }
  searched = true;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    release();
  };
}
