# Contributing to Lex

Thanks for helping. Bug reports, fixes, and docs improvements are all welcome.

## Get it running

```bash
npm install
npm run setup     # writes .env.local with fresh secrets
npm run dev       # http://localhost:3000
```

The built-in database lives in `./data`; delete that folder for a clean start. To see the chat working, serve any page on `localhost` with the install snippet in it (pages on `localhost` are always allowed), for example `npx serve` in a folder with an `index.html`.

## Before you open a pull request

```bash
npm run lint
npm run typecheck
npm run build
```

GitHub Actions runs the same checks, then builds the Docker image and boots it against Postgres.

## How the code is laid out

| Where | What |
|---|---|
| `src/app/lex.js/route.ts` | The embed script: docks the chat on the website and carries out its actions |
| `src/app/chat` | The chat itself, shown in the embed's iframe |
| `src/app/api` | The chat's endpoints: answers (streamed), suggested questions, clicks |
| `src/app/admin` | Setup, Trends, and Chats |
| `src/lib/lex.ts` | Reading the website, answering, leads, suggested questions, topic grouping |
| `src/lib/report.ts` | The queries behind Trends and Chats |
| `src/lib/scheduler.ts` | Background work: the daily read and hourly grouping |
| `src/lib/schema.ts` | Database migrations |

## Conventions

- **Migrations only go forward.** Add a new numbered entry at the end of `src/lib/schema.ts`; never edit one that has shipped.
- **The embed stays small and dependency-free.** `lex.js` runs on other people's websites: plain ES5-style JavaScript, no globals besides `window.Lex`, nothing that could clash with the host page.
- **Lex never makes things up.** Changes to its instructions should keep it answering only from the website, the other sites, and the notes.
- This is Next.js 16: some APIs differ from older versions. `AGENTS.md` points AI coding tools at the right docs.

## Reporting security issues

Please don't open a public issue. See [SECURITY.md](SECURITY.md).
