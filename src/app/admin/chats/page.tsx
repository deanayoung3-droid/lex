import Link from "next/link";
import { connection } from "next/server";
import { timeAgo } from "@/lib/format";
import { lexChats, lexThemes, type ChatFilter } from "@/lib/report";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "../parts";
import { pathOf } from "../shared";

const FILTERS: { id: ChatFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "leads", label: "Leads" },
  { id: "booked", label: "Clicked “Book a call”" },
  { id: "unanswered", label: "Couldn’t answer" },
];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// Job: someone on the team is reading what website visitors said to Lex; next they open a chat
// (to follow up on a lead, or to see how it handled a question).
// Layout: filters and search on one line, then one row per chat: the visitor's first question is
// the loud part, the facts about the chat stay quiet, and a lead's name sits on the right.
export default async function ChatsPage({ searchParams }: PageProps<"/admin/chats">) {
  await connection();
  const name = (await getSettings()).agentName || "Lex";
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.id === one(sp.filter))?.id ?? "all";
  const theme = one(sp.theme).slice(0, 60);
  const q = one(sp.q).slice(0, 100);
  const before = Number(one(sp.before)) || undefined;
  const [{ rows, more }, themes] = await Promise.all([lexChats({ filter, theme, q, before }), lexThemes()]);

  const href = (p: { filter?: ChatFilter; theme?: string; q?: string; before?: number }) => {
    const u = new URLSearchParams();
    const f = { filter, theme, q, ...p };
    if (f.filter && f.filter !== "all") u.set("filter", f.filter);
    if (f.theme) u.set("theme", f.theme);
    if (f.q) u.set("q", f.q);
    if (p.before) u.set("before", String(p.before));
    const s = u.toString();
    return `/admin/chats${s ? `?${s}` : ""}`;
  };
  const narrowed = filter !== "all" || theme || q;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-10 pb-16 md:px-8 md:pt-16">
      <PageHeader eyebrow={name} title="Chats" description={`Every conversation visitors have had with ${name} on your website, newest first.`} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Show" className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-sunken p-0.5">
          {FILTERS.map((f) => (
            <Link
              key={f.id}
              href={href({ filter: f.id })}
              aria-current={f.id === filter ? "page" : undefined}
              className={`h-7 shrink-0 rounded-md px-3 text-[12px] leading-7 font-medium whitespace-nowrap transition-all ${
                f.id === filter ? "bg-surface text-ink shadow-[0_1px_2px_rgb(10_13_18/0.08)]" : "text-muted hover:text-ink"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <form method="get" action="/admin/chats" className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:justify-end">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <label className="sr-only" htmlFor="chat-theme">
            Topic
          </label>
          <select id="chat-theme" name="theme" defaultValue={theme} className="field h-8 w-auto py-0 text-[13px]">
            <option value="">Every topic</option>
            {themes.map((t) => (
              <option key={t.theme} value={t.theme}>
                {t.theme} ({t.count})
              </option>
            ))}
            {theme && !themes.some((t) => t.theme === theme) && <option value={theme}>{theme}</option>}
          </select>
          <label className="sr-only" htmlFor="chat-q">
            Search chats
          </label>
          <input id="chat-q" name="q" type="search" defaultValue={q} placeholder="Words, a name, an email" className="field h-8 min-w-0 flex-1 text-[13px] sm:max-w-[240px]" />
          <button type="submit" className="btn btn-sm">
            Search
          </button>
          {narrowed && (
            <Link href="/admin/chats" className="text-[12.5px] text-muted hover:text-ink">
              Clear
            </Link>
          )}
        </form>
      </div>

      {rows.length === 0 ? (
        <p className="card px-5 py-10 text-center text-[13.5px] text-muted">
          {narrowed ? "No chats match. Try fewer words or another topic." : `No chats yet. When visitors talk to ${name}, every conversation shows up here.`}
        </p>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {rows.map((r) => {
            const facts = [
              `${r.questions} ${r.questions === 1 ? "question" : "questions"}`,
              r.page ? `on ${pathOf(r.page)}` : "",
              r.themes.join(", "),
              r.booked ? "clicked “Book a call”" : "",
              r.unanswered ? `${r.unanswered} not answered` : "",
            ].filter(Boolean);
            return (
              <li key={r.id}>
                <Link href={`/admin/chats/${r.id}`} className="flex items-start gap-4 px-5 py-3 transition-colors hover:bg-sunken">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{r.first || "(no question)"}</span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-muted">{facts.join(" · ")}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    {r.lead && <span className="block max-w-[180px] truncate text-[13px] font-medium text-ink">{[r.lead.name, r.lead.company].filter(Boolean).join(", ") || r.lead.email}</span>}
                    <span className="num block text-[12px] text-muted">{timeAgo(r.updated_at)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {(more || before) && (
        <nav aria-label="More chats" className="mt-4 flex justify-between text-[13px]">
          {before ? (
            <Link href={href({})} className="link">
              Newest chats
            </Link>
          ) : (
            <span />
          )}
          {more && (
            <Link href={href({ before: rows.at(-1)?.id })} className="link">
              Older chats
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
