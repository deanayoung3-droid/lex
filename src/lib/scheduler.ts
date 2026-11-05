import "server-only";
import { aiConfigured } from "./ai";
import { acquireLease, releaseLease } from "./db";
import { crawlSite, groupQuestions } from "./lex";
import { getSettings } from "./settings";

// Background work, inside the server: every few minutes it checks whether the website is due to be
// read again (daily while Lex is on, and once before it's first turned on), and groups new
// questions into topics (hourly). Leases keep two servers from doing the same work at once.

declare global {
  var __lexScheduler: NodeJS.Timeout | undefined;
  var __lexReading: Promise<unknown> | undefined;
}

const DAY = 24 * 60 * 60 * 1000;

export function startScheduler() {
  if (globalThis.__lexScheduler || process.env.SCHEDULER_DISABLED === "1") return;
  globalThis.__lexScheduler = setInterval(() => void tick(), 5 * 60_000);
  setTimeout(() => void tick(), 15_000);
}

async function tick() {
  try {
    const s = await getSettings();
    const due = !s.lastCrawl || Date.now() - Date.parse(s.lastCrawl) > DAY;
    // At most one attempt an hour, so a site that can't be read isn't fetched every few minutes.
    if (s.siteUrl && (s.enabled || !s.lastCrawl) && due && (await acquireLease("site-read-attempt", 60 * 60))) readSiteSoon();
    if (aiConfigured() && (await acquireLease("group-questions", 60 * 60))) {
      const n = await groupQuestions();
      if (n) console.log(`[lex] grouped ${n} questions into topics`);
    }
  } catch (err) {
    console.error("[scheduler]", err);
  }
}

/** Starts reading the website in the background, unless a read is already running. */
export function readSiteSoon(): boolean {
  if (globalThis.__lexReading) return false;
  globalThis.__lexReading = (async () => {
    if (!(await acquireLease("site-read", 30 * 60))) return;
    try {
      const r = await crawlSite();
      console.log(`[lex] read the website: ${r.pages} pages, ${r.sections} sections`);
    } finally {
      await releaseLease("site-read");
    }
  })()
    .catch((err) => console.error("[lex] reading the website", err))
    .finally(() => {
      globalThis.__lexReading = undefined;
    });
  return true;
}

export const readingNow = () => Boolean(globalThis.__lexReading);
