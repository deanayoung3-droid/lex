import { connection } from "next/server";
import { aiConfigured } from "@/lib/ai";
import { companyOf, getSettings } from "@/lib/settings";
import { ChatPanel } from "./panel";

export const metadata = { robots: { index: false, follow: false } };

// The frame's page is see-through. Motion: messages and suggestions ease in (a quick lift with a
// touch of overshoot for suggestions), suggestions fade down when they leave, and nothing moves
// for visitors who ask for reduced motion. The message list scrolls without a visible scrollbar.
// The ring around a countdown empties over the countdown (its length is set where it's used).
const PAGE_CSS = `
html,body{background:transparent!important;color-scheme:normal!important;margin:0;overflow:hidden}
@keyframes lex-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes lex-pop{0%{opacity:0;transform:translateY(10px) scale(.94)}65%{opacity:1;transform:translateY(-1px) scale(1.01)}100%{opacity:1;transform:none}}
@keyframes lex-leave{from{opacity:1;transform:none}to{opacity:0;transform:translateY(6px) scale(.97)}}
.lex-msg{animation:lex-in .24s cubic-bezier(.22,1,.36,1) backwards}
@keyframes lex-drain{from{stroke-dashoffset:0}to{stroke-dashoffset:var(--lex-ring)}}
.lex-pop{animation:lex-pop .3s cubic-bezier(.22,1,.36,1) backwards;transform-origin:right bottom}
.lex-leave{animation:lex-leave .16s ease-in forwards;transform-origin:right bottom}
.lex-drain{animation:lex-drain linear forwards}
.lex-scroll{scrollbar-width:none}.lex-scroll::-webkit-scrollbar{display:none}
@media (prefers-reduced-motion:reduce){.lex-msg,.lex-pop,.lex-leave{animation:none}}
`;

// Rendered inside the frame that /lex.js docks in the bottom-right corner of the company website.
// The page is see-through: collapsed, only the text box shows; expanded, the frame blurs the website behind it and
// the chat is frosted glass over that.
// color-scheme stays "normal" so browsers don't paint an opaque backdrop behind the frame.
export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  await connection();
  const s = await getSettings();
  const { host } = await searchParams;
  const available = s.enabled && aiConfigured();
  return (
    <div className="flex h-dvh flex-col justify-end">
      <style>{PAGE_CSS}</style>
      <ChatPanel
        available={available}
        host={typeof host === "string" ? host : ""}
        allowedSites={s.allowedSites}
        name={s.agentName || "Lex"}
        brand={companyOf(s)}
        greeting={s.greeting}
        starters={s.starters}
        demoUrl={s.demoUrl}
        bookingUrl={s.bookingUrl}
      />
    </div>
  );
}
