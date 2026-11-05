import { visitorId } from "@/lib/ai";
import { CLICK_KINDS, recordClick, type ClickKind } from "@/lib/lex";

// What a visitor clicked in the chat (the booking link, a page it offered, the
// countdown before moving pages), for reporting. Sent with sendBeacon from /chat, so it
// answers 204 whatever happens; only the visitor's own conversation is counted.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const kind = String(body.kind ?? "") as ClickKind;
    const conversation = Number(body.conversation) || 0;
    if (conversation > 0 && CLICK_KINDS.includes(kind)) {
      await recordClick(conversation, visitorId(req.headers), kind, typeof body.url === "string" ? body.url : "");
    }
  } catch {
    // A missed click is fine.
  }
  return new Response(null, { status: 204 });
}
