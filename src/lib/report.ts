import "server-only";
import { all, get } from "./db";
import type { LexAction, LexTurn } from "./lex";

// Reporting: what visitors ask Lex, how far the chats get, and each chat in full. Questions are kept one per row (questions), grouped into topics hourly; clicks
// in the chat are kept in clicks.

const range = (col = "created_at") => `${col} >= now() - make_interval(days => $1) AND ${col} < now() - make_interval(days => $2)`;

export type Totals = { chats: number; visitors: number; questions: number; leads: number; booked: number };

async function totals(fromDays: number, toDays: number): Promise<Totals> {
  const r = await get<Totals>(
    `SELECT (SELECT count(*)::int FROM conversations WHERE ${range()}) AS chats,
            (SELECT count(DISTINCT visitor)::int FROM conversations WHERE ${range()}) AS visitors,
            (SELECT count(*)::int FROM questions WHERE ${range()}) AS questions,
            (SELECT count(*)::int FROM leads WHERE ${range()}) AS leads,
            (SELECT count(DISTINCT conversation_id)::int FROM clicks WHERE kind = 'booking' AND ${range()}) AS booked`,
    [fromDays, toDays],
  );
  return { chats: r?.chats ?? 0, visitors: r?.visitors ?? 0, questions: r?.questions ?? 0, leads: r?.leads ?? 0, booked: r?.booked ?? 0 };
}

export type Report = {
  days: number;
  current: Totals;
  previous: Totals;
  daily: { date: string; chats: number; questions: number; leads: number }[];
  /** Topics, most asked first, with how many the agent couldn't answer and a few examples. */
  themes: { theme: string; count: number; unanswered: number; examples: string[] }[];
  /** Questions asked word for word more than once, most first (often suggested ones clicked). */
  top: { text: string; count: number; suggested: number }[];
  /** The pages visitors were on when they asked. */
  pages: { page: string; questions: number; chats: number }[];
  /** Pages the agent offered to show, and how often visitors went. */
  shown: { url: string; label: string; offered: number; went: number }[];
  /** How far chats got: offered a call, clicked it, left their details. */
  funnel: { offered: number; clicked: number; leads: number };
  offers: { kind: "booking" | "demo" | "signup"; offered: number; clicked: number }[];
  moves: { moved: number; stayed: number };
  /** Questions the agent couldn't answer, most asked first; `conversation_id` is the latest chat. */
  gaps: { text: string; count: number; conversation_id: number; last: string }[];
  /** Questions not yet grouped into a topic (any date). */
  ungrouped: number;
};

