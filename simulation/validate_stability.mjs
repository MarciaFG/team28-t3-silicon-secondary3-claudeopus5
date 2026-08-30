// Post-run diagnostics (no API calls): ensemble stability + coherence audit.
// Reads simulation/logs/*_run*.json from the production run and reports
// per-cell dispersion across the 5 samples and theory-required patterns.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const logsDir = path.join(here, "logs");

const files = fs.readdirSync(logsDir).filter(
  (f) => /_run\d+\.json$/.test(f) && !f.startsWith("placebo-") && !f.startsWith("variant-")
);
const byCondition = {};
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(logsDir, f), "utf8"));
  const ates = j.response.parsed_output?.ates;
  if (!ates) continue;
  (byCondition[j.condition] ??= []).push(ates);
}

const sd = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

console.log("=== 1. ENSEMBLE STABILITY (dispersion across the 5 runs) ===");
const unstable = [];
const signFlips = [];
const outcomes = Object.keys(Object.values(byCondition)[0][0]);
for (const [cond, runs] of Object.entries(byCondition)) {
  for (const o of outcomes) {
    const vals = runs.map((r) => r[o]);
    const med = median(vals);
    const spread = Math.max(...vals) - Math.min(...vals);
    const s = sd(vals);
    // instability: spread large relative to the median forecast (and non-trivial absolutely)
    if (Math.abs(med) > 0.2 && spread > 2 * Math.abs(med)) {
      unstable.push({ cond, o, med, spread: +spread.toFixed(3), sd: +s.toFixed(3), vals });
    }
    const pos = vals.filter((v) => v > 0).length;
    if (pos !== 0 && pos !== vals.length) {
      signFlips.push({ cond, o, vals });
    }
  }
}
console.log(`cells checked: ${Object.keys(byCondition).length * outcomes.length}`);
console.log(`runs per condition: ${Object.values(byCondition).map((r) => r.length).join(",")}`);

const allSds = [];
for (const runs of Object.values(byCondition))
  for (const o of outcomes) allSds.push(sd(runs.map((r) => r[o])));
console.log(`median per-cell SD across runs: ${median(allSds).toFixed(3)} (scale points)`);

console.log(`\ncells with spread > 2x |median| (potentially noise-driven): ${unstable.length}`);
for (const u of unstable.slice(0, 15))
  console.log(`  ${u.cond} / ${u.o}: median ${u.med}, spread ${u.spread}, runs [${u.vals.join(", ")}]`);

console.log(`\ncells where runs disagree on SIGN: ${signFlips.length}`);
for (const u of signFlips.slice(0, 15))
  console.log(`  ${u.cond} / ${u.o}: runs [${u.vals.join(", ")}]`);

console.log("\n=== 2. COHERENCE AUDIT (theory-required patterns, per arm) ===");
let violations = 0;
for (const [cond, runs] of Object.entries(byCondition)) {
  const med = Object.fromEntries(outcomes.map((o) => [o, median(runs.map((r) => r[o]))]));
  const checks = [
    ["distrust opposite sign to trust", med.trust_multidimensional > 0.3 ? med.distrust_post < 0 : true],
    ["primary trust >= belief effect", med.trust_multidimensional >= med.belief_post - 0.001],
    ["attitudes >= behavior intentions", med.concern_mean >= med.behavior_mean - 0.2],
    ["donation |ate| <= 0.5 dollars", Math.abs(med.donation_ams) <= 0.5],
    ["newsletter |ate| <= 0.05", Math.abs(med.newsletter_signup) <= 0.05],
  ];
  for (const [label, ok] of checks) {
    if (!ok) {
      console.log(`  VIOLATION ${cond}: ${label}`);
      violations++;
    }
  }
}
console.log(violations === 0 ? "all arms pass all coherence checks" : `${violations} violation(s) above`);
