import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { timeAgo } from "@/lib/format";
import type { LexAction } from "@/lib/lex";
import { lexChat, type ChatQuestion } from "@/lib/report";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "../../parts";
import { pathOf, plain } from "../../shared";

// Job: someone on the team is reading one visitor's chat with Lex; next they follow up with the
// lead, or go back to the list.
// Layout: the conversation is the page (visitor on the right, as they saw it); beside it, who they
// are if they left details, what they clicked, and where the chat started.
export default async function ChatPage({ params }: PageProps<"/admin/chats/[id]">) {
  await connection();
  const name = (await getSettings()).agentName || "Lex";
  const { id } = await params;
  const chat = Number.isInteger(Number(id)) ? await lexChat(Number(id)) : null;
  if (!chat) notFound();

  // Each visitor message, matched with its saved question (the newest turns are the ones kept).
  const userTurns = chat.turns.flatMap((t, i) => (t.role === "user" ? [i] : []));
  const offset = chat.questions.length - userTurns.length;
  const questionAt = new Map<number, ChatQuestion>();
  userTurns.forEach((turn, k) => {
    const q = chat.questions[k + offset];
    if (q) questionAt.set(turn, q);
  });
  const first = chat.questions[0]?.text ?? chat.turns.find((t) => t.role === "user")?.content ?? "Chat";
  const count = Math.max(chat.questions.length, userTurns.length);
  const topics = [...new Set(chat.questions.map((q) => q.theme).filter((t): t is string => Boolean(t)))];

  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 pb-16 md:px-8 md:pt-12">
      <Link href="/admin/chats" className="mb-6 inline-block text-[13px] text-muted hover:text-ink">
        ← All chats
      </Link>
      <PageHeader
        eyebrow={`Chat with ${name}`}
        title={<span className="line-clamp-2">{first}</span>}
        description={`${count} ${count === 1 ? "question" : "questions"} · started ${timeAgo(chat.created_at)}${chat.page ? ` on ${pathOf(chat.page)}` : ""}`}
        actions={
          <>
            {chat.newer && (
              <Link href={`/admin/chats/${chat.newer}`} className="btn btn-sm">
                Newer
              </Link>
            )}
            {chat.older && (
              <Link href={`/admin/chats/${chat.older}`} className="btn btn-sm">
                Older
              </Link>
            )}
          </>
        }
      />

      <div className="@container">
      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_260px]">
        <ol className="card flex min-w-0 flex-col gap-6 p-5 md:p-6" aria-label="Conversation">
          {chat.turns.map((t, i) => {
            if (t.role === "user") {
              const q = questionAt.get(i);
              const meta = [q?.page ? pathOf(q.page) : "", q?.via === "suggested" ? "clicked a suggestion" : "", q?.theme ?? "", q ? timeAgo(q.created_at) : ""].filter(Boolean);
              return (
                <li key={i} className="flex flex-col items-end gap-1">
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-sunken px-4 py-2.5 text-[14px] leading-[22px] whitespace-pre-wrap text-ink">{t.content}</p>
                  {meta.length > 0 && <p className="text-right text-[12px] text-muted">{meta.join(" · ")}</p>}
                </li>
              );
            }
            const asked = questionAt.get(i - 1);
            return (
              <li key={i} className="flex flex-col items-start gap-1.5">
                <p className="text-[12px] font-medium text-muted">{name}</p>
                <p className="max-w-[92%] text-[14px] leading-[22px] whitespace-pre-wrap text-graphite">{plain(t.content)}</p>
                {(t.actions?.length ?? 0) > 0 && (
                  <ul className="flex flex-col gap-0.5 text-[12.5px] text-muted">
                    {t.actions!.map((a, k) => (
                      <li key={k}>{describe(a)}</li>
                    ))}
                  </ul>
                )}
                {asked?.answered === 0 && <p className="text-[12.5px] font-medium text-[var(--danger-strong)]">Didn&rsquo;t answer this</p>}
              </li>
            );
          })}
        </ol>

        <aside className="flex min-w-0 flex-col gap-4">
          {chat.lead && (
            <Side title="Lead">
              <p className="text-[14px] font-medium text-ink">{chat.lead.name || "No name given"}</p>
              <a href={`mailto:${chat.lead.email}`} className="link block truncate text-[13px]">
                {chat.lead.email}
              </a>
              {(chat.lead.company || chat.lead.role) && <p className="text-[13px] text-graphite">{[chat.lead.role, chat.lead.company].filter(Boolean).join(", ")}</p>}
              {chat.lead.intent && <p className="mt-2 text-[13px] text-graphite">{chat.lead.intent}</p>}
              {chat.lead.summary && <p className="mt-2 text-[13px] text-muted">{chat.lead.summary}</p>}
              <p className="mt-2 text-[12px] text-muted">Sent to the team {timeAgo(chat.lead.created_at)}</p>
            </Side>
          )}
          <Side title="What they clicked">
            {chat.clicks.length === 0 ? (
              <p className="text-[13px] text-muted">Nothing in the chat.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {chat.clicks.map((c, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-[13px]">
                    <span className="min-w-0 flex-1">{clicked(c.kind, c.url)}</span>
                    <span className="shrink-0 text-[12px] text-muted">{timeAgo(c.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Side>
          <Side title="About this chat">
            <dl className="flex flex-col gap-2 text-[13px]">
              {chat.page && (
                <Fact label="Started on">
                  <a href={chat.page} target="_blank" rel="noreferrer" className="link break-all">
                    {pathOf(chat.page)}
                  </a>
                </Fact>
              )}
              {topics.length > 0 && <Fact label="Topics">{topics.join(", ")}</Fact>}
              <Fact label="Last message">{timeAgo(chat.updated_at)}</Fact>
              {chat.otherChats > 0 && (
                <Fact label="Same visitor">
                  {chat.otherChats} other {chat.otherChats === 1 ? "chat" : "chats"} that day
                </Fact>
              )}
            </dl>
          </Side>
        </aside>
      </div>
      </div>
    </div>
  );
}

function describe(a: LexAction): string {
  switch (a.type) {
    case "navigate":
      return `Showed the ${a.label} page (${pathOf(a.url)})`;
    case "scroll":
      return `Scrolled to “${a.heading}”`;
    case "open":
      return a.kind === "booking" ? "Offered a call" : a.kind === "demo" ? "Offered the interactive demo" : "Offered to try it free";
    case "lead":
      return "Saved their details for the team";
  }
}

function clicked(kind: string, url: string): string {
  switch (kind) {
    case "booking":
      return "Book a call";
    case "demo":
      return "Opened the demo";
    case "signup":
      return "Try it free";
    case "page":
      return `Opened ${pathOf(url)}`;
    case "moved":
      return `Went to ${pathOf(url)}`;
    case "stayed":
      return `Stayed instead of going to ${pathOf(url)}`;
    default:
      return kind;
  }
}

function Side({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card flex flex-col gap-0.5 p-4">
      <h2 className="mb-2 text-[13px] font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