export async function lexReport(days: number): Promise<Report> {
  const since = "created_at >= now() - make_interval(days => $1)";
  const perDay = async (table: string) =>
    new Map(
      (
        await all<{ day: string; n: number }>(
          `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS n FROM ${table} WHERE ${since} GROUP BY 1`,
          [days],
        )
      ).map((r) => [r.day, r.n]),
    );
  const [chatsByDay, questionsByDay, leadsByDay, current, previous, themeRows, examples, top, pageRows, actionRows, clickRows, gaps, ungrouped] = await Promise.all([
    perDay("conversations"),
    perDay("questions"),
    perDay("leads"),
    totals(days, 0),
    totals(days * 2, days),
    all<{ theme: string; count: number; unanswered: number }>(
      `SELECT theme, count(*)::int AS count, count(*) FILTER (WHERE answered = 0)::int AS unanswered
         FROM questions WHERE ${since} AND theme IS NOT NULL GROUP BY theme ORDER BY count DESC, max(id) DESC LIMIT 12`,
      [days],
    ),
    all<{ theme: string; text: string }>(`SELECT theme, text FROM questions WHERE ${since} AND theme IS NOT NULL ORDER BY id DESC LIMIT 600`, [days]),
    all<Report["top"][number]>(
      `SELECT min(text) AS text, count(*)::int AS count, count(*) FILTER (WHERE via = 'suggested')::int AS suggested
         FROM questions WHERE ${since} GROUP BY lower(trim(text)) HAVING count(*) > 1 ORDER BY count DESC, max(id) DESC LIMIT 12`,
      [days],
    ),
    all<{ page: string; conversation_id: number }>(`SELECT page, conversation_id FROM questions WHERE ${since} AND page <> '' ORDER BY id DESC LIMIT 5000`, [days]),
    all<{ conversation_id: number; actions: string }>(
      `SELECT conversation_id, actions FROM questions WHERE ${since} AND actions <> '[]' ORDER BY id DESC LIMIT 3000`,
      [days],
    ),
    all<{ conversation_id: number; kind: string; url: string }>(`SELECT conversation_id, kind, url FROM clicks WHERE ${since}`, [days]),
    all<Report["gaps"][number]>(
      `SELECT min(text) AS text, count(*)::int AS count, max(conversation_id) AS conversation_id, max(created_at) AS last
         FROM questions WHERE ${since} AND answered = 0 GROUP BY lower(trim(text)) ORDER BY count DESC, last DESC LIMIT 10`,
      [days],
    ),
    get<{ n: number }>("SELECT count(*)::int AS n FROM questions WHERE theme IS NULL"),
  ]);

  const daily = Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date, chats: chatsByDay.get(date) ?? 0, questions: questionsByDay.get(date) ?? 0, leads: leadsByDay.get(date) ?? 0 };
  });

  // A few different questions under each topic, newest first.
  const byTheme = new Map<string, string[]>();
  for (const e of examples) {
    const list = byTheme.get(e.theme) ?? [];
    if (list.length < 3 && !list.some((t) => t.toLowerCase() === e.text.toLowerCase())) list.push(e.text);
    byTheme.set(e.theme, list);
  }
  const themes = themeRows.map((t) => ({ ...t, examples: byTheme.get(t.theme) ?? [] }));

  // The pages people asked on, one row per page however its address was written.
  const byPage = new Map<string, { questions: number; chats: Set<number> }>();
  for (const r of pageRows) {
    const key = pageKey(r.page);
    const p = byPage.get(key) ?? { questions: 0, chats: new Set<number>() };
    p.questions++;
    p.chats.add(r.conversation_id);
    byPage.set(key, p);
  }
  const pages = [...byPage.entries()]
    .map(([page, p]) => ({ page, questions: p.questions, chats: p.chats.size }))
    .sort((a, b) => b.chats - a.chats || b.questions - a.questions)
    .slice(0, 10);

  // What the agent offered, from each reply's actions, against what visitors clicked.
  const offeredIn = { booking: new Set<number>(), demo: new Set<number>(), signup: new Set<number>() };
  const shownMap = new Map<string, { label: string; offered: number }>();
  for (const r of actionRows) {
    let actions: LexAction[] = [];
    try {
      actions = JSON.parse(r.actions) as LexAction[];
    } catch {
      continue;
    }
    for (const a of actions) {
      if (a.type === "open") offeredIn[a.kind]?.add(r.conversation_id);
      if (a.type === "navigate") {
        const s = shownMap.get(a.url) ?? { label: a.label, offered: 0 };
        s.offered++;
        shownMap.set(a.url, s);
      }
    }
  }
  const clickedIn = (kind: string) => new Set(clickRows.filter((c) => c.kind === kind).map((c) => c.conversation_id)).size;
  const went = (url: string) => clickRows.filter((c) => (c.kind === "page" || c.kind === "moved") && c.url === url).length;
  const shown = [...shownMap.entries()]
    .map(([url, s]) => ({ url, label: s.label, offered: s.offered, went: went(url) }))
    .sort((a, b) => b.offered - a.offered)
    .slice(0, 8);
  const offers = (["booking", "demo", "signup"] as const).map((kind) => ({ kind, offered: offeredIn[kind].size, clicked: clickedIn(kind) }));

  return {
    days,
    current,
    previous,
    daily,
    themes,
    top,
    pages,
    shown,
    funnel: { offered: offeredIn.booking.size, clicked: clickedIn("booking"), leads: current.leads },
    offers,
    moves: { moved: clickRows.filter((c) => c.kind === "moved").length, stayed: clickRows.filter((c) => c.kind === "stayed").length },
    gaps,
    ungrouped: ungrouped?.n ?? 0,
  };
}

/** A page's address without its query, fragment, "www.", or trailing slash. */
function pageKey(url: string) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url;
  }
}

/* Chats */

export type ChatFilter = "all" | "leads" | "booked" | "unanswered";

export type ChatRow = {
  id: number;
  page: string;
  created_at: string;
  updated_at: string;
  first: string;
  questions: number;
  themes: string[];
  unanswered: number;
  booked: boolean;
  lead: { name: string; company: string; email: string } | null;
};

