import "server-only";
import { all, run, tx } from "./db";

// Everything set in the admin, stored as one JSON value per key. Anything never saved uses the
// default below.

export type Settings = {
  /** Whether the chat shows on the website. */
  enabled: boolean;
  /** Your company or product, as visitors know it. */
  companyName: string;
  /** The assistant's name, on the text box and in the chat. */
  agentName: string;
  greeting: string;
  /** Up to four questions shown when the chat opens. */
  starters: string[];
  /** The website Lex reads and works on. */
  siteUrl: string;
  /** Other sites to read too, like your docs or help center; Lex answers from them but doesn't send visitors there. */
  extraSites: string[];
  /** Paths never read or offered (drafts, old variants), as prefixes. */
  excludePaths: string[];
  /** Sites allowed to embed the chat, as hosts ("example.com" also covers its subdomains). */
  allowedSites: string[];
  /** What Lex knows beyond the website: pricing, who it's for, how to handle questions. Treated as true. */
  notes: string;
  /** Who visitors talk to on a call, in the agent's words: "the founders", "our sales team". */
  callWith: string;
  bookingUrl: string;
  bookingLabel: string;
  demoUrl: string;
  demoLabel: string;
  signupUrl: string;
  signupLabel: string;
  /** New leads post here (a Slack incoming webhook). */
  slackWebhookUrl: string;
  /** New leads are also POSTed as JSON here (Zapier, Make, your CRM). */
  leadWebhookUrl: string;
  lastCrawl: string;
};

const DEFAULTS: Settings = {
  enabled: false,
  companyName: "",
  agentName: "Lex",
  greeting: "Hi! Ask me anything about us. I can show you around the site or set up a call with the team.",
  starters: ["What do you do?", "Who is it for?", "How much does it cost?", "Can I see a demo?"],
  siteUrl: "",
  extraSites: [],
  excludePaths: [],
  allowedSites: [],
  notes: "",
  callWith: "our team",
  bookingUrl: "",
  bookingLabel: "Book a call",
  demoUrl: "",
  demoLabel: "Try the demo",
  signupUrl: "",
  signupLabel: "Try it free",
  slackWebhookUrl: "",
  leadWebhookUrl: "",
  lastCrawl: "",
};

export const SETTING_KEYS = Object.keys(DEFAULTS) as (keyof Settings)[];

// Most requests read settings; a short cache spares the database. Saving clears it.
let cache: { at: number; value: Settings } | null = null;
const CACHE_MS = 2_000;

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const rows = await all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const out: Settings = { ...DEFAULTS };
  for (const { key, value } of rows) {
    if (!(key in DEFAULTS)) continue;
    try {
      (out as Record<string, unknown>)[key] = JSON.parse(value);
    } catch {
      // An unreadable value keeps the default.
    }
  }
  cache = { at: Date.now(), value: out };
  return out;
}

export async function updateSettings(patch: Partial<Settings>) {
  await tx(async () => {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULTS) || value === undefined) continue;
      await run("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [key, JSON.stringify(value)]);
    }
  });
  cache = null;
}

/** The company's name for the agent to use: the setting, or the website's own host. */
export function companyOf(s: Settings): string {
  if (s.companyName.trim()) return s.companyName.trim();
  try {
    return new URL(s.siteUrl).host.replace(/^www\./, "");
  } catch {
    return "us";
  }
}
