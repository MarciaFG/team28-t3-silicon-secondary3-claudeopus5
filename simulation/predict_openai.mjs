// Team 28 — Silicon Sample Benchmark, Tier-3 direct forecast (OpenAI runner)
//
// The secondary-1 entry: identical pipeline and byte-identical prompts to the
// primary (see prompts.mjs), with exactly ONE factor varied — the model
// (an OpenAI frontier reasoning model instead of Claude Opus 5).
//
// Writes simulation/out_openai/<team_id>_T3_secondary-1_v1.csv (NOT this
// repo's predictions/ — each entry ships in its own repository). Raw API
// responses are archived under simulation/logs/openai-*.json.
//
// Usage:
//   node predict_openai.mjs [--samples 5] [--effort high] [--model gpt-5.2]
//                           [--only "Consensus"] [--dry] [--list-models]
//
// Auth: OPENAI_API_KEY in the environment or in simulation/.env

import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INTERVENTIONS,
  OUTCOMES,
  SYSTEM,
  userPromptFor,
  slug,
  median,
} from "./prompts.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// ---------- CLI ----------
const args = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const SAMPLES = parseInt(argVal("--samples", "5"), 10);
const EFFORT = argVal("--effort", "high"); // OpenAI reasoning effort: low|medium|high
const ONLY = argVal("--only", null);
const MODEL_ARG = argVal("--model", "auto");
const DRY = args.includes("--dry");
const LIST = args.includes("--list-models");

// ---------- .env fallback ----------
if (!process.env.OPENAI_API_KEY) {
  const envFile = path.join(here, ".env");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (m) process.env[m[1]] ??= m[2];
    }
  }
}

const client = new OpenAI();

// ---------- model selection ----------
// Prefer the newest flagship reasoning model the key can access.
const PREFERENCE = [
  /^gpt-5\.\d+$/,          // gpt-5.2, gpt-5.1 (bare = flagship, highest minor first)
  /^gpt-5$/,               // gpt-5
  /^gpt-5\.\d+-pro$/,      // pro variants (if bare unavailable)
  /^o4$/, /^o3-pro$/, /^o3$/,
];
async function pickModel() {
  const ids = [];
  for await (const m of client.models.list()) ids.push(m.id);
  if (LIST) {
    console.log(ids.sort().join("\n"));
    process.exit(0);
  }
  if (MODEL_ARG !== "auto") {
    if (!ids.includes(MODEL_ARG)) throw new Error(`Model ${MODEL_ARG} not available to this key`);
    return MODEL_ARG;
  }
  for (const re of PREFERENCE) {
    const hits = ids.filter((id) => re.test(id)).sort().reverse(); // highest version first
    if (hits.length > 0) return hits[0];
  }
  throw new Error(`No preferred reasoning model found. Available: ${ids.sort().join(", ")}`);
}

// ---------- structured output schema (mirrors AteSchema in predict.mjs) ----------
const jsonSchema = {
  type: "object",
  properties: {
    reasoning_summary: {
      type: "string",
      description:
        "3–6 sentences: the mechanism of this intervention and how you calibrated the magnitudes",
    },
    ates: {
      type: "object",
      properties: Object.fromEntries(OUTCOMES.map(([name]) => [name, { type: "number" }])),
      required: OUTCOMES.map(([name]) => name),
      additionalProperties: false,
    },
  },
  required: ["reasoning_summary", "ates"],
  additionalProperties: false,
};

