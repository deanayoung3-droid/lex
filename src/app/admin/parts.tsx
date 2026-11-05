import type { ReactNode } from "react";

// Pieces shared by the admin's pages.

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="rise mb-8 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="kicker mb-2 text-accent-strong">{eyebrow}</p>}
        <h1 className="title">{title}</h1>
        {description && <p className="mt-1.5 text-base text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
