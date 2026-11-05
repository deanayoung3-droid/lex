import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// The admin has one password, ADMIN_PASSWORD. Signing in sets a cookie signed with SESSION_SECRET
// that lasts 30 days; changing the password signs everyone out.

export const SESSION_COOKIE = "lex_session";
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

const key = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
const digest = (v: string) => crypto.createHash("sha256").update(v).digest();
const sign = (v: string) => crypto.createHmac("sha256", key()).update(v).digest("base64url");
/** Part of every session, so a new password ends the old sessions. */
const passwordMark = () => digest(`lex-session|${process.env.ADMIN_PASSWORD ?? ""}`).toString("base64url").slice(0, 12);

export function checkPassword(password: string): boolean {
  const want = process.env.ADMIN_PASSWORD;
  if (!want || !password) return false;
  return crypto.timingSafeEqual(digest(password), digest(want));
}

export function sessionToken(): string {
  const value = `${Date.now() + SESSION_MAX_AGE * 1000}.${passwordMark()}`;
  return `${value}.${sign(value)}`;
}

export async function signedIn(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const [exp, mark, sig] = token.split(".");
  if (!exp || !mark || !sig || !key() || !process.env.ADMIN_PASSWORD) return false;
  const want = sign(`${exp}.${mark}`);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return false;
  return Number(exp) > Date.now() && mark === passwordMark();
}

/** For admin pages and actions: sends anyone not signed in to the sign-in page. */
export async function requireAdmin() {
  if (!(await signedIn())) redirect("/login");
}
