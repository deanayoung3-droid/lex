"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { ThinkingOrb } from "thinking-orbs";

type Action =
  | { type: "navigate"; url: string; label: string }
  | { type: "scroll"; heading: string }
  | { type: "open"; url: string; label: string; kind: "demo" | "booking" | "signup" }
  | { type: "lead" };
type Turn = { role: "user" | "assistant"; content: string; actions?: Action[]; status?: "streaming" | "error" };
type Page = { url: string; title: string; headings: string[] };
type Dwell = { heading: string; target: string; kind: "hover" | "view" };
/** How a question was asked: typed, or a suggested one clicked (for reporting). */
type Via = "typed" | "suggested";

const STORE = "lex-chat";
const PREFIX = "lex:";
const MAX_SUGGESTIONS = 4; // questions written on the spot (sections without one written ahead), per visit
const MUTE_MS = 30_000; // after the visitor dismisses a suggestion, none for this long
/** Headings compared loosely: the website's text and the crawl's can differ in case and punctuation. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const SUGGESTION_SECONDS = 14;
const PAD = 12; // room for the bar's shadow inside the frame while it's collapsed

// White gloss and frosted glass, graphite gloss for anything you press.
const GLOSS_DARK = {
  background: "linear-gradient(180deg, #2b2f37 0%, #0a0d12 100%)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.16), inset 0 0 0 1px rgba(255,255,255,.04), 0 1px 2px rgba(10,13,18,.22), 0 6px 16px -8px rgba(10,13,18,.45)",
};
// No outlines anywhere: surfaces separate by soft shadow, not hairlines.
const GLOSS_LIGHT = {
  background: "linear-gradient(180deg, #ffffff 0%, #f6f7f9 100%)",
  boxShadow: "0 1px 2px rgba(10,13,18,.07), 0 4px 14px -6px rgba(10,13,18,.16)",
};
const BAR = {
  background: "linear-gradient(180deg, rgba(255,255,255,.99) 0%, rgba(247,248,250,.97) 100%)",
  boxShadow: "0 1px 3px rgba(10,13,18,.08), 0 16px 34px -14px rgba(10,13,18,.36)",
};
const INPUT = { background: "#fff", boxShadow: "0 1px 2px rgba(10,13,18,.06), 0 10px 26px -14px rgba(10,13,18,.3)" };
const FONT = "Inter, -apple-system, 'SF Pro Text', system-ui, sans-serif";
const CLOSE_MS = 170; // the host page fades the chat out for this long before it becomes the bar again
const IDLE_COLLAPSE_MS = 20_000; // an answered chat closes after this long without the visitor touching it
const SCROLL_COLLAPSE_MS = 1100; // after Lex scrolls the page to a section, the chat closes so it shows
const GO_SECONDS = 5; // Lex counts down this long before taking the visitor to another page; they can stay instead
const RING = 2 * Math.PI * 13; // the countdown ring's length
const FADE_EDGES = "linear-gradient(to bottom, transparent 0, #000 14px, #000 calc(100% - 10px), transparent 100%)";

/**
 * Lex's orb: the "composing" band, drawn from the library's large preset and shown at the size
 * asked for, as on libraries.dev/orbs. Finer, smoother dots than the small presets; full speed at
 * rest, a little faster while it works. Inline (20px and under) uses the preset tuned for text.
 */
function Orb({ px, busy = false, label }: { px: number; busy?: boolean; label?: string }) {
  const preset = px <= 24 ? 20 : 64;
  return (
    <ThinkingOrb
      state="composing"
      size={preset}
      speed={busy ? 1.4 : 1}
      theme="light"
      color="#0a0d12"
      // Shrinking the large preset shrinks its dots too; scale them back so it reads as clearly.
      dotSize={Math.min(1.8, Math.max(1, (0.9 * preset) / px))}
      style={{ width: px, height: px, flexShrink: 0 }}
      {...(label ? { "aria-label": label } : { "aria-hidden": true })}
    />
  );
}

/**
 * Before Lex takes the visitor to another page: where to, a ring that empties, the seconds left,
 * and a way to stay. The move itself is timed by the chat; this only shows it.
 */
