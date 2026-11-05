#!/usr/bin/env node
// Writes Lex's settings file with fresh secrets, so a new install is one command away.
//
//   npm run setup              # for `npm run dev` on this computer: writes .env.local
//   npm run setup -- --docker  # for `docker compose up`: writes .env
//   npm run setup -- --yes     # no questions: generated secrets and defaults
//
// It never overwrites a value you already set; run it again any time to fill in what's missing.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const docker = args.has("--docker");
const quiet = args.has("--yes") || !process.stdin.isTTY;
const file = path.join(root, docker ? ".env" : ".env.local");

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function ask(question, { hidden = false, fallback = "" } = {}) {
  if (quiet) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Hide what's typed (for the API key): echo nothing after the question.
      rl._writeToOutput = (s) => {
        if (s.startsWith(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim() || fallback);
    });
  });
}

/** The current file's values, or the example's text to fill in. */
const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : fs.readFileSync(path.join(root, ".env.example"), "utf8");
const current = (key) => text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim() ?? "";
const values = {};
const set = (key, value) => (values[key] = value);

console.log(`\n${bold("Lex setup")} ${dim(`→ ${path.basename(file)}`)}\n`);

let newPassword = "";
if (!current("ADMIN_PASSWORD")) {
  newPassword = crypto.randomBytes(18).toString("base64url");
  set("ADMIN_PASSWORD", newPassword);
}
if (!current("SESSION_SECRET")) set("SESSION_SECRET", crypto.randomBytes(32).toString("hex"));

let domain = "";
if (docker) {
  domain = await ask(`Domain for HTTPS on this server, like docs.example.com ${dim("(Enter to skip: http://localhost:3000)")}: `);
  if (domain) {
    domain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    set("DOMAIN", domain);
    set("PUBLIC_URL", `https://${domain}`);
  }
}
if (!values.PUBLIC_URL && (!current("PUBLIC_URL") || current("PUBLIC_URL") === "http://localhost:3000")) {
  const url = await ask(`Address people will use ${dim("(Enter for http://localhost:3000)")}: `, { fallback: "http://localhost:3000" });
  set("PUBLIC_URL", url.replace(/\/$/, ""));
}

if (!current("OPENAI_API_KEY")) {
  const key = await ask(`OpenAI API key, which Lex answers with ${dim("(hidden; Enter to add it later)")}: `, { hidden: true });
  if (key) set("OPENAI_API_KEY", key);
}

let out = text;
for (const [key, value] of Object.entries(values)) {
  out = new RegExp(`^#?\\s*${key}=.*$`, "m").test(out) ? out.replace(new RegExp(`^#?\\s*${key}=.*$`, "m"), `${key}=${value}`) : `${out.trimEnd()}\n${key}=${value}\n`;
}
fs.writeFileSync(file, out, { mode: 0o600 });

console.log(`\n${bold("Saved")} ${path.relative(process.cwd(), file) || file}${Object.keys(values).length ? `: ${Object.keys(values).join(", ")}` : " (nothing was missing)"}`);
if (newPassword) {
  console.log(`\n${bold("Your admin password:")} ${newPassword}`);
  console.log(dim("Sign in to the admin with it. It's also in the file above."));
}

const url = values.PUBLIC_URL || current("PUBLIC_URL") || "http://localhost:3000";
console.log(`\n${bold("Next")}`);
if (docker) {
  console.log(`  docker compose ${domain ? "--profile https " : ""}up -d --build`);
} else {
  console.log("  npm run dev");
}
console.log(`  open ${url}/login and sign in with the admin password\n`);
