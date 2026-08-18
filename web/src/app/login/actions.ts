"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { setSessionCookie } from "@/lib/session";
import type { UserDoc } from "@/lib/types";

// A real bcrypt hash (cost 12) to compare against when the user doesn't exist,
// so the response takes the same time whether or not the username is valid
// (avoids username enumeration via timing). Computed once at module load.
const DUMMY_HASH = bcrypt.hashSync("sentric-dummy-password", 12);

export async function login(formData: FormData): Promise<void> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  const db = await getDb();
  const user = await db.collection<UserDoc>("users").findOne({ username });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  // Disabled accounts get the same generic error — no reason to tell a caller
  // whether an account exists but is switched off.
  if (!user || !ok || user.disabled) {
    redirect(`/login?error=1&u=${encodeURIComponent(username)}`);
  }

  await setSessionCookie({ userId: user._id!.toString(), username: user.username });
  redirect("/");
}
