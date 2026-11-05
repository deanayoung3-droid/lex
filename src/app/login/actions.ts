"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, SESSION_COOKIE, SESSION_MAX_AGE, sessionToken } from "@/lib/auth";

export type LoginState = { error?: string } | undefined;

// Wrong passwords per address in the last 15 minutes, so the password can't be guessed quickly.
const misses = new Map<string, number[]>();
const WINDOW = 15 * 60_000;
const MAX_MISSES = 10;

export async function signInAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  if (!process.env.ADMIN_PASSWORD) return { error: "Set ADMIN_PASSWORD on the server first (npm run setup does it for you), then restart." };
  const h = await headers();
  const who = h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
  const recent = (misses.get(who) ?? []).filter((t) => Date.now() - t < WINDOW);
  if (recent.length >= MAX_MISSES) return { error: "Too many wrong passwords. Try again in 15 minutes." };
  if (!checkPassword(String(form.get("password") ?? ""))) {
    misses.set(who, [...recent, Date.now()]);
    if (misses.size > 5000) misses.clear();
    return { error: "That password isn't right." };
  }
  misses.delete(who);
  (await cookies()).set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: (h.get("x-forwarded-proto") ?? "").includes("https") || process.env.PUBLIC_URL?.startsWith("https://"),
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect("/admin");
}

export async function signOutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
