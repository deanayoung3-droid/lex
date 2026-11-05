import "server-only";
import { getSettings } from "./settings";

// When a visitor leaves their details: a Slack message (an incoming webhook URL from Settings or
// SLACK_WEBHOOK_URL), and a JSON POST to your own webhook (Zapier, Make, a CRM) if one is set.

export type Lead = { id: number; conversation: number; name: string; email: string; company: string; role: string; intent: string; summary: string; page: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function notifyLead(lead: Lead) {
  const s = await getSettings();
  const admin = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
  const chat = admin ? `${admin}/admin/chats/${lead.conversation}` : "";
  const slack = s.slackWebhookUrl || process.env.SLACK_WEBHOOK_URL || "";
  const jobs: Promise<unknown>[] = [];
  if (slack) {
    const who = [lead.name, lead.company].filter(Boolean).join(", ") || "a visitor";
    const text = [
      `:sparkles: *New lead from the website:* ${esc(who)}${lead.email ? ` · ${esc(lead.email)}` : ""}`,
      lead.intent && `Wants: ${esc(lead.intent)}`,
      lead.summary && `> ${esc(lead.summary)}`,
      lead.page && `On ${esc(lead.page)}`,
      chat && `<${chat}|Read the chat>`,
    ]
      .filter(Boolean)
      .join("\n");
    jobs.push(post(slack, { text }));
  }
  if (s.leadWebhookUrl) jobs.push(post(s.leadWebhookUrl, { event: "lead.created", lead, chat }));
  await Promise.all(jobs);
}

async function post(url: string, body: unknown) {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) console.warn(`[notify] ${new URL(url).host} answered ${res.status}`);
  } catch (err) {
    console.warn("[notify]", err instanceof Error ? err.message : err);
  }
}
