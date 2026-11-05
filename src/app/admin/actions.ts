"use server";

import { revalidatePath } from "next/cache";
import { aiConfigured } from "@/lib/ai";
import { requireAdmin } from "@/lib/auth";
import { groupQuestions } from "@/lib/lex";
import { readSiteSoon } from "@/lib/scheduler";
import { getSettings, updateSettings, type Settings } from "@/lib/settings";

export type PanelState = { ok?: string; error?: string } | undefined;

const text = (f: FormData, key: string, max: number) => String(f.get(key) ?? "").trim().slice(0, max);
const lines = (f: FormData, key: string, maxItems: number, maxLen: number) =>
  [...new Set(text(f, key, 20_000).split("\n").map((l) => l.trim().slice(0, maxLen)).filter(Boolean))].slice(0, maxItems);

type Field = (f: FormData) => { value: unknown } | { error: string };

const address = (key: string, what: string, required = false): Field => (f) => {
  const v = text(f, key, 500).replace(/\/$/, "");
  if (!v) return required ? { error: `Enter the ${what}.` } : { value: "" };
  return /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/i.test(v)
    ? { value: v }
    : { error: `The ${what} must be a full address starting with https://.` };
};

/** How each setting is read from a form, checked, and cleaned up. */
const FIELDS: Partial<Record<keyof Settings, Field>> = {
  companyName: (f) => ({ value: text(f, "companyName", 80) }),
  agentName: (f) => ({ value: text(f, "agentName", 40) || "Lex" }),
  greeting: (f) => ({ value: text(f, "greeting", 300) }),
  starters: (f) => ({ value: lines(f, "starters", 4, 80) }),
  siteUrl: address("siteUrl", "website address", true),
  extraSites: (f) => {
    const list = lines(f, "extraSites", 5, 300);
    const bad = list.find((u) => !/^https?:\/\/\S+\.\S+/.test(u));
    return bad ? { error: `“${bad}” isn't a full address starting with https://.` } : { value: list.map((u) => u.replace(/\/$/, "")) };
  },
  excludePaths: (f) => ({
    value: lines(f, "excludePaths", 40, 200).map((l) => {
      try {
        return new URL(l).pathname; // a full address works too
      } catch {
        return l.startsWith("/") ? l : `/${l}`;
      }
    }),
  }),
  allowedSites: (f) => ({ value: lines(f, "allowedSites", 12, 120).map((l) => l.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")) }),
  notes: (f) => ({ value: text(f, "notes", 8000) }),
  callWith: (f) => ({ value: text(f, "callWith", 60) || "our team" }),
  bookingUrl: address("bookingUrl", "booking link"),
  bookingLabel: (f) => ({ value: text(f, "bookingLabel", 40) || "Book a call" }),
  demoUrl: address("demoUrl", "demo link"),
  demoLabel: (f) => ({ value: text(f, "demoLabel", 40) || "Try the demo" }),
  signupUrl: address("signupUrl", "sign-up link"),
  signupLabel: (f) => ({ value: text(f, "signupLabel", 40) || "Try it free" }),
  slackWebhookUrl: (f) => {
    const v = text(f, "slackWebhookUrl", 300);
    return !v || v.startsWith("https://hooks.slack.com/") ? { value: v } : { error: "A Slack webhook address starts with https://hooks.slack.com/." };
  },
  leadWebhookUrl: address("leadWebhookUrl", "webhook address"),
};

/** Saves the fields a form lists in _fields. */
export async function saveAction(_prev: PanelState, form: FormData): Promise<PanelState> {
  await requireAdmin();
  const patch: Partial<Settings> = {};
  for (const key of text(form, "_fields", 1000).split(",").map((k) => k.trim()) as (keyof Settings)[]) {
    const field = FIELDS[key];
    if (!field) continue;
    const r = field(form);
    if ("error" in r) return { error: r.error };
    (patch as Record<string, unknown>)[key] = r.value;
  }
  const before = await getSettings();
  await updateSettings(patch);
  // A new website address is read right away.
  if (patch.siteUrl && patch.siteUrl !== before.siteUrl) readSiteSoon();
  revalidatePath("/admin", "layout");
  return { ok: patch.siteUrl && patch.siteUrl !== before.siteUrl ? "Saved. Reading the new website now." : "Saved." };
}

export async function toggleAction(): Promise<PanelState> {
  await requireAdmin();
  const s = await getSettings();
  if (!s.enabled && !s.siteUrl) return { error: "Add your website's address below first." };
  if (!s.enabled && !aiConfigured()) return { error: "Add an OpenAI API key (OPENAI_API_KEY) on the server first: Lex needs one to answer." };
  await updateSettings({ enabled: !s.enabled });
  revalidatePath("/admin", "layout");
  return { ok: s.enabled ? "Turned off. The chat is hidden on your website." : "Turned on. Visitors see the chat on their next page load." };
}

export async function readSiteAction(): Promise<PanelState> {
  await requireAdmin();
  if (!(await getSettings()).siteUrl) return { error: "Add the website address first." };
  const started = readSiteSoon();
  return { ok: started ? "Reading the website now. Refresh this page in a minute or two to see what it learned." : "Already reading it. Refresh in a minute." };
}

export async function groupNowAction(): Promise<PanelState> {
  await requireAdmin();
  try {
    const n = await groupQuestions();
    revalidatePath("/admin/trends");
    return { ok: n ? `Grouped ${n} ${n === 1 ? "question" : "questions"}.` : "Nothing new to group." };
  } catch {
    return { error: "Couldn't group them just now. Check the OpenAI key, then try again in a minute." };
  }
}
