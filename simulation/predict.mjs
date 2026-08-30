// Team 28 — Silicon Sample Benchmark, Tier-3 direct forecast (Anthropic runner)
//
// For each of the 16 text interventions, asks Claude Opus 5 to forecast the
// average treatment effect (ATE, intervention mean − control mean) on the 13
// preregistered outcomes. Runs N samples per intervention (default 5) and
// submits the per-outcome median. Every raw API response is archived under
// simulation/logs/ (registration item K.2).
//
// Prompts and the benchmark spec live in prompts.mjs. The same module drives,
// byte-identically, the OpenAI runner of our team's separate GPT-5 entry
// (deposited in its own repository).
//
// Usage:
//   node predict.mjs [--samples 5] [--effort xhigh] [--only "Consensus"] [--dry]
//                    [--placebo] [--variant]
//
// Auth: ANTHROPIC_API_KEY in the environment, or a simulation/.env file
// containing ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INTERVENTIONS,
  OUTCOMES,
  sections,
  controlTitles,
  SYSTEM,
  SYSTEM_VARIANT,
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
const EFFORT = argVal("--effort", "xhigh");
const ONLY = argVal("--only", null);
const DRY = args.includes("--dry");
// --placebo: diagnostic mode — forecast neutral texts with no climate content.
// A well-calibrated pipeline must return ATEs ≈ 0. Logs to placebo-*.json,
// never touches predictions/.
const PLACEBO = args.includes("--placebo");
// --variant: alternative prompt framing (no evidence digest, no magnitude
// anchors, distributional elicitation). Used first as a sensitivity probe and
// then as the basis of the secondary-2 entry. Logs to variant-*.json, writes
// variant_results.json, and reports rank correlations against the production
// CSV; never touches predictions/ in this repo.
const VARIANT = args.includes("--variant");

// ---------- .env fallback ----------
if (!process.env.ANTHROPIC_API_KEY) {
  const envFile = path.join(here, ".env");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (m) process.env[m[1]] ??= m[2];
    }
  }
}

// ---------- structured output schema ----------
const AteSchema = z.object({
  reasoning_summary: z
    .string()
    .describe("3–6 sentences: the mechanism of this intervention and how you calibrated the magnitudes"),
  ates: z.object(
    Object.fromEntries(OUTCOMES.map(([name]) => [name, z.number()]))
  ),
});

// ---------- run ----------
const logsDir = path.join(here, "logs");
fs.mkdirSync(logsDir, { recursive: true });

const PLACEBOS = {
  "placebo: The History of Paperclips":
    "The paperclip, a simple bent wire, has held loose papers together for over a century. Patents for wire clips appeared in the 1890s, and the familiar double-oval \"Gem\" design—never actually patented—emerged from British manufacture around 1900. Early advertisements praised the clip for holding papers \"without piercing,\" a genuine advance over the straight pins that clerks had used for decades, which rusted, pricked fingers, and left holes in documents.\n\nManufacturing paperclips is a study in efficiency: a single machine draws steel wire from a spool, straightens it, cuts it, and executes three precise bends in well under a second. A modern factory can produce millions per day. Despite dozens of rival designs over the years—clips with pointed ends, triangular profiles, or ridged grips, each claiming superior holding power—the Gem shape still dominates, a case study in how an adequate early standard can lock in for good.\n\nThe paperclip has also acquired odd cultural roles: office workers bend them into tools for resetting electronics or opening CD trays, and in 2005 a Canadian blogger famously traded one red paperclip, through a chain of fourteen barters, up to a house. Sales have declined with the paperless office, yet billions are still sold every year, and the design remains, per many industrial historians, close to perfect for its purpose.",
  "placebo: How Sourdough Fermentation Works":
    "Sourdough bread rises without commercial yeast. Instead, bakers maintain a \"starter\": a culture of wild yeasts and lactic acid bacteria living in a paste of flour and water. Feed it regularly, and the microbes stay active for years—some bakeries claim starters passed down for generations.\n\nThe fermentation is a partnership. Wild yeasts, often Saccharomyces exiguus or strains of S. cerevisiae, consume sugars in the flour and release carbon dioxide, which inflates the dough. Meanwhile, bacteria of the genus Lactobacillus produce lactic and acetic acids, which give sourdough its characteristic tang, strengthen the gluten network, and inhibit mold—one reason sourdough keeps longer than conventional bread.\n\nTiming and temperature steer the flavor. A warm, fast fermentation favors mild lactic acid; a long, cool retard in the refrigerator lets acetic acid accumulate, sharpening the sour note. Bakers manipulate hydration, feeding schedules, and flour types to coax different balances from the same culture.\n\nWhen the shaped loaf finally enters a hot oven, trapped gases expand in a final surge called oven spring, and the crust caramelizes through the Maillard reaction. What emerges is the product of a microbial ecosystem that humans have managed, without fully understanding it, for at least five thousand years—Egyptian bakers were leavening bread with wild cultures millennia before anyone knew microorganisms existed.",
};
// plus one shipped control filler (recognizable from the system prompt) as a grounding check
const PLACEBO_SHIPPED = controlTitles[0];

