// GET /api/ctr/visit-env → { local }: whether campaign visits can run here (they need a real
// browser, so only when the app runs on a computer, not on Vercel).

export async function GET() {
  return Response.json({ local: !process.env.VERCEL });
}
