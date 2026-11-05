/** Timestamps from the database are ISO strings; older SQL-style ones without a zone are UTC. */
export function parseSqlDate(s: string): Date {
  return /(Z|[+-]\d\d:?\d\d)$/i.test(s) ? new Date(s) : new Date(s.replace(" ", "T") + "Z");
}

export function timeAgo(s: string, now = Date.now()): string {
  const secs = Math.max(0, Math.round((now - parseSqlDate(s).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return parseSqlDate(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function usd(n: number): string {
  if (n > 0 && n < 0.01) return "<$0.01";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