if (PLACEBO) {
  for (const [t, text] of Object.entries(PLACEBOS)) sections[t] = text;
  sections[`placebo-shipped: ${PLACEBO_SHIPPED}`] = sections[PLACEBO_SHIPPED];
}

const targets = PLACEBO
  ? [...Object.keys(PLACEBOS), `placebo-shipped: ${PLACEBO_SHIPPED}`]
  : ONLY
    ? INTERVENTIONS.filter((t) => t === ONLY)
    : INTERVENTIONS;
if (targets.length === 0) throw new Error(`--only did not match any intervention`);

if (DRY) {
  console.log("=== SYSTEM PROMPT ===\n" + SYSTEM);
  console.log("\n=== USER PROMPT (first target) ===\n" + userPromptFor(targets[0]));
  console.log(`\n[dry run] ${targets.length} interventions x ${SAMPLES} samples, effort=${EFFORT}`);
  process.exit(0);
}

const client = new Anthropic();
const usageTotal = { calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
const t0 = Date.now();

async function oneCall(title, run) {
  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: EFFORT, format: zodOutputFormat(AteSchema) },
    system: [
      {
        type: "text",
        text: VARIANT ? SYSTEM_VARIANT : SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPromptFor(title) }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`Refusal on ${title} run ${run}: ${response.stop_details?.explanation}`);
  }
  usageTotal.calls += 1;
  usageTotal.input += response.usage.input_tokens;
  usageTotal.output += response.usage.output_tokens;
  usageTotal.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
  usageTotal.cacheRead += response.usage.cache_read_input_tokens ?? 0;
  fs.writeFileSync(
    path.join(logsDir, `${VARIANT ? "variant-" : ""}${slug(title)}_run${run}.json`),
    JSON.stringify(
      {
        condition: title,
        run,
        timestamp: new Date().toISOString(),
        request: { model: "claude-opus-5", effort: EFFORT, max_tokens: 16000, variant: VARIANT },
        response, // full raw API message: content, usage, ids
      },
      null,
      2
    )
  );
  if (!response.parsed_output) {
    throw new Error(`Unparseable output on ${title} run ${run}`);
  }
  return response.parsed_output;
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
const outName = `${meta.team_id}_T3_${meta.entry}_v1.csv`;
const outPath = path.join(repoRoot, "predictions", outName);

// rewrite the CSV with everything forecast so far (crash-safe incremental output)
function writeCsv() {
  const lines = ["condition,outcome,ate"];
  for (const title of INTERVENTIONS) {
    if (!(title in results)) continue; // partial run via --only or in progress
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
  const first = await oneCallWithRetry(title, 1); // writes/refreshes the prompt cache
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
  if (!PLACEBO && !VARIANT) writeCsv();
  console.log(
    `  done ${title} — trust_multidimensional ATE (median): ${results[title].trust_multidimensional}`
  );
}

// pool: up to 4 interventions in flight at once
const CONCURRENCY = 4;
const queue = [...targets];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      await forecastIntervention(queue.shift());
    }
  })
);