// ---------- run ----------
const logsDir = path.join(here, "logs");
const outDir = path.join(here, "out_openai");
fs.mkdirSync(logsDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

// --only accepts one title or several separated by ";"
const targets = ONLY
  ? INTERVENTIONS.filter((t) => ONLY.split(";").map((s) => s.trim()).includes(t))
  : INTERVENTIONS;
if (targets.length === 0) throw new Error(`--only did not match any intervention`);

if (DRY) {
  console.log("=== SYSTEM PROMPT (shared with primary — see prompts.mjs) ===\n" + SYSTEM.slice(0, 400) + " …");
  console.log(`\n[dry run] ${targets.length} interventions x ${SAMPLES} samples, effort=${EFFORT}`);
  process.exit(0);
}

const MODEL = await pickModel();
console.log(`Using model: ${MODEL} (reasoning effort: ${EFFORT})`);

const usageTotal = { calls: 0, input: 0, output: 0, reasoning: 0 };
const t0 = Date.now();

async function oneCall(title, run) {
  const response = await client.responses.create({
    model: MODEL,
    reasoning: { effort: EFFORT },
    max_output_tokens: 16000,
    input: [
      { role: "developer", content: SYSTEM },
      { role: "user", content: userPromptFor(title) },
    ],
    text: {
      format: { type: "json_schema", name: "ate_forecast", schema: jsonSchema, strict: true },
    },
  });
  usageTotal.calls += 1;
  usageTotal.input += response.usage?.input_tokens ?? 0;
  usageTotal.output += response.usage?.output_tokens ?? 0;
  usageTotal.reasoning += response.usage?.output_tokens_details?.reasoning_tokens ?? 0;
  fs.writeFileSync(
    path.join(logsDir, `openai-${slug(title)}_run${run}.json`),
    JSON.stringify(
      {
        condition: title,
        run,
        timestamp: new Date().toISOString(),
        request: { model: MODEL, reasoning_effort: EFFORT, max_output_tokens: 16000 },
        response, // full raw API response
      },
      null,
      2
    )
  );
  if (response.status === "incomplete") {
    throw new Error(`Incomplete response on ${title} run ${run}: ${response.incomplete_details?.reason}`);
  }
  const text = response.output_text;
  if (!text) throw new Error(`Empty output on ${title} run ${run}`);
  const parsed = JSON.parse(text);
  if (!parsed?.ates) throw new Error(`Unparseable output on ${title} run ${run}`);
  return parsed;
}

async function oneCallWithRetry(title, run, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await oneCall(title, run);
    } catch (err) {
      if (attempt >= tries) throw err;
      const wait = 15000 * attempt;
      console.warn(`  retry ${attempt} for ${title} run ${run} after error: ${err.message}`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

const results = {}; // title -> { outcome -> ate }
const meta = JSON.parse(fs.readFileSync(path.join(repoRoot, "metadata.json"), "utf8"));
const outPath = path.join(outDir, `${meta.team_id}_T3_secondary-1_v1.csv`);

function writeCsv() {
  const lines = ["condition,outcome,ate"];
  for (const title of INTERVENTIONS) {
    if (!(title in results)) continue;
    for (const [name] of OUTCOMES) {
      const cond = title.includes(",") ? `"${title}"` : title;
      lines.push(`${cond},${name},${results[title][name]}`);
    }
  }
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  return lines.length - 1;
}

async function forecastIntervention(title) {
  console.log(`[${new Date().toISOString()}] ${title} — sample 1/${SAMPLES}`);
  const first = await oneCallWithRetry(title, 1);
  const rest =
    SAMPLES > 1
      ? await Promise.all(
          Array.from({ length: SAMPLES - 1 }, (_, i) => oneCallWithRetry(title, i + 2))
        )
      : [];
  const samples = [first, ...rest];
  results[title] = Object.fromEntries(
    OUTCOMES.map(([name]) => [
      name,
      Math.round(median(samples.map((s) => s.ates[name])) * 1000) / 1000,
    ])
  );
  writeCsv();
  console.log(
    `  done ${title} — trust_multidimensional ATE (median): ${results[title].trust_multidimensional}`
  );
}

const CONCURRENCY = 4;
const queue = [...targets];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      await forecastIntervention(queue.shift());
    }
  })
);

const nRows = writeCsv();

const summary = {
  finished: new Date().toISOString(),
  wall_clock_minutes: Math.round((Date.now() - t0) / 6000) / 10,
  interventions: targets.length,
  samples_per_intervention: SAMPLES,
  reasoning_effort: EFFORT,
  model: MODEL,
  api_calls: usageTotal.calls,
  input_tokens: usageTotal.input,
  output_tokens: usageTotal.output,
  reasoning_tokens: usageTotal.reasoning,
};
fs.writeFileSync(path.join(logsDir, "openai_run_summary.json"), JSON.stringify(summary, null, 2));
console.log(`\nWrote ${outPath} (${nRows} rows)`);
console.log(JSON.stringify(summary, null, 2));
