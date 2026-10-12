# Live console relay

Lets a campaign's live console be watched from any computer, or from home, when the campaign runs on
another PC. It stores nothing and is only used while someone watches: a PC connects to it only while a
page is open on one of its campaigns (it learns that in its usual once-a-minute check), and lets go
a few minutes after the page is closed.

## Deploy (Render, free)

1. In Render: **New → Web Service**, connect this repository.
2. **Root directory:** `relay` · **Build command:** `npm install` · **Start command:** `npm start` · **Instance type:** Free.
3. **Environment:** add `RELAY_SECRET`, copied from the app: **Settings → Live console** (it's made
   from `AUTH_SECRET`, but isn't it: the relay can't sign anyone in).
4. Deploy, then paste the service's address (e.g. `wss://site-auditor-relay.onrender.com`) in
   **Settings → Live console** and save. Every PC uses it from its next minute check.

On the free tier the service sleeps when no one watches; the first page to open wakes it (about 30 s).

## Run locally

```sh
cd relay
npm install
RELAY_SECRET=… npm start   # ws://localhost:8080
```