if (PLACEBO) {
  console.log("\n=== PLACEBO RESULTS (all values should be ≈ 0) ===");
  for (const [title, ates] of Object.entries(results)) {
    console.log(`\n${title}`);
    for (const [name] of OUTCOMES) console.log(`  ${name}: ${ates[name]}`);
  }
  process.exit(0);
}

if (VARIANT) {
  // Spearman rank correlation of the 16 arms vs. the production CSV, per outcome
  const prodCsv = fs.readFileSync(
    path.join(repoRoot, "predictions", `${meta.team_id}_T3_${meta.entry}_v1.csv`),
    "utf8"
  );
  const prod = {}; // condition -> outcome -> ate
  for (const line of prodCsv.trim().split("\n").slice(1)) {
    const m = line.match(/^(?:"([^"]+)"|([^,]+)),([^,]+),(.+)$/);
    const [cond, outcome, ate] = [m[1] ?? m[2], m[3], parseFloat(m[4])];
    (prod[cond] ??= {})[outcome] = ate;
  }
  const ranks = (xs) => {
    const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(xs.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const spearman = (a, b) => {
    const ra = ranks(a), rb = ranks(b);
    const ma = ra.reduce((x, y) => x + y, 0) / ra.length;
    const mb = rb.reduce((x, y) => x + y, 0) / rb.length;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < ra.length; i++) {
      num += (ra[i] - ma) * (rb[i] - mb);
      da += (ra[i] - ma) ** 2;
      db += (rb[i] - mb) ** 2;
    }
    return num / Math.sqrt(da * db);
  };
  console.log("\n=== PROMPT-VARIANT SENSITIVITY (rank correlation across the 16 arms) ===");
  console.log("outcome                   spearman   prod range        variant range");
  for (const [name] of OUTCOMES) {
    const conds = INTERVENTIONS.filter((t) => t in results && prod[t]);
    const a = conds.map((t) => prod[t][name]);
    const b = conds.map((t) => results[t][name]);
    const rho = spearman(a, b);
    const rng = (xs) => `[${Math.min(...xs).toFixed(2)}, ${Math.max(...xs).toFixed(2)}]`;
    console.log(`${name.padEnd(26)}${rho.toFixed(3).padStart(7)}   ${rng(a).padEnd(18)}${rng(b)}`);
  }
  fs.writeFileSync(
    path.join(logsDir, "variant_results.json"),
    JSON.stringify({ finished: new Date().toISOString(), effort: EFFORT, samples: SAMPLES, results }, null, 2)
  );
  process.exit(0);
}

const nRows = writeCsv();

// ---------- run summary (registration item K.3) ----------
const summary = {
  finished: new Date().toISOString(),
  wall_clock_minutes: Math.round((Date.now() - t0) / 6000) / 10,
  interventions: targets.length,
  samples_per_intervention: SAMPLES,
  effort: EFFORT,
  model: "claude-opus-5",
  api_calls: usageTotal.calls,
  input_tokens_uncached: usageTotal.input,
  cache_write_tokens: usageTotal.cacheWrite,
  cache_read_tokens: usageTotal.cacheRead,
  output_tokens: usageTotal.output,
  approx_cost_usd:
    Math.round(
      (usageTotal.input * 5 + usageTotal.cacheWrite * 6.25 + usageTotal.cacheRead * 0.5 +
        usageTotal.output * 25) /
        1e6 *
        100
    ) / 100,
};
fs.writeFileSync(path.join(logsDir, "run_summary.json"), JSON.stringify(summary, null, 2));
console.log(`\nWrote ${outPath} (${nRows} rows)`);
console.log(JSON.stringify(summary, null, 2));
