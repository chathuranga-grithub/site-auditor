// Live console relay: lets a campaign's live console be watched from any computer or from home, when
// the campaign runs on another PC. It keeps nothing: it only passes console lines from the PC that runs
// the campaign to the pages watching it. Deployed on its own (e.g. Render's free tier); see README.md.
//
// Who connects (WebSocket, ?token=… signed with RELAY_SECRET, the key Settings → Live console shows):
// - a PC, only while someone watches one of its campaigns (src/lib/live-relay.ts). Token { r: "pc", pc }.
// - a campaign page (src/components/visit/relay-console.ts). Token { r: "v", c: campaign, pc: its computer }.
// Messages are JSON:
//   relay → PC      { t: "join", c, v }       a page watches campaign c: send it what happened so far
//                   { t: "leave", c }         no page watches campaign c any more
//   PC → relay      { t: "lines", c, lines, to?, first?, end? }   to: one page only (what happened so far)
//   relay → page    { t: "lines", lines, end? }   { t: "status", pc: "waiting" | "connected" }
// Memory stays flat: nothing is stored, and a page that can't keep up is disconnected (it reconnects).

import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const SECRET = process.env.RELAY_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error("RELAY_SECRET is missing (copy it from the app: Settings → Live console).");
  process.exit(1);
}
const PORT = Number(process.env.PORT) || 8080;
/** A page with this much not sent yet can't keep up: disconnected, so memory never piles up. */
const MAX_BUFFERED = 1 << 20;

/** The token's contents if it's signed with RELAY_SECRET and not expired; else null. */
function verify(token) {
  const [body, sig] = String(token ?? "").split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", SECRET).update(body).digest("base64url");
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return t.exp > Date.now() / 1000 ? t : null;
  } catch {
    return null;
  }
}

/** PCs connected now, by computer id. */
const pcs = new Map();
/** Pages watching, by campaign id. */
const watchers = new Map();
let nextViewer = 1;

const send = (ws, msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
function toPage(ws, msg) {
  if (ws.bufferedAmount > MAX_BUFFERED) return ws.close(4008, "Too slow");
  send(ws, msg);
}

const server = createServer((req, res) => {
  // Render checks this to see the service is up.
  res.writeHead(200, { "Content-Type": "text/plain" }).end("Live console relay");
});
const wss = new WebSocketServer({ server, maxPayload: 4 << 20 });

wss.on("connection", (ws, req) => {
  const t = verify(new URL(req.url, "http://relay").searchParams.get("token"));
  if (!t) return ws.close(4001, "Not allowed");
  if (t.r === "pc" && typeof t.pc === "string") onPc(ws, t.pc);
  else if (t.r === "v" && Number.isInteger(t.c) && typeof t.pc === "string") onPage(ws, t.c, t.pc);
  else ws.close(4001, "Not allowed");
});

function onPc(ws, pc) {
  pcs.get(pc)?.close(4000, "Connected again");
  pcs.set(pc, ws);
  // Pages already waiting for this PC: it sends each one what happened so far.
  for (const [c, pages] of watchers) {
    for (const p of pages) {
      if (p.pc !== pc) continue;
      send(p.ws, { t: "status", pc: "connected" });
      send(ws, { t: "join", c, v: p.id });
    }
  }
  ws.on("message", (data) => {
    let m;
    try {
      m = JSON.parse(String(data));
    } catch {
      return;
    }
    if (m.t !== "lines" || !Number.isInteger(m.c)) return;
    const msg = { t: "lines", lines: Array.isArray(m.lines) ? m.lines : [], ...(m.end ? { end: true } : {}) };
    for (const p of watchers.get(m.c) ?? []) {
      if (p.pc !== pc) continue;
      if (m.to != null) {
        if (p.id !== m.to) continue;
        // What happened so far comes first; live lines only after it, so none is shown twice.
        if (m.first) p.ready = true;
      } else if (!p.ready) continue;
      toPage(p.ws, msg);
    }
  });
  ws.on("close", () => {
    if (pcs.get(pc) !== ws) return;
    pcs.delete(pc);
    for (const pages of watchers.values()) {
      for (const p of pages) {
        if (p.pc !== pc) continue;
        p.ready = false;
        send(p.ws, { t: "status", pc: "waiting" });
      }
    }
  });
}

function onPage(ws, c, pc) {
  const p = { id: nextViewer++, ws, pc, ready: false };
  if (!watchers.has(c)) watchers.set(c, new Set());
  watchers.get(c).add(p);
  const host = pcs.get(pc);
  send(ws, { t: "status", pc: host ? "connected" : "waiting" });
  if (host) send(host, { t: "join", c, v: p.id });
  ws.on("close", () => {
    const pages = watchers.get(c);
    pages?.delete(p);
    if (pages?.size) return;
    watchers.delete(c);
    const h = pcs.get(pc);
    if (h) send(h, { t: "leave", c });
  });
}

// Connections that went away without closing (Wi-Fi dropped, PC asleep) are noticed and let go.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.alive === false) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, 30_000);
wss.on("connection", (ws) => {
  ws.alive = true;
  ws.on("pong", () => (ws.alive = true));
});

server.listen(PORT, () => console.log(`Live console relay on port ${PORT}`));
