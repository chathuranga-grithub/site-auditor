// Server-only, local only: which computer this is. Several computers (the QA team's) share one
// database, and each campaign runs on one of them (src/lib/campaigns/scheduler.ts). The id is made
// once, at random, and kept in this computer's local settings; the name is the Windows computer name,
// to show on the campaign page ("Runs on QA-PC-2"). On Vercel: no computer (null).

import { randomUUID } from "node:crypto";
import os from "node:os";
import { readLocalSetting, writeLocalSetting } from "./local-settings";

export interface Computer {
  id: string;
  name: string;
}

const ID = "computer_id";

let me: Promise<Computer> | null = null;

export async function thisComputer(): Promise<Computer | null> {
  if (process.env.VERCEL) return null;
  me ??= (async () => {
    let id = (await readLocalSetting(ID))?.value;
    if (!id) {
      id = randomUUID();
      await writeLocalSetting(ID, id, null);
    }
    return { id, name: os.hostname() };
  })().catch((err) => {
    me = null;
    throw err;
  });
  return me;
}
