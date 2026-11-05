import { headers } from "next/headers";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { aiConfigured, aiCost } from "@/lib/ai";
import { timeAgo, usd } from "@/lib/format";
import { learnedPages, lexStats, recentConversations, recentLeads } from "@/lib/lex";
import { readingNow } from "@/lib/scheduler";
import { companyOf, getSettings } from "@/lib/settings";
import { readSiteAction, saveAction, toggleAction } from "./actions";
import { CopyField, Panel } from "./client";
import { PageHeader } from "./parts";

const bare = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
const FIELD = "flex flex-col gap-1.5 text-[13px] font-medium";
const HINT = "font-normal text-muted";

// Job: the person who runs the website sets Lex up (install it, what it reads, where it sends
// people) and turns it on; next they check the leads and chats it brings in.
// Layout: the header holds the on/off switch; four numbers say how it's doing; then each setting as
// a row (what it is on the left, the fields on the right), in the order they're needed; then the
// latest leads and chats.
export default async function SetupPage() {
  await connection();
  const h = await headers();
  const origin = (process.env.PUBLIC_URL || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`).replace(/\/$/, "");
  const [s, pages, leads, conversations, stats, cost] = await Promise.all([getSettings(), learnedPages(), recentLeads(8), recentConversations(8), lexStats(), aiCost()]);
  const name = s.agentName || "Lex";
  const site = bare(s.siteUrl) || "your website";
  const sections = pages.reduce((n, p) => n + p.sections, 0);
  const words = s.notes.trim() ? s.notes.trim().split(/\s+/).length : 0;
  const reading = readingNow();

  return (
    <div className="mx-auto max-w-[1040px] px-4 py-10 md:px-10 md:py-14">
      <PageHeader
        eyebrow="Setup"
        title={name}
        description={`${name} answers visitors on ${site}, shows them the right page, and gets interested ones to the next step.`}
        actions={
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-muted">{s.enabled ? `${name} is on` : `${name} is off`}</span>
            <Panel action={toggleAction} submitLabel={s.enabled ? "Turn off" : "Turn on"} pendingLabel="…" inline />
          </div>
        }
      />

      {!aiConfigured() && <p className="notice mb-8">Add an OpenAI API key (OPENAI_API_KEY) on the server and restart it: {name} needs one to answer.</p>}

      <dl className="card grid grid-cols-2 gap-px overflow-hidden bg-line sm:grid-cols-4">
        <Stat label="Pages it knows" value={pages.length.toLocaleString()} note={reading ? "Reading now…" : s.lastCrawl ? `Read ${timeAgo(s.lastCrawl)}` : "Not read yet"} />
        <Stat label="Chats" value={stats.conversations.toLocaleString()} note="Last 30 days" />
        <Stat label="Leads" value={stats.leads.toLocaleString()} note="Last 30 days" />
        <Stat label="AI cost" value={usd(cost)} note="Last 30 days" />
      </dl>

      <div className="mt-6">
        <Row
          id="install"
          title="Install"
          description={`Paste this before the closing </body> tag on every page of ${site}. In Framer: Site Settings → General → Custom Code → End of <body> tag. It stays hidden while ${name} is off.`}
        >
          <CopyField value={`<script src="${origin}/lex.js" defer></script>`} />
          <Panel action={saveAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="allowedSites" />
            <label className={FIELD}>
              Websites allowed to show it
              <span className={HINT}>One per line. A domain covers its subdomains, so framer.app covers Framer previews. The chat only works on sites listed here.</span>
              <textarea name="allowedSites" defaultValue={s.allowedSites.join("\n")} rows={3} placeholder="example.com" className="field font-mono text-[13px] font-normal" />
            </label>
          </Panel>
        </Row>

        <Row
          id="website"
          title="The website"
          description={`${name} reads ${site} from its sitemap and answers from it, and rereads it every day while it's on. Add other sites it should know, like your docs.`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-ink tabular-nums">{pages.length ? `${pages.length} pages, ${sections} sections` : "Not read yet"}</p>
              <p className="text-[12.5px] text-muted">
                {reading ? "Reading it now. Refresh in a minute." : s.lastCrawl ? `Last read ${timeAgo(s.lastCrawl)}` : "It's read as soon as you save the address."}
              </p>
            </div>
            {s.siteUrl && <Panel action={readSiteAction} submitLabel="Read it again" pendingLabel="Starting…" inline />}
          </div>
          {pages.length > 0 && (
            <details className="text-[13px]">
              <summary className="cursor-pointer text-muted select-none hover:text-ink">Show the pages</summary>
              <ul className="mt-3 flex max-h-64 flex-col overflow-y-auto">
                {pages.map((p) => (
                  <li key={p.url} className="flex min-w-0 items-baseline gap-3 py-1">
                    <span className="min-w-0 flex-1 truncate">{p.title || bare(p.url)}</span>
                    <span className="shrink-0 truncate text-muted">{bare(p.url)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <Panel action={saveAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="siteUrl,extraSites,excludePaths" />
            <label className={FIELD}>
              Website
              <input name="siteUrl" defaultValue={s.siteUrl} placeholder="https://example.com" required className="field font-normal" />
            </label>
            <label className={FIELD}>
              Other sites to read{" "}
              <span className={HINT}>Up to five, one per line, like your docs or help center. {name} answers from them but only sends visitors to pages of your website.</span>
              <textarea name="extraSites" defaultValue={s.extraSites.join("\n")} rows={2} placeholder="https://docs.example.com" className="field font-mono text-[13px] font-normal" />
            </label>
            <label className={FIELD}>
              Pages to leave out
              <span className={HINT}>One path per line; everything under it is left out too. Pages marked archived, draft, variant, old, or test are always left out.</span>
              <textarea name="excludePaths" defaultValue={s.excludePaths.join("\n")} rows={2} placeholder="/old-pricing" className="field font-mono text-[13px] font-normal" />
            </label>
          </Panel>
        </Row>

        <Row
          id="notes"
          title="What it knows"
          description={`Everything ${name} should know beyond the website: pricing details, who it's for, how you compare, how to handle common questions. It treats these as true.`}
        >
          <Panel action={saveAction} submitLabel="Save notes">
            <input type="hidden" name="_fields" value="notes" />
            <label className={FIELD}>
              <span className="flex items-baseline justify-between gap-3">
                Notes <span className={`${HINT} tabular-nums`}>{words ? `${words.toLocaleString()} words` : "Empty"}</span>
              </span>
              <textarea
                name="notes"
                defaultValue={s.notes}
                rows={14}
                maxLength={8000}
                placeholder={"WHO IT'S FOR\nSmall teams that…\n\nPRICING\nFree for up to 3 users, then…\n\nCOMMON QUESTIONS\nDo you integrate with Slack? Yes…"}
                className="field min-h-[220px] text-[13.5px] leading-[1.6] font-normal"
              />
            </label>
          </Panel>
        </Row>

        <Row
          id="links"
          title="Where it sends people"
          description={`${name} works toward the next step: a call first, or signing up for visitors who aren't ready to talk. Each link becomes a button in the chat; leave one empty and ${name} won't offer it.`}
        >
          <Panel action={saveAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="callWith,bookingUrl,bookingLabel,signupUrl,signupLabel,demoUrl,demoLabel" />
            <label className={FIELD}>
              Who visitors talk to <span className={HINT}>In {name}&rsquo;s words: &ldquo;a call with …&rdquo;.</span>
              <input name="callWith" defaultValue={s.callWith} placeholder="our team" className="field font-normal sm:max-w-[280px]" />
            </label>
            <LinkPair label="Book a call" url="bookingUrl" urlValue={s.bookingUrl} name="bookingLabel" nameValue={s.bookingLabel} placeholder="https://cal.com/you/intro" />
            <LinkPair label="Sign up" url="signupUrl" urlValue={s.signupUrl} name="signupLabel" nameValue={s.signupLabel} placeholder="https://app.example.com/signup" />
            <LinkPair label="Demo" url="demoUrl" urlValue={s.demoUrl} name="demoLabel" nameValue={s.demoLabel} placeholder="https://example.com/demo" />
          </Panel>
        </Row>

        <Row id="greeting" title="Name and greeting" description="The name shows on the text box in the corner of your website; the greeting and suggested questions open the chat.">
          <Panel action={saveAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="agentName,companyName,greeting,starters" />
            <div className="grid gap-5 sm:grid-cols-2">
              <label className={FIELD}>
                Assistant&rsquo;s name
                <input name="agentName" defaultValue={s.agentName} maxLength={40} className="field font-normal" />
              </label>
              <label className={FIELD}>
                Company or product
                <input name="companyName" defaultValue={s.companyName} maxLength={80} placeholder={companyOf(s)} className="field font-normal" />
              </label>
            </div>
            <label className={FIELD}>
              Greeting
              <textarea name="greeting" defaultValue={s.greeting} rows={2} maxLength={300} className="field font-normal" />
            </label>
            <label className={FIELD}>
              Suggested questions <span className={HINT}>Up to four, one per line.</span>
              <textarea name="starters" defaultValue={s.starters.join("\n")} rows={4} className="field font-normal" />
            </label>
          </Panel>
        </Row>

        <Row id="leads" title="New leads" description={`When a visitor leaves their email, ${name} saves them here and can tell you right away.`}>
          <Panel action={saveAction} submitLabel="Save">
            <input type="hidden" name="_fields" value="slackWebhookUrl,leadWebhookUrl" />
            <label className={FIELD}>
              Slack <span className={HINT}>An incoming webhook for the channel to post in (api.slack.com/apps → Incoming Webhooks).</span>
              <input name="slackWebhookUrl" defaultValue={s.slackWebhookUrl} placeholder="https://hooks.slack.com/services/…" className="field font-mono text-[13px] font-normal" />
            </label>
            <label className={FIELD}>
              Webhook <span className={HINT}>Each lead is also POSTed here as JSON, for Zapier, Make, or your CRM.</span>
              <input name="leadWebhookUrl" defaultValue={s.leadWebhookUrl} placeholder="https://hooks.zapier.com/…" className="field font-mono text-[13px] font-normal" />
            </label>
          </Panel>
        </Row>
      </div>

      <div className="mt-14 grid gap-6 lg:grid-cols-2">
        <Activity id="recent-leads" title="Leads" empty="When a visitor leaves their email for a call or a follow-up, they show up here.">
          {leads.map((l) => (
            <li key={l.id} className="flex flex-col gap-0.5 px-5 py-3">
              <p className="flex min-w-0 items-baseline gap-2 text-[14px]">
                {l.conversation_id ? (
                  <Link href={`/admin/chats/${l.conversation_id}`} className="truncate font-medium hover:underline">
                    {[l.name, l.company].filter(Boolean).join(", ") || l.email}
                  </Link>
                ) : (
                  <span className="truncate font-medium">{[l.name, l.company].filter(Boolean).join(", ") || l.email}</span>
                )}
                <span className="ml-auto shrink-0 text-[12px] text-muted">{timeAgo(l.created_at)}</span>
              </p>
              <p className="truncate text-[13px] text-graphite">
                <a href={`mailto:${l.email}`} className="link">
                  {l.email}
                </a>
                {l.intent ? ` · ${l.intent}` : ""}
              </p>
              {l.summary && <p className="line-clamp-2 text-[13px] text-muted">{l.summary}</p>}
            </li>
          ))}
        </Activity>

        <Activity
          id="recent-chats"
          title="Recent chats"
          note={
            <Link href="/admin/chats" className="link">
              Every chat
            </Link>
          }
          empty={`Once ${name} is on and visitors start asking, their first questions show up here.`}
        >
          {conversations.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/chats/${c.id}`} className="flex min-w-0 items-baseline gap-3 px-5 py-3 text-[13.5px] transition-colors hover:bg-sunken">
                <span className="min-w-0 flex-1 truncate">{c.first}</span>
                <span className="shrink-0 text-[12px] text-muted tabular-nums">
                  {Math.ceil(c.turns / 2)} {Math.ceil(c.turns / 2) === 1 ? "message" : "messages"}
                  {c.lead ? " · lead" : ""} · {timeAgo(c.updated_at)}
                </span>
              </Link>
            </li>
          ))}
        </Activity>
      </div>
    </div>
  );
}

/** One number in the summary strip: the figure is the loud part, its label and note stay quiet. */
function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-1 bg-surface px-5 py-4">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="text-[26px] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">{value}</dd>
      <dd className="text-[12.5px] text-muted">{note}</dd>
    </div>
  );
}

/** A link and its button's words, side by side. */
function LinkPair({ label, url, urlValue, name, nameValue, placeholder }: { label: string; url: string; urlValue: string; name: string; nameValue: string; placeholder: string }) {
  return (
    <fieldset className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
      <legend className="mb-1.5 text-[13px] font-medium">{label}</legend>
      <input name={url} defaultValue={urlValue} placeholder={placeholder} aria-label={`${label} link`} className="field font-normal" />
      <input name={name} defaultValue={nameValue} aria-label={`${label} button text`} className="field font-normal" />
    </fieldset>
  );
}

/** A settings row: what it is on the left, its fields in a card on the right (stacked on phones). */
function Row({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid scroll-mt-6 gap-4 border-t border-line-soft py-10 md:grid-cols-[260px_minmax(0,1fr)] md:gap-10">
      <div>
        <h2 id={`${id}-title`} className="text-[15px] font-semibold text-ink">
          {title}
        </h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{description}</p>
      </div>
      <div className="card flex min-w-0 flex-col gap-5 p-5">{children}</div>
    </section>
  );
}

/** A list under the settings: a title line, then rows in a card, or a quiet empty state. */
function Activity({ id, title, note, empty, children }: { id: string; title: string; note?: ReactNode; empty: string; children: ReactNode[] }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-[15px] font-semibold text-ink">
          {title}
        </h2>
        {note && <span className="text-[12.5px] text-muted">{note}</span>}
      </div>
      {children.length ? <ul className="card flex flex-col divide-y divide-line">{children}</ul> : <p className="card px-5 py-8 text-center text-[13px] text-muted">{empty}</p>}
    </section>
  );
}
