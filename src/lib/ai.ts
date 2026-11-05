import "server-only";
import crypto from "node:crypto";
import OpenAI from "openai";
import type { FunctionTool, Response as ModelResponse, ResponseFormatTextJSONSchemaConfig, ResponseInputItem } from "openai/resources/responses/responses";
import { get, run } from "./db";

// Every AI call goes to the OpenAI API with OPENAI_API_KEY, through the Responses API: answers on a
// fast model, the cheap jobs (suggested questions, topic grouping) on a light one, and embeddings
// for searching the website by meaning.

export type Purpose = "answer" | "classify" | "embed";
export type Effort = "low" | "medium" | "high";
export type { FunctionTool, ModelResponse, ResponseInputItem };

export class AIError extends Error {}

export const MODELS = {
  answer: process.env.OPENAI_ANSWER_MODEL || "gpt-6.1-terra",
  classify: process.env.OPENAI_LIGHT_MODEL || "gpt-6-luna",
  embed: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
};

/**
 * USD per million tokens: input, cached input, output, for the cost shown in the admin. From
 * OpenAI's pricing page in November 2026; models not listed count as $0, so update when you
 * change models or prices change.
 */
const PRICES: Record<string, [number, number, number]> = {
  "gpt-6-astra": [10, 1, 50],
  "gpt-6.1-sol": [2, 0.1, 10],
  "gpt-6.1-terra": [1, 0.05, 5],
  "gpt-6-luna": [0.1, 0.01, 0.5],
  "text-embedding-3-small": [0.02, 0, 0],
  "text-embedding-3-large": [0.13, 0, 0],
};

export function costOf(model: string, input: number, cached: number, output: number): number {
  const key = Object.keys(PRICES)
    .filter((k) => model === k || model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return 0;
  const [inp, cache, out] = PRICES[key];
  return ((input - cached) * inp + cached * cache + output * out) / 1_000_000;
}

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

let client: OpenAI | null = null;

function openai(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new AIError("Add an OpenAI API key (OPENAI_API_KEY) on the server.");
  client ??= new OpenAI({ maxRetries: 3, timeout: 5 * 60_000 });
  return client;
}

/** A function the model can call, with every property required (strict mode). */
export function tool(name: string, description: string, properties: Record<string, unknown>): FunctionTool {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
  };
}

export type ModelRequest = {
  instructions: string;
  input: ResponseInputItem[];
  tools?: FunctionTool[];
  format?: ResponseFormatTextJSONSchemaConfig;
  effort?: Effort;
  maxOutputTokens?: number;
};

function body(model: string, req: ModelRequest) {
  return {
    model,
    instructions: req.instructions,
    input: req.input,
    tools: req.tools,
    tool_choice: req.tools ? ("auto" as const) : undefined,
    text: req.format ? { format: req.format } : undefined,
    reasoning: req.effort ? { effort: req.effort } : undefined,
    max_output_tokens: req.maxOutputTokens,
    store: false,
  };
}

async function callModel(purpose: Purpose, req: ModelRequest): Promise<ModelResponse> {
  const model = purpose === "answer" ? MODELS.answer : MODELS.classify;
  let res: ModelResponse;
  try {
    res = await openai().responses.create({ ...body(model, req), stream: false });
  } catch (err) {
    throw toAIError(err);
  }
  await recordUsage(purpose, res);
  if (res.status === "incomplete") throw new AIError("The model stopped before it finished. Try again.");
  return res;
}

/** Streams the model's text as it's written. Resolves with the finished response. */
export async function streamModel(purpose: Purpose, req: ModelRequest, onText: (delta: string) => void, signal?: AbortSignal): Promise<ModelResponse> {
  const model = purpose === "answer" ? MODELS.answer : MODELS.classify;
  try {
    const stream = await openai().responses.create({ ...body(model, req), stream: true }, { signal });
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") onText(event.delta);
      else if (event.type === "response.completed" || event.type === "response.incomplete") {
        await recordUsage(purpose, event.response);
        return event.response;
      } else if (event.type === "response.failed") {
        throw new AIError(event.response.error?.message ?? "OpenAI couldn't finish the answer.");
      } else if (event.type === "error") {
        throw new AIError(`OpenAI reported an error: ${event.message}`);
      }
    }
  } catch (err) {
    throw toAIError(err);
  }
  throw new AIError("The connection to OpenAI dropped before the answer finished. Try again.");
}

