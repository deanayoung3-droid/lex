import { pageSuggestions, siteAllowed } from "@/lib/lex";
import { getSettings } from "@/lib/settings";

// Every suggested question written for one page of the website, by section heading, so the chat can
// show the right one the moment a visitor's pointer rests on a section (no model call on hover).
// GET ?url=https://example.com/pricing → {"suggestions": [{"heading": "…", "question": "…"}]}.
// Only for pages of the websites allowed to embed the agent; cached briefly, since they change
// only when the website is read again.
export async function GET(req: Request) {
  const s = await getSettings();
  const url = new URL(req.url).searchParams.get("url")?.slice(0, 500) ?? "";
  if (!s.enabled || !/^https?:\/\//.test(url) || !siteAllowed(url, s.allowedSites)) return Response.json({ suggestions: [] });
  return Response.json({ suggestions: await pageSuggestions(url) }, { headers: { "Cache-Control": "public, max-age=300" } });
}
