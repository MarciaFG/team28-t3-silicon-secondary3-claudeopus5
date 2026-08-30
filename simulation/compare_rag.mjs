// One-off comparison of the colleague's RAG Tier-3 CSV against our entries.
import fs from "node:fs";
import { INTERVENTIONS, OUTCOMES } from "./prompts.mjs";

const load = (p) => {
  const d = {};
  for (const raw of fs.readFileSync(p, "utf8").split(/\r*\n/)) {
    const line = raw.replace(/\r+$/, "");
    if (!line.trim() || line.startsWith("condition")) continue;
    const m = line.match(/^(?:"([^"]+)"|([^,]+)),([^,]+),(.+)$/);
    if (m) (d[m[1] ?? m[2]] ??= {})[m[3]] = parseFloat(m[4]);
  }
  return d;
};

const rag = load(process.argv[2]);
const ours = load("../predictions/team_28_T3_secondary-3_v1.csv");
const gpt = load("C:/Users/ferreiram/silicon-sample-submission-secondary1/predictions/team_28_T3_secondary-1_v1.csv");

const missing = INTERVENTIONS.filter((t) => !rag[t]);
console.log("condition label mismatches vs spec:", missing.length ? missing.join("; ") : "none");
const badOut = OUTCOMES.map(([n]) => n).filter((n) => rag[INTERVENTIONS[0]]?.[n] === undefined);
console.log("outcome label mismatches:", badOut.length ? badOut.join("; ") : "none");

const ranks = (xs) => {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = [];
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
};
const spear = (a, b) => {
  const ra = ranks(a), rb = ranks(b);
  const ma = ra.reduce((x, y) => x + y) / ra.length;
  const mb = rb.reduce((x, y) => x + y) / rb.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) {
    n += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return n / Math.sqrt(da * db);
};

console.log("\noutcome                    RAGvOurs RAGvGPT5   rag range          ours range");
for (const [n] of OUTCOMES) {
  const a = INTERVENTIONS.map((t) => rag[t][n]);
  const b = INTERVENTIONS.map((t) => ours[t][n]);
  const c = INTERVENTIONS.map((t) => gpt[t][n]);
  const rng = (xs) => `[${Math.min(...xs).toFixed(2)},${Math.max(...xs).toFixed(2)}]`;
  console.log(n.padEnd(26) + spear(a, b).toFixed(2).padStart(7) + spear(a, c).toFixed(2).padStart(9) + "   " + rng(a).padEnd(19) + rng(b));
}
