// Which tools an account may use. Admins: every tool. Other users: the tools listed on their
// account (app_users.tools). Each tool owns its pages and API routes; the proxy blocks the rest.

export const TOOL_IDS = ["audit", "rankings", "visit", "ctr"] as const;
export type ToolId = (typeof TOOL_IDS)[number];

/** Pages and API routes that belong to each tool. */
const TOOL_PATHS: Record<ToolId, string[]> = {
  audit: ["/audit", "/api/sitemap", "/api/fetch"],
  rankings: ["/rankings", "/api/serp", "/api/analyze"],
  visit: ["/visit-test", "/api/visit-test", "/api/proxy-settings"],
  ctr: ["/ctr", "/api/ctr"],
};

/** Where each tool starts. */
export const TOOL_HOME: Record<ToolId, string> = { audit: "/audit", rankings: "/rankings", visit: "/visit-test", ctr: "/ctr" };

export function isToolId(v: unknown): v is ToolId {
  return typeof v === "string" && (TOOL_IDS as readonly string[]).includes(v);
}

export function toolForPath(pathname: string): ToolId | null {
  for (const id of TOOL_IDS) {
    if (TOOL_PATHS[id].some((p) => pathname === p || pathname.startsWith(`${p}/`))) return id;
  }
  return null;
}

export function allowedTools(user: { role: "admin" | "user"; tools: ToolId[] | null }): ToolId[] {
  return user.role === "admin" ? [...TOOL_IDS] : (user.tools ?? []).filter(isToolId);
}

/** Paths that belong to no tool (login, sign out, …) are open to every signed-in account. */
export function canUsePath(user: { role: "admin" | "user"; tools: ToolId[] | null }, pathname: string): boolean {
  const tool = toolForPath(pathname);
  return tool === null || allowedTools(user).includes(tool);
}
