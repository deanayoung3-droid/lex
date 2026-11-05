"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useState, type ReactNode } from "react";
import { groupNowAction, type PanelState } from "./actions";

/** A form that saves through a server action and says how it went. */
export function Panel({
  action,
  submitLabel,
  pendingLabel = "Saving…",
  children,
  inline = false,
}: {
  action: (prev: PanelState, form: FormData) => Promise<PanelState>;
  submitLabel: string;
  pendingLabel?: string;
  children?: ReactNode;
  inline?: boolean;
}) {
  const [state, dispatch, pending] = useActionState(action, undefined);
  return (
    <form action={dispatch} className={inline ? "flex flex-wrap items-center gap-3" : "flex flex-col gap-5"}>
      {children}
      {state?.error && (
        <p role="alert" className="notice notice-error">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="notice">
          {state.ok}
        </p>
      )}
      <div>
        <button type="submit" disabled={pending} className="btn btn-primary btn-sm">
          {pending ? pendingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** Groups new questions into topics now, instead of waiting for the hourly run. */
export function GroupNow() {
  return <Panel action={groupNowAction} submitLabel="Group them now" pendingLabel="Grouping…" inline />;
}

/** A read-only value with a copy button, for the install snippet. */
export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="field min-w-0 flex-1 truncate font-mono text-[12.5px] leading-[30px]">{value}</code>
      <button
        type="button"
        className="btn btn-sm shrink-0"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const NAV = [
  { href: "/admin", label: "Setup", exact: true },
  { href: "/admin/trends", label: "Trends" },
  { href: "/admin/chats", label: "Chats" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Admin" className="flex gap-1 md:flex-col">
      {NAV.map((n) => {
        const active = n.exact ? path === n.href : path === n.href || path.startsWith(`${n.href}/`);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-[13.5px] font-medium transition-colors ${active ? "bg-surface text-ink shadow-[0_1px_2px_rgb(10_13_18/0.08)]" : "text-muted hover:text-ink"}`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
