// Server-only: one Google search at a time across every browser the app runs (campaign visits and
// ranking checks), with a short gap between them. The same keyword searched from several IPs at the
// same moment, by browsers set up alike, looks automated to Google, and it answers with CAPTCHAs.
// A turn is held while the results page loads and is read. In memory on globalThis (one local
// computer; survives a dev reload).
// Never stuck: a turn is held at most MAX_HOLD_MS (a browser that froze or failed without giving it
// back can't block the others), and a browser waits for one at most MAX_WAIT_MS (a proxy IP is only
// good for a few minutes): then it gives up this try (TurnWaitError) and the run starts again.

/** The gap between one search ending and the next starting. */
const GAP_MS = 20_000;
/** A turn is given back by itself after this long. */
const MAX_HOLD_MS = 3 * 60_000;
/** The longest a browser waits for its turn. */
const MAX_WAIT_MS = 3 * 60_000;

/** Waited MAX_WAIT_MS for a turn to search Google: this try is given up (the run starts again). */
export class TurnWaitError extends Error {
  constructor() {
    super(`Waited ${MAX_WAIT_MS / 60_000} minutes for the other browsers' Google searches`);
    this.name = "TurnWaitError";
  }
}

const g = globalThis as typeof globalThis & { __googleTurn?: { tail: Promise<void> } };
const state = (g.__googleTurn ??= { tail: Promise.resolve() });

/**
 * Waits for this browser's turn to search Google (onWait is called once if it has to wait); call the
 * returned release when the search is done (released by itself after MAX_HOLD_MS anyway). A stopped
 * visit (signal) gives its turn up; one that waited MAX_WAIT_MS too (TurnWaitError).
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
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      before.then(resolve);
      giveUp = setTimeout(() => reject(new TurnWaitError()), MAX_WAIT_MS);
      signal?.addEventListener("abort", () => reject(new Error("Stopped.")), { once: true });
    });
  } catch (err) {
    // Not taken after all: the searches queued after this one don't wait for it. (The one ahead, if
    // it's stuck, is let go by its own MAX_HOLD_MS.)
    release();
    throw err;
  } finally {
    clearTimeout(timer);
    clearTimeout(giveUp);
  }
  searched = true;
  let done = false;
  const give = () => {
    if (done) return;
    done = true;
    clearTimeout(auto);
    release();
  };
  // Never held forever: a browser that froze or failed without giving it back.
  const auto = setTimeout(() => {
    console.warn(`A Google search held its turn for ${MAX_HOLD_MS / 60_000} minutes; given back so the others can search.`);
    give();
  }, MAX_HOLD_MS);
  return give;
}
