import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { timeAgo } from "@/lib/format";
import { lexReport, type Report } from "@/lib/report";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "../parts";
import { GroupNow } from "../client";
import { RANGES, RangeNav, pathOf, pct } from "../shared";

const CHATS = "/admin/chats";

// Job: someone on the team is learning what website visitors ask Lex and how far the chats get;
// next they open the chats behind a topic, or add what it couldn't answer to the notes.
// Layout: four numbers and the daily chats; then the topics (the loud part) beside how far chats get
// and what it couldn't answer; then the exact questions and the pages, quieter, underneath.
export default async function TrendsPage({ searchParams }: PageProps<"/admin/trends">) {
  await connection();
  const name = (await getSettings()).agentName || "Lex";
  const sp = await searchParams;
  const days = RANGES.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const r = await lexReport(days);
  const c = r.current;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-10 pb-16 md:px-8 md:pt-16">
      <PageHeader
        eyebrow={name}
        title="Trends"
        description={`What visitors ask ${name} on your website, and how far the chats get.`}
        actions={<RangeNav days={days} href={(d) => `/admin/trends?days=${d}`} />}
      />

      {c.chats === 0 && r.previous.chats === 0 ? (
        <p className="card px-5 py-10 text-center text-[13.5px] text-muted">
          No chats with {name} in the past {days} days. When visitors start asking, what they ask about shows up here.{" "}
          <Link href="/admin" className="link">
            Set up {name}
          </Link>
        </p>
      ) : (
        <div className="@container flex flex-col gap-6">
          <dl className="card grid grid-cols-2 gap-px overflow-hidden bg-line @2xl:grid-cols-4">
            <Stat label="Chats" value={c.chats} change={change(c.chats, r.previous.chats)} note={`${c.visitors.toLocaleString()} ${c.visitors === 1 ? "visitor" : "visitors"}`} />
            <Stat label="Questions" value={c.questions} change={change(c.questions, r.previous.questions)} note={c.chats ? `${(c.questions / c.chats).toFixed(1)} a chat` : ""} />
            <Stat label="Leads" value={c.leads} change={change(c.leads, r.previous.leads)} note={`${pct(c.leads, c.chats)} of chats`} />
            <Stat label="Clicked “Book a call”" value={c.booked} change={change(c.booked, r.previous.booked)} note={`${pct(c.booked, c.chats)} of chats`} />
          </dl>

          <Daily r={r} />

          <div className="grid gap-6 @4xl:grid-cols-[minmax(0,1fr)_300px]">
            <Topics r={r} />
            <div className="flex min-w-0 flex-col gap-6">
              <Funnel r={r} name={name} />
              <Gaps r={r} name={name} />
            </div>
          </div>

          <div className="grid gap-6 @3xl:grid-cols-2">
            <Card title="Asked word for word" note="Questions asked more than once">
              {r.top.length === 0 ? (
                <Empty>No question has been asked twice yet.</Empty>
              ) : (
                <ol className="divide-y divide-line">
                  {r.top.map((q) => (
                    <li key={q.text} className="flex items-baseline gap-3 px-5 py-2.5 text-[13.5px]">
                      <Link href={`${CHATS}?q=${encodeURIComponent(q.text)}`} className="min-w-0 flex-1 hover:underline">
                        {q.text}
                      </Link>
                      <span className="shrink-0 text-right text-[12px] text-muted">
                        <span className="num font-medium text-ink">{q.count}</span>
                        {q.suggested > 0 && <span className="block">{q.suggested === q.count ? "all from suggestions" : `${q.suggested} from suggestions`}</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
            <div className="flex min-w-0 flex-col gap-6">
              <Card title="Where they ask" note="Chats by page">
                {r.pages.length === 0 ? (
                  <Empty>No questions in this period.</Empty>
                ) : (
                  <ul className="divide-y divide-line">
                    {r.pages.map((p) => (
                      <li key={p.page} className="flex items-baseline gap-3 px-5 py-2.5 text-[13.5px]">
                        <a href={p.page} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                          {pathOf(p.page)}
                        </a>
                        <span className="num shrink-0 text-muted">
                          <span className="font-medium text-ink">{p.chats}</span> {p.chats === 1 ? "chat" : "chats"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title={`Pages ${name} showed`} note="Offered, and how often visitors went">
                {r.shown.length === 0 ? (
                  <Empty>{name} hasn&rsquo;t sent anyone to another page yet.</Empty>
                ) : (
                  <ul className="divide-y divide-line">
                    {r.shown.map((s) => (
                      <li key={s.url} className="flex items-baseline gap-3 px-5 py-2.5 text-[13.5px]">
                        <span className="min-w-0 flex-1 truncate" title={s.url}>
                          {s.label} <span className="text-muted">{pathOf(s.url)}</span>
                        </span>
                        <span className="num shrink-0 text-muted">
                          <span className="font-medium text-ink">{s.went}</span> of {s.offered} went
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function change(cur: number, prev: number) {
  if (!prev) return cur ? "New this period" : "";
  const p = Math.round(((cur - prev) / prev) * 100);
  return p === 0 ? "Same as before" : `${p > 0 ? "+" : "−"}${Math.abs(p)}% on the period before`;
}

/** One number: the figure is the loud part; how it changed and what it means stay quiet. */
function Stat({ label, value, change, note }: { label: string; value: number; change: string; note: string }) {
  return (
    <div className="flex flex-col gap-1 bg-surface px-5 py-4">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="num text-[26px] leading-none font-semibold tracking-[-0.02em] text-ink">{value.toLocaleString()}</dd>
      <dd className="text-[12.5px] text-muted">{[note, change].filter(Boolean).join(" · ") || " "}</dd>
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="card min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line px-5 py-3">
        <h2 className="font-semibold">{title}</h2>
        {note && <span className="text-[12.5px] text-muted">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-center text-[13px] text-muted">{children}</p>;
}

function Daily({ r }: { r: Report }) {
  const max = Math.max(1, ...r.daily.map((d) => d.chats));
  return (
    <section className="card p-5" aria-labelledby="daily">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="daily" className="font-semibold">
          Chats each day
        </h2>
        <span className="text-[12.5px] text-muted">Busiest: {max === 1 && !r.daily.some((d) => d.chats) ? "none yet" : `${max} in a day`}</span>
      </div>
      <div className="flex h-28 items-end gap-[3px]" role="img" aria-label={`Chats each day over ${r.days} days`}>
        {r.daily.map((d, i) => (
          <div key={d.date} className="group flex h-full flex-1 flex-col justify-end" title={`${d.date}: ${d.chats} ${d.chats === 1 ? "chat" : "chats"}, ${d.questions} questions, ${d.leads} leads`}>
            <div
              className="rounded-t-[3px] bg-accent transition-opacity group-hover:opacity-80"
              style={{ height: d.chats ? `${Math.max(4, (d.chats / max) * 100)}%` : "2px", opacity: d.chats ? undefined : 0.25, animation: `rise 500ms var(--ease-out) ${i * 10}ms backwards` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>{r.daily[0]?.date}</span>
        <span>{r.daily.at(-1)?.date}</span>
      </div>
    </section>
  );
}

/** What people ask about, most first: the topic, how often, a few of the questions, and their chats. */
function Topics({ r }: { r: Report }) {
  const max = Math.max(1, ...r.themes.map((t) => t.count));
  const total = r.themes.reduce((n, t) => n + t.count, 0);
  return (
    <Card
      title="Common questions"
      note={r.ungrouped ? `${r.ungrouped} new ${r.ungrouped === 1 ? "question isn’t" : "questions aren’t"} grouped yet` : "Grouped by topic every hour"}
    >
      {r.ungrouped > 0 && (
        <div className="border-b border-line px-5 py-3">
          <GroupNow />
        </div>
      )}
      {r.themes.length === 0 ? (
        <Empty>Topics show up once a few questions are grouped. That happens every hour.</Empty>
      ) : (
        <ol className="divide-y divide-line">
          {r.themes.map((t, i) => (
            <li key={t.theme} className="px-5 py-4">
              <div className="flex items-baseline gap-3">
                <Link href={`${CHATS}?theme=${encodeURIComponent(t.theme)}`} className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-ink hover:underline">
                  {t.theme}
                </Link>
                <span className="num shrink-0 text-[13px] text-muted">
                  <span className="font-medium text-ink">{t.count}</span> {t.count === 1 ? "question" : "questions"} · {pct(t.count, total)}
                </span>
              </div>
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-sunken">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${(t.count / max) * 100}%`, animation: `rise 500ms var(--ease-out) ${i * 40}ms backwards` }} />
              </span>
              <ul className="mt-2.5 flex flex-col gap-1">
                {t.examples.map((q) => (
                  <li key={q} className="truncate text-[13px] text-graphite">
                    &ldquo;{q}&rdquo;
                  </li>
                ))}
              </ul>
              {t.unanswered > 0 && (
                <p className="mt-1.5 text-[12.5px] text-muted">
                  {t.unanswered} {t.unanswered === 1 ? "wasn’t" : "weren’t"} answered.{" "}
                  <Link href={`${CHATS}?theme=${encodeURIComponent(t.theme)}&filter=unanswered`} className="link">
                    See which
                  </Link>
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** How far chats got toward a call, step by step, against all chats. */
function Funnel({ r, name }: { r: Report; name: string }) {
  const chats = r.current.chats;
  const steps = [
    { label: "Chats", n: chats, href: CHATS },
    { label: `${name} offered a call`, n: r.funnel.offered },
    { label: "Clicked “Book a call”", n: r.funnel.clicked, href: `${CHATS}?filter=booked` },
    { label: "Left their details", n: r.funnel.leads, href: `${CHATS}?filter=leads` },
  ];
  const demo = r.offers.find((o) => o.kind === "demo");
  const signup = r.offers.find((o) => o.kind === "signup");
  const extra = [
    demo?.offered ? `Demo: ${demo.clicked} of ${demo.offered} opened it` : "",
    signup?.offered ? `Try it free: ${signup.clicked} of ${signup.offered} clicked` : "",
    r.moves.moved + r.moves.stayed ? `Moving pages: ${r.moves.moved} went, ${r.moves.stayed} stayed` : "",
  ].filter(Boolean);
  return (
    <Card title="How far chats get">
      <ol className="flex flex-col gap-3 px-5 py-4">
        {steps.map((s) => (
          <li key={s.label} className="text-[13.5px]">
            <div className="flex items-baseline gap-3">
              {s.href ? (
                <Link href={s.href} className="min-w-0 flex-1 truncate hover:underline">
                  {s.label}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
              )}
              <span className="num shrink-0 text-muted">
                <span className="font-medium text-ink">{s.n.toLocaleString()}</span> {s.n !== chats && `· ${pct(s.n, chats)}`}
              </span>
            </div>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-sunken">
              <span className="block h-full rounded-full bg-accent" style={{ width: chats ? `${(s.n / chats) * 100}%` : "0%" }} />
            </span>
          </li>
        ))}
      </ol>
      {extra.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-line px-5 py-3 text-[12.5px] text-muted">
          {extra.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Recent questions the agent couldn't answer: what to add to the notes. */
function Gaps({ r, name }: { r: Report; name: string }) {
  return (
    <Card title="Couldn’t answer">
      {r.gaps.length === 0 ? (
        <Empty>{r.themes.length ? `${name} answered every question grouped so far.` : "Shows up once questions are grouped."}</Empty>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {r.gaps.map((g) => (
              <li key={g.text}>
                <Link
                  href={g.count > 1 ? `${CHATS}?filter=unanswered&q=${encodeURIComponent(g.text)}` : `${CHATS}/${g.conversation_id}`}
                  className="flex items-baseline gap-3 px-5 py-2.5 text-[13.5px] hover:bg-sunken"
                >
                  <span className="min-w-0 flex-1">{g.text}</span>
                  <span className="num shrink-0 text-[12px] text-muted">{g.count > 1 ? `${g.count} times` : timeAgo(g.last)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-5 py-3 text-[12.5px] text-muted">
            <Link href="/admin#notes" className="link">
              Add the answers to the notes
            </Link>{" "}
            and {name} uses them from the next question.
          </p>
        </>
      )}
    </Card>
  );
}