/** Chats newest first, 40 at a time (older ones with `before`), filtered and searched. */
export async function lexChats(f: { filter?: ChatFilter; theme?: string; q?: string; before?: number; limit?: number }): Promise<{ rows: ChatRow[]; more: boolean }> {
  const limit = f.limit ?? 40;
  const where: string[] = [];
  const params: unknown[] = [];
  const param = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.filter === "leads") where.push("c.lead_id IS NOT NULL");
  if (f.filter === "booked") where.push("EXISTS (SELECT 1 FROM clicks k WHERE k.conversation_id = c.id AND k.kind = 'booking')");
  if (f.filter === "unanswered") where.push("EXISTS (SELECT 1 FROM questions q WHERE q.conversation_id = c.id AND q.answered = 0)");
  if (f.theme) where.push(`EXISTS (SELECT 1 FROM questions q WHERE q.conversation_id = c.id AND q.theme = ${param(f.theme)})`);
  if (f.q?.trim()) {
    const like = param(`%${f.q.trim().slice(0, 100).replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where.push(`(c.messages ILIKE ${like} OR l.email ILIKE ${like} OR l.name ILIKE ${like} OR l.company ILIKE ${like})`);
  }
  if (f.before) where.push(`c.id < ${param(f.before)}`);
  const rows = await all<{
    id: number;
    page: string;
    created_at: string;
    updated_at: string;
    first: string | null;
    questions: number;
    themes: string | null;
    unanswered: number;
    booked: boolean;
    lead_name: string | null;
    lead_company: string | null;
    lead_email: string | null;
    messages: string;
  }>(
    `SELECT c.id, c.page, c.created_at, c.updated_at, c.messages,
            (SELECT q.text FROM questions q WHERE q.conversation_id = c.id ORDER BY q.id LIMIT 1) AS first,
            (SELECT count(*)::int FROM questions q WHERE q.conversation_id = c.id) AS questions,
            (SELECT string_agg(DISTINCT q.theme, '|') FROM questions q WHERE q.conversation_id = c.id) AS themes,
            (SELECT count(*)::int FROM questions q WHERE q.conversation_id = c.id AND q.answered = 0) AS unanswered,
            EXISTS (SELECT 1 FROM clicks k WHERE k.conversation_id = c.id AND k.kind = 'booking') AS booked,
            l.name AS lead_name, l.company AS lead_company, l.email AS lead_email
       FROM conversations c LEFT JOIN leads l ON l.id = c.lead_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY c.id DESC LIMIT ${param(limit + 1)}`,
    params,
  );
  return {
    more: rows.length > limit,
    rows: rows.slice(0, limit).map((r) => {
      const turns = r.first ? [] : (JSON.parse(r.messages) as LexTurn[]);
      return {
        id: r.id,
        page: r.page,
        created_at: r.created_at,
        updated_at: r.updated_at,
        first: r.first ?? turns.find((t) => t.role === "user")?.content ?? "",
        questions: r.questions || turns.filter((t) => t.role === "user").length,
        themes: r.themes ? r.themes.split("|") : [],
        unanswered: r.unanswered,
        booked: Boolean(r.booked),
        lead: r.lead_email !== null ? { name: r.lead_name ?? "", company: r.lead_company ?? "", email: r.lead_email } : null,
      };
    }),
  };
}

/** Topics with chats in the last 90 days, for filtering the chat list. */
export async function lexThemes(): Promise<{ theme: string; count: number }[]> {
  return all(
    `SELECT theme, count(DISTINCT conversation_id)::int AS count FROM questions
      WHERE theme IS NOT NULL AND created_at >= now() - interval '90 days' GROUP BY theme ORDER BY count DESC, theme LIMIT 40`,
  );
}

export type ChatQuestion = { id: number; text: string; page: string; via: string; theme: string | null; answered: number | null; created_at: string };

/** One chat in full: its turns, each question's details, the lead, and what the visitor clicked. */
export async function lexChat(id: number) {
  const c = await get<{ id: number; visitor: string; page: string; messages: string; lead_id: number | null; created_at: string; updated_at: string }>(
    "SELECT id, visitor, page, messages, lead_id, created_at, updated_at FROM conversations WHERE id = $1",
    [id],
  );
  if (!c) return null;
  const [questions, clicks, lead, older, newer, sameVisitor] = await Promise.all([
    all<ChatQuestion>("SELECT id, text, page, via, theme, answered, created_at FROM questions WHERE conversation_id = $1 ORDER BY id", [id]),
    all<{ kind: string; url: string; created_at: string }>("SELECT kind, url, created_at FROM clicks WHERE conversation_id = $1 ORDER BY id", [id]),
    c.lead_id
      ? get<{ name: string; email: string; company: string; role: string; intent: string; summary: string; created_at: string }>(
          "SELECT name, email, company, role, intent, summary, created_at FROM leads WHERE id = $1",
          [c.lead_id],
        )
      : Promise.resolve(undefined),
    get<{ id: number }>("SELECT id FROM conversations WHERE id < $1 ORDER BY id DESC LIMIT 1", [id]),
    get<{ id: number }>("SELECT id FROM conversations WHERE id > $1 ORDER BY id LIMIT 1", [id]),
    get<{ n: number }>("SELECT count(*)::int AS n FROM conversations WHERE visitor = $1 AND id <> $2", [c.visitor, id]),
  ]);
  return {
    id: c.id,
    page: c.page,
    created_at: c.created_at,
    updated_at: c.updated_at,
    turns: JSON.parse(c.messages) as LexTurn[],
    questions,
    clicks,
    lead: lead ?? null,
    older: older?.id ?? null,
    newer: newer?.id ?? null,
    otherChats: sameVisitor?.n ?? 0,
  };
}