/** Embeddings for a batch of texts, in order. */
export async function embed(texts: string[], dimensions: number): Promise<number[][]> {
  if (!texts.length) return [];
  const out: number[][] = [];
  try {
    for (let i = 0; i < texts.length; i += 64) {
      const res = await openai().embeddings.create({ model: MODELS.embed, input: texts.slice(i, i + 64), dimensions });
      out.push(...res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
      await run("INSERT INTO ai_usage (purpose, model, input_tokens, cost_usd) VALUES ('embed', $1, $2, $3)", [
        res.model,
        res.usage.prompt_tokens,
        costOf(res.model, res.usage.prompt_tokens, 0, 0),
      ]).catch(() => {});
    }
  } catch (err) {
    throw toAIError(err);
  }
  return out;
}

function toAIError(err: unknown): unknown {
  if (err instanceof AIError) return err;
  if (err instanceof OpenAI.AuthenticationError) return new AIError("OpenAI rejected the API key. Check OPENAI_API_KEY on the server.");
  if (err instanceof OpenAI.PermissionDeniedError || err instanceof OpenAI.NotFoundError) {
    return new AIError("This OpenAI key can't use the chosen model. Check OPENAI_ANSWER_MODEL and OPENAI_LIGHT_MODEL, or the project's model access.");
  }
  if (err instanceof OpenAI.RateLimitError) {
    return new AIError(/quota|billing/i.test(err.message) ? "The OpenAI account is out of credit. Add billing at platform.openai.com." : "OpenAI's rate limit was reached. Try again in a minute.");
  }
  if (err instanceof OpenAI.APIError && /no credits|credit balance|billing|insufficient_quota|exceeded your current quota/i.test(err.message)) {
    return new AIError("The OpenAI account is out of credit. Add billing at platform.openai.com.");
  }
  if (err instanceof OpenAI.APIError) return new AIError(`OpenAI returned an error (${err.status ?? "network"}). Try again shortly.`);
  return err;
}

/** The text the model wrote, across all of its message items. */
export function outputText(res: ModelResponse): string {
  return res.output.flatMap((item) => (item.type === "message" ? item.content.flatMap((c) => (c.type === "output_text" ? [c.text] : [])) : [])).join("");
}

/** One call constrained to a JSON schema (strict structured output). */
export async function generateJSON<T>(opts: { purpose: Purpose; system: string; prompt: string; schema: Record<string, unknown>; effort: Effort; maxTokens?: number }): Promise<T> {
  const res = await callModel(opts.purpose, {
    instructions: opts.system,
    input: [{ role: "user", content: opts.prompt }],
    format: { type: "json_schema", name: "result", schema: opts.schema, strict: true },
    effort: opts.effort,
    maxOutputTokens: opts.maxTokens,
  });
  try {
    return JSON.parse(outputText(res)) as T;
  } catch {
    throw new AIError("The model returned output that couldn't be read. Try again.");
  }
}

async function recordUsage(purpose: Purpose, res: ModelResponse) {
  const u = res.usage;
  const input = u?.input_tokens ?? 0;
  const cached = u?.input_tokens_details?.cached_tokens ?? 0;
  const output = u?.output_tokens ?? 0;
  await run("INSERT INTO ai_usage (purpose, model, input_tokens, output_tokens, cache_read_tokens, cost_usd) VALUES ($1, $2, $3, $4, $5, $6)", [
    purpose,
    res.model,
    input,
    output,
    cached,
    costOf(res.model, input, cached, output),
  ]).catch((err) => console.error("[ai] usage log", err));
}

/** The most questions a day across all visitors, so a busy or abused site can't run up a bill. */
const DAILY_LIMIT = Number(process.env.DAILY_QUESTION_LIMIT || 500);

/** Per-visitor (10 a minute) and per-day limits on questions. */
export async function askAllowed(visitor: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const r = await get<{ mine: number; today: number }>(
    `SELECT count(*) FILTER (WHERE visitor = $1 AND created_at > now() - interval '1 minute')::int AS mine,
            count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS today
       FROM questions WHERE created_at >= least(date_trunc('day', now()), now() - interval '1 minute')`,
    [visitor],
  );
  if ((r?.mine ?? 0) >= 10) return { ok: false, reason: "That's a lot of questions at once. Wait a moment and try again." };
  if ((r?.today ?? 0) >= DAILY_LIMIT) return { ok: false, reason: "I'm taking a break for today. Please come back tomorrow." };
  return { ok: true };
}

/** An anonymous visitor id for today: a salted hash of IP and browser, never stored raw. */
export function visitorId(headers: Headers): string {
  const ip = headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip") || "local";
  const day = new Date().toISOString().slice(0, 10);
  return crypto
    .createHash("sha256")
    .update(`${ip}|${headers.get("user-agent") ?? ""}|${day}|${process.env.SESSION_SECRET ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

/** What the AI cost in the last 30 days, in dollars. */
export async function aiCost(): Promise<number> {
  const r = await get<{ usd: number }>("SELECT coalesce(sum(cost_usd), 0) AS usd FROM ai_usage WHERE created_at > now() - interval '30 days'");
  return r?.usd ?? 0;
}
