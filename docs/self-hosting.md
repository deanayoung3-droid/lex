# Self-hosting Lex

Lex is one small Node.js server. Your website loads the chat from it, so it needs to be always on and reachable over HTTPS (for example `https://lex.example.com`).

## With Docker (recommended)

**You need:** a server with Docker (the smallest VPS is enough: 1 CPU, 1 GB of memory; install Docker with `curl -fsSL https://get.docker.com | sh`), a domain name like `lex.example.com` with an `A` record pointing at the server, ports 80 and 443 open, and an OpenAI API key.

```bash
git clone https://github.com/DeanYoung1/lex.git
cd lex
```

Write `.env`: with Node installed, `npm run setup -- --docker` asks a few questions and does it. Otherwise `cp .env.example .env` and set:

```bash
ADMIN_PASSWORD=          # long and random: openssl rand -base64 24
SESSION_SECRET=          # openssl rand -hex 32
PUBLIC_URL=https://lex.example.com
DOMAIN=lex.example.com   # for automatic HTTPS
OPENAI_API_KEY=sk-...
```

Start it:

```bash
docker compose --profile https up -d --build
```

Caddy gets a certificate as soon as the domain points at the server. Sign in at `https://lex.example.com/login` with `ADMIN_PASSWORD`, set it up, and copy the install snippet into your website.

Already run nginx, Traefik, or a load balancer? Leave out `--profile https` and send traffic to port 3000 (set `PORT` in `.env` to change it).

## Updating

```bash
git pull
docker compose --profile https up -d --build
```

Database changes run on start and only add, so an older version still runs if you need to go back.

## Backups

Everything is in the `db-data` volume (settings, chats, leads; the website itself can always be read again):

```bash
docker compose exec -T db pg_dump -U lex lex | gzip > lex-$(date +%F).sql.gz
```

## Without Docker

On any machine with Node 24:

```bash
npm ci
npm run build
npm start          # port 3000; set PORT to change it
```

Set the variables from `.env.example`. Without `DATABASE_URL` the built-in database keeps its data in `./data` (back that folder up); with it, any PostgreSQL 15+ with the `pgvector` extension works (Supabase, Neon, RDS, Cloud SQL).

Platforms that build from a Dockerfile (Railway, Render, Fly.io) work too: add a Postgres with pgvector, set `DATABASE_URL` and the variables above, and keep one instance always running. Serverless platforms that stop the server between requests aren't a good fit: reading your website and grouping questions run in the background.

## Troubleshooting

| You see | Do this |
|---|---|
| The chat doesn't appear on your website | Check Lex is turned on, your site is listed under **Install → Websites allowed to show it**, and the script tag's address is this server. Your browser's console shows if `lex.js` failed to load. |
| "Not read yet" stays after a few minutes | The site needs a `sitemap.xml` or links on its home page. `docker compose logs app` shows what happened when it read. |
| Lex says it can't answer just now | The OpenAI key is missing, wrong, or out of credit. The server log says which. |
| The site doesn't load over HTTPS | Check the domain's `A` record points here and ports 80 and 443 are open; `docker compose logs caddy` says why. |
