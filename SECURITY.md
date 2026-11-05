# Security

## Reporting a vulnerability

Please report security problems privately, through GitHub's **Security → Report a vulnerability** on this repository, rather than in a public issue. Include what you found, how to reproduce it, and what it affects.

## Running it safely

- Use a long random `ADMIN_PASSWORD` and `SESSION_SECRET` (`npm run setup` generates both). Sign-in locks an address out for 15 minutes after 10 wrong passwords.
- Serve it over HTTPS. The Docker setup's `--profile https` does this for you.
- List only your own sites under **Websites allowed to show it**.
- Give your OpenAI key a monthly spending limit, and keep `DAILY_QUESTION_LIMIT` at a level you're comfortable paying for.
- Leads include visitors' names and emails. The admin is behind the password; keep backups private.
