import { AIError, aiConfigured, askAllowed, visitorId } from "@/lib/ai";
import { lexReply, type PageContext } from "@/lib/lex";
import { getSettings } from "@/lib/settings";

// Lex's replies, streamed as newline-delimited JSON:
//   {"type":"delta","text":…} as the reply is written, then
//   {"type":"done","text":…,"actions":[…],"conversation":…} or {"type":"error","message":…}.
// Called from Lex's own page (/chat, in an iframe on the website), so same-origin.

function readPage(v: unknown): PageContext | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const url = typeof p.url === "string" ? p.url.slice(0, 500) : "";
  if (!/^https?:\/\//.test(url)) return null;
  const headings = Array.isArray(p.headings) ? p.headings.filter((h): h is string => typeof h === "string").map((h) => h.slice(0, 120)).slice(0, 40) : [];
  return { url, title: typeof p.title === "string" ? p.title.slice(0, 200) : "", headings };
}

export async function POST(req: Request) {
  const s = await getSettings();
  if (!s.enabled || !aiConfigured()) {
    return Response.json({ error: "The assistant isn't available right now." }, { status: 503 });
  }
  let message = "";
  let conversation: number | null = null;
  let page: PageContext | null = null;
  let via: "typed" | "suggested" = "typed";
  try {
    const body = await req.json();
    message = String(body.message ?? "").trim();
    conversation = Number(body.conversation) || null;
    page = readPage(body.page);
    if (body.via === "suggested") via = "suggested";
  } catch {
    // Falls through to the length check.
  }
  if (message.length < 1 || message.length > 1000) return Response.json({ error: "Write a message up to 1,000 characters." }, { status: 400 });

  const visitor = visitorId(req.headers);
  const allowed = await askAllowed(visitor);
  if (!allowed.ok) return Response.json({ error: allowed.reason }, { status: 429 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const out = await lexReply({ message, conversation, visitor, page, via, onText: (text) => send({ type: "delta", text }), signal: req.signal });
        send({ type: "done", ...out });
      } catch (err) {
        console.error("[lex]", err instanceof Error ? err.message : err);
        send({ type: "error", message: err instanceof AIError ? "I couldn't answer just now. Try again in a moment." : "Something went wrong. Try again." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