function Countdown({ label, until, onStay }: { label: string; until: number; onStay: () => void }) {
  const [left, setLeft] = useState(GO_SECONDS);
  useEffect(() => {
    const tick = () => setLeft(Math.max(1, Math.ceil((until - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [until]);
  return (
    <div className="lex-msg flex items-center gap-3 self-start rounded-[18px] py-2 pr-2 pl-2.5" style={GLOSS_LIGHT}>
      <span className="relative flex size-8 shrink-0 items-center justify-center" aria-hidden>
        <svg viewBox="0 0 32 32" className="absolute inset-0 size-8 -rotate-90">
          <circle cx="16" cy="16" r="13" fill="none" stroke="rgba(10,13,18,.1)" strokeWidth="2.5" />
          <circle
            cx="16"
            cy="16"
            r="13"
            fill="none"
            stroke="#0a0d12"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={RING}
            className="lex-drain"
            style={{ animationDuration: `${GO_SECONDS}s`, ["--lex-ring" as string]: `${RING}` }}
          />
        </svg>
        <span className="text-[13px] font-semibold tabular-nums">{left}</span>
      </span>
      <p className="min-w-0 flex-1 text-[14px] leading-[20px]">
        Taking you to <span className="font-semibold">{label}</span>
        <span className="sr-only"> in a few seconds</span>
      </p>
      <button type="button" onClick={onStay} className="shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-white" style={GLOSS_DARK}>
        Stay here
      </button>
    </div>
  );
}

function allowedHost(origin: string, allowed: string[]): boolean {
  try {
    const host = new URL(origin).host.toLowerCase();
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return true;
    return allowed.some((a) => {
      const h = a.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      return host === h || host.endsWith(`.${h}`);
    });
  } catch {
    return false;
  }
}

/** Bold and links only; everything else is plain text. */
function Formatted({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g);
  return (
    <>
      {parts.map((p, i) => {
        const bold = p.match(/^\*\*([^*]+)\*\*$/);
        if (bold)
          return (
            <strong key={i} className="font-semibold">
              {bold[1]}
            </strong>
          );
        const link = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
        if (link)
          return (
            <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="underline decoration-[#0a0d12]/30 underline-offset-2">
              {link[1]}
            </a>
          );
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

const Icon = ({ d, size = 16, width = 2 }: { d: string; size?: number; width?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const ARROW_UP = "M12 19V5M5.5 11.5 12 5l6.5 6.5";
const NEW_CHAT = "M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z";
const CHEVRON_DOWN = "m6 9 6 6 6-6";
const CLOSE = "M6 6l12 12M18 6 6 18";
const EXTERNAL = "M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4";

/**
 * Lex, inside the frame lex.js docks in the bottom-right corner of the website.
 * Collapsed, it's a glossy text box with the orb, and a suggestion floats above it when the visitor
 * lingers on something. Expanded, it's a frosted glass chat (the frame blurs the page behind it).
 * The conversation lives in this frame's storage, so it carries on across pages of the site.
 * Actions go to the host page by postMessage: navigate and scroll happen there; demo and booking
 * links are buttons, since a page can't open a tab without the visitor's click.
 */
export function ChatPanel(p: {
  available: boolean;
  host: string;
  allowedSites: string[];
  name: string;
  brand: string;
  greeting: string;
  starters: string[];
  demoUrl: string;
  bookingUrl: string;
}) {
  const host = p.host && allowedHost(p.host, p.allowedSites) ? p.host : "";
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversation, setConversation] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [going, setGoing] = useState<{ label: string; until: number } | null>(null);
  const goTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<string | null>(null); // the page a countdown is about to move to
  const convo = useRef<number | null>(null); // the conversation, for reporting clicks
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const shown = useRef<Set<string>>(new Set());
  const known = useRef<Map<string, string>>(new Map()); // this page's questions, written ahead, by heading
  const mutedUntil = useRef(0);
  const open = useRef(false);
  const closing = useRef(false);
  const busy = turns.some((t) => t.status === "streaming");
  const root = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const handlers = useRef<{ ask: (q: string, via?: Via) => void; dwell: (d: Dwell) => void; expand: (open: boolean) => void; pageScroll: () => void }>({
    ask: () => {},
    dwell: () => {},
    expand: () => {},
    pageScroll: () => {},
  });

  const toHost = useCallback((msg: Record<string, unknown>) => host && window.parent.postMessage({ ...msg, type: PREFIX + msg.type }, host), [host]);
  /** Tells reporting what the visitor clicked; sent as a beacon so it survives leaving the page. */
  const track = useCallback((kind: string, url = "") => {
    if (!convo.current) return;
    const body = JSON.stringify({ conversation: convo.current, kind, url });
    try {
      if (!navigator.sendBeacon?.("/api/click", new Blob([body], { type: "application/json" }))) throw new Error("no beacon");
    } catch {
      void fetch("/api/click", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  }, []);
  // Links to the website the chat is on (the booking page, the demo on the home page) take the
  // visitor there in the same tab, with the chat still open; anything else opens a new tab.
  const onSite = useCallback(
    (url: string) => {
      try {
        const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
        return Boolean(host) && bare(new URL(url).host) === bare(new URL(host).host);
      } catch {
        return false;
      }
    },
    [host],
  );
  const follow = (url: string) => (e: MouseEvent) => {
    if (!onSite(url)) return;
    e.preventDefault();
    toHost({ type: "navigate", url });
  };
  // The orb speeds up while Lex looks things up, writes, or moves the visitor.
  const working = busy || Boolean(going);

  // Restore the conversation (it survives page changes on the website), and listen to the host page.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as { conversation: number; turns: Turn[] } | null;
      if (saved?.turns?.length) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage after mount
        setTurns(saved.turns.filter((t) => !t.status));
        setConversation(saved.conversation);
        convo.current = saved.conversation;
      }
    } catch {
      // Storage can be blocked; the chat still works for this page.
    }
    const onMessage = (e: MessageEvent) => {
      if (!host || e.origin !== host || !e.data || typeof e.data !== "object") return;
      const t = String(e.data.type ?? "");
      if (t === `${PREFIX}page` && e.data.page) setPage(e.data.page as Page);
      else if (t === `${PREFIX}expand`) handlers.current.expand(Boolean(e.data.open));
      else if (t === `${PREFIX}ask` && typeof e.data.question === "string") handlers.current.ask(e.data.question.slice(0, 1000), "suggested");
      else if (t === `${PREFIX}pagescroll`) handlers.current.pageScroll();
      else if (t === `${PREFIX}dwell`) handlers.current.dwell({ heading: String(e.data.heading ?? ""), target: String(e.data.target ?? ""), kind: e.data.kind === "view" ? "view" : "hover" });
    };
    window.addEventListener("message", onMessage);
    toHost({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, [host, toHost]);

  // The questions written ahead for this page's sections, fetched once per page, so hovering a
  // section shows its question at once.
  const pageUrl = page?.url ?? "";
  useEffect(() => {
    known.current = new Map();
    if (!pageUrl) return;
    let live = true;
    fetch(`/api/suggestions?url=${encodeURIComponent(pageUrl)}`)
      .then((r) => r.json() as Promise<{ suggestions: { heading: string; question: string }[] }>)
      .then(({ suggestions }) => {
        if (live) known.current = new Map(suggestions.map((x) => [norm(x.heading), x.question]));
      })
      .catch(() => {
        // Without them, suggestions are written on the spot instead.
      });
    return () => {
      live = false;
    };
  }, [pageUrl]);

  useEffect(() => {
    try {
      if (conversation) localStorage.setItem(STORE, JSON.stringify({ conversation, turns: turns.filter((t) => !t.status).slice(-40) }));
    } catch {
      // Blocked storage: nothing to keep.
    }
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns, conversation, going, expanded]);

  // The frame takes the size of what's showing: the bar and what floats above it, or the chat at
  // the height its conversation needs (the host page caps it and the messages scroll past that).
  const empty = turns.length === 0;
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const report = () => {
      const height = expanded
        ? (head.current?.offsetHeight ?? 56) + (content.current?.offsetHeight ?? 0) + 36 + (foot.current?.offsetHeight ?? 64)
        : el.getBoundingClientRect().height;
      toHost({ type: "size", expanded, height: Math.ceil(height) });
    };
    report();
    // Once more after the first paint: the orb's canvas and fonts can arrive a beat later.
    const late = setTimeout(report, 250);
    const ro = new ResizeObserver(report);
    ro.observe(el);
    if (content.current) ro.observe(content.current);
    return () => {
      clearTimeout(late);
      ro.disconnect();
    };
  }, [expanded, empty, toHost]);

  useEffect(() => {
    open.current = expanded;
  }, [expanded]);

  /** The visitor stays on this page: the countdown stops (the reply's link still goes there). */
  const stay = useCallback(() => {
    clearTimeout(goTimer.current);
    setGoing(null);
    if (pending.current) track("stayed", pending.current);
    pending.current = null;
  }, [track]);

  // Opening, the host page fades and lifts the chat in. Closing, it fades the chat out first, then
  // the frame becomes the bar again (and fades that in), so neither change is a jump.
  const expand = useCallback(
    (show: boolean) => {
      if (show) {
        if (closing.current) toHost({ type: "reshow" });
        closing.current = false;
        setExpanded(true);
        setSuggestion(null);
        requestAnimationFrame(() => input.current?.focus());
        return;
      }
      if (!open.current || closing.current) return;
      // Closing the chat mid-countdown stays put: the visitor can't see the countdown to stop it.
      stay();
      closing.current = true;
      toHost({ type: "closing" });
      setTimeout(() => {
        if (!closing.current) return;
        closing.current = false;
        setExpanded(false);
      }, CLOSE_MS);
    },
    [toHost, stay],
  );

  /** A suggestion leaves with a short fade instead of vanishing. */
  const dismiss = useCallback(() => {
    setLeaving(true);
    setTimeout(() => {
      setSuggestion(null);
      setLeaving(false);
    }, 160);
  }, []);

  /**
   * Scrolling happens at once, and the chat steps aside a moment later so the section shows.
   * Moving to another page counts down first, so the reply can be read and the visitor can stay
   * instead; the chat stays closed on the new page. If the move doesn't happen (a link the website
   * won't follow), the countdown clears itself.
   */
  const carryOut = useCallback(
    (actions: Action[]) => {
      for (const a of actions) {
        if (a.type === "scroll") {
          toHost({ type: "scroll", heading: a.heading });
          setTimeout(() => expand(false), SCROLL_COLLAPSE_MS);
        }
        if (a.type === "navigate") {
          clearTimeout(goTimer.current);
          setGoing({ label: a.label, until: Date.now() + GO_SECONDS * 1000 });
          pending.current = a.url;
          goTimer.current = setTimeout(() => {
            pending.current = null;
            track("moved", a.url);
            toHost({ type: "navigate", url: a.url });
            goTimer.current = setTimeout(() => setGoing(null), 3000);
          }, GO_SECONDS * 1000);
        }
      }
    },
    [toHost, expand, track],
  );

  const ask = useCallback(
    async (text: string, via: Via = "typed") => {
      const message = text.trim();
      if (!message || busy) return;
      setDraft("");
      setSuggestion(null);
      setExpanded(true);
      if (input.current) input.current.style.height = "";
      setTurns((all) => [...all, { role: "user", content: message }, { role: "assistant", content: "", status: "streaming" }]);
      const update = (patch: Partial<Turn>) => setTurns((all) => all.map((t, i) => (i === all.length - 1 ? { ...t, ...patch } : t)));
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, conversation, page, via }),
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          update({ status: "error", content: err.error ?? "I couldn't answer just now. Try again in a moment." });
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamed = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const e = JSON.parse(line);
            if (e.type === "delta") {
              streamed += e.text;
              update({ content: streamed });
            } else if (e.type === "done") {
              update({ content: e.text, actions: e.actions, status: undefined });
              setConversation(e.conversation);
              convo.current = e.conversation;
              carryOut(e.actions as Action[]);
            } else if (e.type === "error") {
              update({ status: "error", content: e.message });
            }
          }
        }
      } catch {
        update({ status: "error", content: "Couldn't reach us. Check your connection and try again." });
      }
    },
    [busy, conversation, page, carryOut],
  );

  /** The visitor lingered on part of the page: offer one question about it, now and then. */
  const dwell = useCallback(
    async (d: Dwell) => {
      if (expanded || draft || busy || !page || Date.now() < mutedUntil.current) return;
      // Written ahead for this section: show it at once.
      const ahead = known.current.get(norm(d.heading));
      if (ahead) {
        if (!open.current) {
          setLeaving(false);
          setSuggestion(ahead);
        }
        return;
      }
      // Otherwise write one now (a beat slower), a few times a visit at most.
      const key = `${page.url}|${d.heading}|${d.target}`;
      if (shown.current.has(key) || shown.current.size >= MAX_SUGGESTIONS) return;
      shown.current.add(key);
      try {
        const res = await fetch("/api/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: page.url, heading: d.heading, target: d.target }),
        });
        const { suggestion: text } = (await res.json()) as { suggestion: string | null };
        if (text && !open.current) {
          setLeaving(false);
          setSuggestion(text);
        }
      } catch {
        // A missed suggestion is fine.
      }
    },
    [expanded, draft, busy, page],
  );

  // Once Lex has answered, the chat steps aside on its own: when the visitor scrolls the page, or
  // after 20 quiet seconds. Typing, moving the pointer over the chat, or scrolling it resets the
  // clock, and nothing closes while there's a message half-written.
  const last = turns[turns.length - 1];
  const answered = expanded && !busy && !going && last?.role === "assistant" && !last.status;
  const quietSince = useRef(0);
  useEffect(() => {
    if (!answered || draft) return;
    quietSince.current = Date.now();
    const stir = () => {
      quietSince.current = Date.now();
    };
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, stir, { passive: true });
    const timer = setInterval(() => {
      if (Date.now() - quietSince.current >= IDLE_COLLAPSE_MS) expand(false);
    }, 1000);
    return () => {
      clearInterval(timer);
      for (const e of events) window.removeEventListener(e, stir);
    };
  }, [answered, draft, expand]);

  useEffect(() => {
    handlers.current = {
      ask: (q, via) => void ask(q, via),
      dwell: (d) => void dwell(d),
      expand,
      pageScroll: () => {
        if (answered && !draft) expand(false);
      },
    };
  }, [ask, dwell, expand, answered, draft]);

  useEffect(() => {
    if (!suggestion) return;
    const t = setTimeout(dismiss, SUGGESTION_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [suggestion, dismiss]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (expanded) expand(false);
      else if (suggestion) dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, expand, suggestion, dismiss]);

  function startOver() {
    setTurns([]);
    setConversation(null);
    stay();
    convo.current = null;
    try {
      localStorage.removeItem(STORE);
    } catch {
      // Nothing stored.
    }
    input.current?.focus();
  }

  if (!p.available) return null;

  const bar = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void ask(draft);
      }}
      className={`flex items-end gap-2 rounded-[26px] py-[7px] pr-[7px] ${expanded ? "pl-4" : "pl-2.5"}`}
      style={expanded ? INPUT : BAR}
    >
      <button
        type="button"
        onClick={() => expand(true)}
        aria-label={`Open ${p.name}`}
        hidden={expanded}
        className="flex size-9 shrink-0 items-center justify-center rounded-full"
      >
        <Orb px={32} busy={working} label={busy ? `${p.name} is thinking` : p.name} />
      </button>
      <textarea
        ref={input}
        rows={1}
        value={draft}
        maxLength={1000}
        aria-label={`Ask ${p.name}`}
        placeholder={`Ask ${p.name} anything about ${p.brand}…`}
        onFocus={() => {
          // Clicking into the bar opens the chat (suggestions go away); the chat's own box takes focus.
          if (!expanded) expand(true);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          if (going && e.target.value) stay(); // writing a follow-up means staying to read the answer
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void ask(draft);
          }
        }}
        className="min-w-0 flex-1 resize-none bg-transparent py-[7px] text-[15px] leading-[22px] text-[#0a0d12] outline-none [scrollbar-width:none] placeholder:truncate placeholder:text-[#8a8f9a] [&::-webkit-scrollbar]:hidden"
      />
      <button
        type="submit"
        disabled={busy || !draft.trim()}
        aria-label="Send"
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-30"
        style={GLOSS_DARK}
      >
        <Icon d={ARROW_UP} width={2.2} />
      </button>
    </form>
  );

  if (!expanded) {
    return (
      <div ref={root} className="flex flex-col gap-2" style={{ padding: PAD, fontFamily: FONT }}>
        {suggestion && (
          <div key={suggestion} className={`${leaving ? "lex-leave" : "lex-pop"} flex items-center gap-0.5 self-end rounded-[18px] py-1 pr-1 pl-1`} style={GLOSS_LIGHT}>
            <button type="button" onClick={() => void ask(suggestion, "suggested")} className="rounded-[14px] py-1 pr-1 pl-3 text-left text-[14px] leading-[20px] font-medium text-[#20242b]">
              {suggestion}
            </button>
            <button
              type="button"
              onClick={() => {
                mutedUntil.current = Date.now() + MUTE_MS;
                dismiss();
              }}
              aria-label="Dismiss suggestion"
              className="flex size-7 items-center justify-center rounded-full text-[#8a8f9a] hover:bg-black/[.05] hover:text-[#0a0d12]"
            >
              <Icon d={CLOSE} size={13} />
            </button>
          </div>
        )}
        {bar}
      </div>
    );
  }

  return (
    <div
      ref={root}
      className="relative flex h-dvh flex-col overflow-hidden rounded-[24px] text-[#0a0d12]"
      style={{ background: "linear-gradient(180deg, rgba(255,255,255,.88) 0%, rgba(246,247,251,.8) 100%)", fontFamily: FONT }}
    >
      <header ref={head} className="relative flex h-[56px] shrink-0 items-center gap-2 px-3.5">
        <Orb px={30} busy={working} />
        <p className="flex min-w-0 items-baseline gap-1.5 px-1">
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">{p.name}</span>
          <span className="truncate text-[13px] text-[#5b6170]">· {p.brand} AI</span>
        </p>
        <span className="flex-1" />
        {turns.length > 0 && (
          <button
            type="button"
            onClick={startOver}
            aria-label="Start a new conversation"
            title="New conversation"
            className="flex size-8 items-center justify-center rounded-full text-[#5b6170] transition-colors hover:bg-black/[.05] hover:text-[#0a0d12]"
          >
            <Icon d={NEW_CHAT} size={15} />
          </button>
        )}
        <button
          type="button"
          onClick={() => expand(false)}
          aria-label={`Minimize ${p.name}`}
          className="flex size-8 items-center justify-center rounded-full text-[#5b6170] transition-colors hover:bg-black/[.05] hover:text-[#0a0d12]"
        >
          <Icon d={CHEVRON_DOWN} />
        </button>
      </header>

      {/* No scrollbar and no divider: the messages fade out at the edges as they scroll. */}
      <div
        ref={scroller}
        aria-live="polite"
        aria-busy={busy}
        className="lex-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-[18px]"
        style={{ maskImage: FADE_EDGES, WebkitMaskImage: FADE_EDGES }}
      >
        {turns.length === 0 ? (
          <div ref={content} className="flex flex-col items-center justify-center gap-4 py-4 text-center">
            <Orb px={56} />
            <p className="max-w-[340px] text-[15px] leading-[23px]">{p.greeting}</p>
            {p.starters.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2">
                {p.starters.map((s) => (
                  <button key={s} type="button" onClick={() => void ask(s, "suggested")} className="rounded-full px-3.5 py-2 text-[13.5px] font-medium text-[#20242b]" style={GLOSS_LIGHT}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div ref={content} className="flex flex-col gap-4">
            {turns.map((t, i) =>
              t.role === "user" ? (
                <p
                  key={i}
                  className="lex-msg max-w-[82%] self-end rounded-[20px] rounded-br-[6px] px-4 py-2.5 text-[15px] leading-[22px] whitespace-pre-wrap text-white"
                  style={GLOSS_DARK}
                >
                  {t.content}
                </p>
              ) : (
                <div key={i} className="lex-msg flex max-w-[92%] flex-col gap-3 self-start">
                  {t.status === "streaming" && !t.content ? (
                    <p className="flex items-center gap-2 text-[14px] text-[#5b6170]">
                      <Orb px={20} busy />
                      Thinking…
                    </p>
                  ) : (
                    <p className={`text-[15px] leading-[23px] whitespace-pre-wrap ${t.status === "error" ? "text-[#b42318]" : ""}`}>
                      <Formatted text={t.content} />
                    </p>
                  )}
                  {t.actions && t.actions.some((a) => a.type !== "scroll") && (
                    <div className="flex flex-wrap gap-2">
                      {t.actions.map((a, k) =>
                        a.type === "open" ? (
                          <a
                            key={k}
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              track(a.kind, a.url);
                              follow(a.url)(e);
                            }}
                            className={`inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[13.5px] font-medium ${a.kind === "booking" ? "text-white" : "text-[#0a0d12]"}`}
                            style={a.kind === "booking" ? GLOSS_DARK : GLOSS_LIGHT}
                          >
                            {a.label} {onSite(a.url) ? <span aria-hidden>→</span> : <Icon d={EXTERNAL} size={13} />}
                          </a>
                        ) : a.type === "navigate" ? (
                          <button
                            key={k}
                            type="button"
                            onClick={() => {
                              track("page", a.url);
                              toHost({ type: "navigate", url: a.url });
                            }}
                            className="inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[13.5px] font-medium"
                            style={GLOSS_LIGHT}
                          >
                            Open {a.label} <span aria-hidden>→</span>
                          </button>
                        ) : a.type === "lead" ? (
                          <span key={k} className="self-center text-[12.5px] text-[#5b6170]">
                            Sent to the team
                          </span>
                        ) : null,
                      )}
                    </div>
                  )}
                </div>
              ),
            )}
            {going && <Countdown key={going.until} label={going.label} until={going.until} onStay={stay} />}
          </div>
        )}
      </div>

      <div ref={foot} className="shrink-0 px-3 pt-1 pb-3">{bar}</div>
    </div>
  );
}
