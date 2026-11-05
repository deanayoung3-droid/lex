import Link from "next/link";

// Pieces shared by the reports (trends, the chat list, one chat).

/** A website address as its path, the part that tells pages apart. */
export function pathOf(url: string) {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? u.host.replace(/^www\./, "") : u.pathname.replace(/\/$/, "");
  } catch {
    return url || "unknown page";
  }
}

/** A share of a whole, as a whole percentage; a dash when there's nothing to share. */
export function pct(part: number, whole: number) {
  return whole ? `${Math.round((part / whole) * 100)}%` : "—";
}

/** The agent's replies are lightly formatted (bold, links); reporting shows them as plain text. */
export function plain(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1")
    .trim();
}

export const RANGES = [7, 30, 90];

/** The period switch in a report's header. */
export function RangeNav({ href, days }: { href: (days: number) => string; days: number }) {
  return (
    <nav aria-label="Range" className="inline-flex rounded-lg border border-line bg-sunken p-0.5">
      {RANGES.map((d) => (
        <Link
          key={d}
          href={href(d)}
          aria-current={d === days ? "page" : undefined}
          className={`h-7 rounded-md px-3 text-[12px] leading-7 font-medium transition-all ${
            d === days ? "bg-surface text-ink shadow-[0_1px_2px_rgb(10_13_18/0.08)]" : "text-muted hover:text-ink"
          }`}
        >
          Past {d} days
        </Link>
      ))}
    </nav>
  );
}
