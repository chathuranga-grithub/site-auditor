"use client";

// A campaign's live console through the relay (relay/server.mjs, src/lib/live-relay.ts), for a campaign
// that runs on another PC: from any computer, or from home. Read the same way as the console of a
// campaign that runs here (newline-delimited JSON), so the console and realtime panel work unchanged.
// Plain WebSocket (built into the browser). While the page follows it, it asks again every 2 minutes,
// so the PC keeps sending; closed, the PC lets go a few minutes later.

const ASK_AGAIN_MS = 2 * 60_000;

interface Ticket {
  url: string;
  token: string;
  computerName: string | null;
}

async function ticket(campaignId: number, signal: AbortSignal): Promise<Ticket> {
  const res = await fetch(`/api/ctr/campaigns/${campaignId}/live`, { method: "POST", signal, cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as Ticket & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Couldn't open the live console (${res.status}).`);
  return j;
}

/** The campaign's console through the relay, as a Response, until `signal` aborts or the visit ends. */
export async function relayConsole(campaignId: number, signal: AbortSignal): Promise<Response> {
  const first = await ticket(campaignId, signal);
  const pc = first.computerName ?? "the PC that runs it";
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(out) {
      let closed = false;
      const write = (line: object) => !closed && out.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      const step = (message: string) => write({ type: "step", message, at: Date.now() });
      const close = (error?: string) => {
        if (closed) return;
        if (error) write({ type: "error", message: error, at: Date.now() });
        closed = true;
        clearInterval(again);
        ws.close();
        out.close();
      };

      const ws = new WebSocket(`${first.url}/?token=${encodeURIComponent(first.token)}`);
      step(`Live console of ${pc}, through the relay: connecting…`);
      // Still watching: the PC keeps sending (and the relay keeps the page).
      const again = setInterval(() => void ticket(campaignId, signal).catch(() => {}), ASK_AGAIN_MS);
      let waiting = false;
      ws.addEventListener("message", (e) => {
        let m: { t?: string; pc?: string; lines?: object[]; end?: boolean };
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (m.t === "status" && m.pc === "waiting" && !waiting) {
          waiting = true;
          step(`Waiting for ${pc} to connect (up to a minute; it has to be on, with the app running)…`);
        } else if (m.t === "status" && m.pc === "connected" && waiting) {
          waiting = false;
          step(`${pc} connected.`);
        } else if (m.t === "lines") {
          for (const line of m.lines ?? []) write(line);
          if (m.end) close();
        }
      });
      ws.addEventListener("close", (e) => close(e.code === 4001 ? "The relay didn't accept this page (check RELAY_SECRET in Settings → Live console)." : closed ? undefined : "The live console relay disconnected."));
      signal.addEventListener("abort", () => close(), { once: true });
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
}
