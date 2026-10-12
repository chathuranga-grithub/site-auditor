"use client";

// A campaign's console when it runs on another PC (or in the other copy of the app on this one): from
// that computer's minute check-in, with Realtime updates on there (src/lib/campaigns/live-snapshot.ts).
// Asked once a minute, while the page follows it; only the lines not shown yet are passed on, read the
// same way as a console here (newline-delimited JSON), so the console and realtime panel work unchanged.
// Up to a minute behind, and only the latest lines.

const EVERY_MS = 60_000;
/** A computer that hasn't checked in for this long is probably off or asleep (it does every minute). */
const QUIET_MS = 3 * 60_000;

interface Live {
  computerName: string | null;
  sharing: boolean;
  lastSeen: string | null;
  campaign: { lines: ({ at: number; lane?: number; type: string } & Record<string, unknown>)[] } | null;
}

/** The campaign's console from the computer that runs it, as a Response, until `signal` aborts. */
export async function snapshotConsole(campaignId: number, signal: AbortSignal): Promise<Response> {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(out) {
      let closed = false;
      const write = (line: object) => !closed && out.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      // What it last said about the computer, so each notice is said once (again only when it changes).
      let said = "";
      const say = (key: string, message: string) => {
        if (key === said) return;
        said = key;
        write({ type: "step", message, at: Date.now() });
      };
      // The lines shown so far: by time, and the ones at the latest time (several can share a ms).
      let lastAt = 0;
      let atLast = new Set<string>();
      const keyOf = (l: { at: number; lane?: number; type: string }, i: number) => `${l.lane ?? 0}|${l.type}|${i}`;

      const ask = async () => {
        try {
          const res = await fetch(`/api/ctr/campaigns/${campaignId}/live`, { signal, cache: "no-store" });
          const live = (await res.json()) as Live & { error?: string };
          if (!res.ok) throw new Error(live.error ?? `Request failed (${res.status})`);
          const pc = live.computerName ?? "the PC that runs it";
          const quiet = live.lastSeen ? Date.now() - Date.parse(live.lastSeen) > QUIET_MS : true;
          if (!live.sharing) say("off", `Realtime updates are off on ${pc}: turn them on there (Settings → This computer) to follow its visits from here.`);
          else if (quiet) say(`quiet`, `${pc} hasn't checked in${live.lastSeen ? ` since ${new Date(live.lastSeen).toLocaleTimeString()}` : ""}: it may be off or asleep.`);
          else if (!live.campaign) say("none", `No visit on ${pc} since its app started.`);
          else say("ok", `Visits on ${pc}, updated every minute (its latest lines).`);
          const lines = live.campaign?.lines ?? [];
          const fresh = lines.filter((l, i) => l.at > lastAt || (l.at === lastAt && !atLast.has(keyOf(l, i))));
          for (const l of fresh) write(l);
          if (fresh.length) {
            lastAt = Math.max(lastAt, ...fresh.map((l) => l.at));
            atLast = new Set(lines.map((l, i) => [l, i] as const).filter(([l]) => l.at === lastAt).map(([l, i]) => keyOf(l, i)));
          }
        } catch (err) {
          if (!signal.aborted) say(`error:${String(err)}`, `Couldn't read what it's doing: ${err instanceof Error ? err.message : String(err)}. Trying again in a minute.`);
        }
      };
      void ask();
      const timer = setInterval(() => void ask(), EVERY_MS);
      signal.addEventListener(
        "abort",
        () => {
          closed = true;
          clearInterval(timer);
          try {
            out.close();
          } catch {
            /* already closed */
          }
        },
        { once: true },
      );
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
}
