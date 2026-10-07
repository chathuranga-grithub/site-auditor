// Runs once when the server starts. On a computer (not Vercel), starts the daily Auto CTR checks,
// which read Google in a browser through the Vietnam proxy (src/lib/campaigns/scheduler.ts).

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.VERCEL) {
    const { startDailyChecks } = await import("./lib/campaigns/scheduler");
    startDailyChecks();
  }
}
