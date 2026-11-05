import { aiConfigured, askAllowed, visitorId } from "@/lib/ai";
import { suggestionFor } from "@/lib/lex";
import { getSettings } from "@/lib/settings";

// A suggested question for the part of the website a visitor has lingered on (lex.js notices the
// pause; the panel asks here). Answers {"suggestion": "…"} or {"suggestion": null}.
export async function POST(req: Request) {
  const s = await getSettings();
  if (!s.enabled || !aiConfigured()) return Response.json({ suggestion: null });
  let url = "";
  let heading = "";
  let target = "";
  try {
    const body = await req.json();
    url = String(body.url ?? "").slice(0, 500);
    heading = String(body.heading ?? "").slice(0, 120);
    target = String(body.target ?? "").slice(0, 120);
  } catch {
    // Falls through to the check below.
  }
  if (!/^https?:\/\//.test(url) || (!heading && !target)) return Response.json({ suggestion: null });
  const allowed = await askAllowed(visitorId(req.headers));
  if (!allowed.ok) return Response.json({ suggestion: null });
  return Response.json({ suggestion: await suggestionFor({ url, heading, target }) });
}
