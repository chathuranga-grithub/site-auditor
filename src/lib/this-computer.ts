// Server-only, local only: which computer this is. Several computers (the QA team's) share one
// database, and each campaign runs on one of them (src/lib/campaigns/scheduler.ts). The id is made
// once, at random, and kept in this computer's local settings. The name is what people see on the
// campaign pages ("Runs on QA PC 2"): the one given in Settings (This computer), else the Windows
// computer name. On Vercel: no computer (null).

import { randomUUID } from "node:crypto";
import os from "node:os";
import { deleteLocalSetting, readLocalSetting, writeLocalSetting } from "./local-settings";

export interface Computer {
  id: string;
  /** The name shown everywhere: the one given in Settings, else the Windows computer name. */
  name: string;
  /** The Windows computer name (e.g. LAPTOP-5J9TO10G). */
  hostname: string;
  /** A name was given in Settings. */
  named: boolean;
}

const ID = "computer_id";
const NAME = "computer_name";

/** A name given in Settings: at most this long. */
export const MAX_COMPUTER_NAME = 40;

let me: Promise<Computer> | null = null;

export async function thisComputer(): Promise<Computer | null> {
  if (process.env.VERCEL) return null;
  me ??= (async () => {
    let id = (await readLocalSetting(ID))?.value;
    if (!id) {
      id = randomUUID();
      await writeLocalSetting(ID, id, null);
    }
    const given = (await readLocalSetting(NAME))?.value?.trim();
    const hostname = os.hostname();
    return { id, name: given || hostname, hostname, named: !!given };
  })().catch((err) => {
    me = null;
    throw err;
  });
  return me;
}

/** Gives this computer a name (empty: back to the Windows computer name). Returns it as it is now. */
export async function nameThisComputer(name: string, by: string | null): Promise<Computer | null> {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, MAX_COMPUTER_NAME);
  if (clean) await writeLocalSetting(NAME, clean, by);
  else await deleteLocalSetting(NAME);
  me = null;
  return thisComputer();
}

/** A suggestion for the name box: the Windows user's name, e.g. "Chathuranga's PC". */
export function suggestedComputerName(): string {
  try {
    const user = os.userInfo().username;
    return user ? `${user.charAt(0).toUpperCase()}${user.slice(1)}'s PC` : "QA PC 1";
  } catch {
    return "QA PC 1";
  }
}
