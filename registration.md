# Silicon Sample Benchmark — method registration form

Fill in every item before the prediction lock; this file ships inside your repo's Zenodo release
(see the README's *Deposit* step). This form covers **one entry** (one repo / one Zenodo release,
`primary` or `secondary-k` — see the README's *What counts as a submission*); if you submit several
entries, fill one form per entry. Items marked **★**
must be disclosed **fully publicly** (never escrowed or withheld). Items marked **†** must be at
minimum escrowed — they may be sealed from the public, but never withheld from the core team. Items
not applicable to your approach: write `N/A`. When several models serve different pipeline stages, complete the model
sections (B) once per model. See the call's *Disclosure policy* for escrow rules.

---

## 0 · Approach identity and output
- **0.1 Team ★** — name, the one or two members (teams are at most two, unless a larger team was approved on request), affiliations, corresponding contact:
  Team `team_28`: Farah Adeeba (University of Konstanz), Jing Ma (University of Konstanz),
  Marcia Ferreira (Graphwise), Max Pellert (Barcelona Supercomputing Center).
  Corresponding contact: Marcia Ferreira, <marciaferreiragoncalves8@gmail.com>.
- **0.2 Plain-language summary ★** — one paragraph, what the approach does (not how):
  A single frontier large language model is used as an expert forecaster. For each of the 16
  intervention texts, the model reads the full stimulus exactly as respondents see it, together
  with a description of the study design, the control condition, and the 13 outcome measures, and
  directly outputs a calibrated point forecast of the average treatment effect (ATE vs. control)
  for every outcome. Each intervention is forecast several times independently and the median
  forecast is submitted. No synthetic respondents are simulated; the model predicts the
  aggregate effects directly.
- **0.3 Submission tier & approach family ★** — tier (1/2/3); family (e.g. per-respondent simulation / agent / direct forecast; single model / ensemble / multi-agent; zero-shot / literature-conditioned):
  Tier 3; direct forecast / single model / zero-shot, literature-conditioned (calibration
  guidance about typical effect sizes in comparable experiments is embedded in the prompt);
  ensemble across 5 stochastic runs of the same model, aggregated by median.
- **0.4 Pipeline diagram** — ordered steps from raw inputs to submitted file:
  1. Parse the 16 intervention stimulus texts and 3 control filler texts from
     `survey/questionnaire.txt` (`simulation/predict.mjs`).
  2. For each intervention: 5 independent API calls to `claude-opus-5` (structured JSON output;
     identical prompts; sampling variation only), each returning ATEs for all 13 outcomes.
  3. Archive every raw API response under `simulation/logs/`.
  4. Aggregate: per intervention × outcome, take the median of the 5 forecasts (deterministic
     JavaScript, no LLM).
  5. Write `predictions/team_28_T3_secondary-3_v1.csv`; fingerprint with `make manifest`;
     validate with `make check`.
- **0.5 Coverage ★** — number of respondents/cells/estimates; mapping to conditions. Full coverage is required: every submission predicts **all 16 interventions and all 13 outcomes** (partial coverage is not accepted). Confirm here:
  Confirmed: 208 ATE estimates = 16 interventions × 13 outcomes, full coverage, no `NA` cells.

## A · Scope of LLM use
- **A.1 Purpose** — every workflow stage where LLMs are used:
  A single LLM produces the ATE forecasts (step 2 above). Parsing, aggregation, and file
  generation are deterministic code. The pipeline code and prompts were drafted with the
  assistance of an LLM coding agent (Claude Code), reviewed by the team.
- **A.2 Degree of automation ★** — confirm fully automated, no human in the loop at prediction time; note any exception:
  Fully automated at prediction time: prompts are fixed before generation, the model's numeric
  outputs are aggregated by code and submitted without human editing.

## B · Model / system details (once per model)
- **B.1 Model name(s)** — exact identifiers incl. provider, size, version/timestamp, source link:
  `claude-opus-5` (Anthropic, first-party API; no dated snapshot suffix — this is the complete
  model identifier). https://www.anthropic.com / https://docs.claude.com
- **B.2 Access & context mode** — API/web/local; API name + version; chat vs stateless; exact call dates:
  Anthropic Messages API via the official TypeScript SDK `@anthropic-ai/sdk` v0.122.0;
  stateless single-turn calls (no conversation state across calls). Call dates: 2026-08-30
  (one 2-call smoke test at 17:32 UTC, production run 17:36–17:39 UTC).
- **B.3 Configuration** — temperature, top-p/top-k, max tokens, penalties, stop sequences, seeds, reasoning effort, completions per item:
  Sampling parameters (temperature/top-p/top-k) are not supported on this model and were not
  set; adaptive thinking enabled (`thinking: {type: "adaptive", display: "summarized"}`);
  reasoning effort `output_config.effort = "xhigh"`; `max_tokens = 16000`; structured JSON
  output enforced via `output_config.format` (JSON schema from `zod`); no stop sequences; no
  seed control available (API calls are non-deterministic); 5 completions per intervention
  (each covering all 13 outcomes).
- **B.4 Customization** — fine-tuning, RAG, prompt optimization, tool use, web search, agentic scaffolds (cross-ref H):
  None. No fine-tuning, no retrieval, no tools, no web search, no agentic scaffold — one
  prompt, one structured response per call.
- **B.5 Persistent memory** — across interactions? what persisted:
  None; every call is independent and stateless.
- **B.6 Inference stack** — for local models: serving framework + version, quantization, hardware:
  N/A (hosted API).
- **B.7 Ensembles** — members + exact aggregation rule:
  5 runs of the identical prompt on the same model; per intervention × outcome the submitted
  ATE is the median of the 5 values, rounded to 3 decimals.

## C · Prompts
- **C.1 Exact prompts** — verbatim text or link to deposited file; were they iteratively refined? pre-specified vs in response to outputs:
  Verbatim in the deposited code: `simulation/predict.mjs` (constant `SYSTEM` and function
  `userPromptFor`; the stimulus texts are inserted verbatim from `survey/questionnaire.txt`).
  Prompts were authored before generating predictions and not tuned in response to model
  outputs. Disclosure: before the production run, a 2-call smoke test on the "Consensus" arm
  verified the pipeline end to end; its output prompted no prompt or design change (only
  execution engineering: request concurrency and crash-safe incremental CSV writing). The two
  smoke-test raw responses were overwritten on disk by the production run's five samples for
  that arm (same filenames); the submitted values come exclusively from the production run.
- **C.2 System-wide instructions**:
  The `SYSTEM` constant in `simulation/predict.mjs`: study design, the three control filler
  texts, the 13 outcome definitions with units, literature-based calibration guidance on
  plausible effect magnitudes and signs, a curated evidence digest of published (pre-2026)
  findings used as priors (consensus-messaging meta-analyses, the Vlasceanu et al. 2024
  climate megastudy, messenger-congruence and inoculation literatures, Pew trust baselines,
  effect-size conversion rules), and the instruction to forecast decisively. The digest was
  hand-curated offline; no web search or retrieval runs at prediction time, deliberately, to
  rule out any contact with this study's (non-public) outcome data.
- **C.3 Prompt-design rationale** — brief rationale for the prompt design: why prompts were structured as they were, and the reasoning behind major design choices (recommended, not required):
  (a) Expert-forecaster framing, because direct elicitation of effect sizes from a strong
  reasoning model avoids the persona-caricature biases of small-scale simulated respondents;
  (b) explicit calibration guidance (small effects on 0–100 scales, tiny effects on
  incentivized behaviors, ceiling/anchoring considerations), because LLMs otherwise
  systematically overestimate persuasion effects; (c) full verbatim stimuli including page
  breaks and interactive elements, so the model can judge mechanism strength; (d) per-outcome
  unit reminders and sign conventions (e.g. `distrust_post` reverse-signed) to prevent unit
  errors; (e) median-of-5 aggregation to reduce run-to-run sampling noise.

## D · Persona / profile construction (Tiers 1–2)
- **D.1 Profile source** — N/A (Tier 3, no personas or profiles are constructed).
- **D.2 Profile verbalization** — N/A.
- **D.3 Assignment & weighting** — N/A.

## E · Stimulus and survey administration
- **E.1 Stimulus presentation** — verbatim vs paraphrase; how state-contingent content is handled:
  Verbatim, including page-break markers and the embedded interactive elements (slider
  estimates with corrective feedback). For the state-adaptive "Extreme weather predictions"
  arm, the model receives the complete case-assignment logic and all four case texts with the
  note that each respondent sees exactly one case; it forecasts the arm-level ATE.
- **E.2 Survey walk-through** — one item/call vs blocks vs whole survey; context carry-over; item/option ordering & randomization; scale display; attention/comprehension handling:
  N/A in the Tier-1 sense: no survey session is simulated. Each call covers one intervention
  and elicits all 13 outcome ATEs at once; the prompt describes the measurement context
  (primary outcome first, other blocks randomized, immediate post-treatment measurement).
- **E.3 Response elicitation** — free text / constrained choice / structured output / token log-probabilities (if logprobs: normalization & mapping):
  Structured output: a JSON schema with one numeric ATE per outcome plus a short reasoning
  summary; schema conformance enforced by the API.

## F · Stochasticity and aggregation
- **F.1 Runs & seeds** — runs per respondent/item/estimate; seeds; reproducibility under identical settings:
  5 runs per intervention. No seed control is available for this API; identical settings can
  produce different outputs. All raw responses are archived so the submitted numbers are
  exactly reproducible from the logs (median aggregation is deterministic).
- **F.2 Aggregation rule** — how multiple generations become submitted values (mean/median/mode/first/sampled/…):
  Median across the 5 runs, per intervention × outcome, rounded to 3 decimals.

## G · Validation & post-processing
- **G.1 Human validation** — any human review of outputs (often N/A):
  Sanity inspection of the aggregated CSV (ranges, signs, completeness) before depositing; no
  value was hand-edited. Post-run diagnostics (after the production run, changing nothing):
  (a) ensemble stability — median per-cell SD across the 5 runs was 0.076 scale points, with
  sign disagreement only in 3 near-zero cells (`simulation/validate_stability.mjs`);
  (b) coherence audit — all arms satisfy theory-required patterns (distrust opposite in sign
  to trust, proximal ≥ distal, incentivized behaviors near zero);
  (c) placebo test — the pipeline run on three neutral texts (two novel: paperclips,
  sourdough; one shipped control filler) forecast |ATE| ≤ 0.18 on trust vs. 1.15–2.75 for
  real interventions (`--placebo` mode in `simulation/predict.mjs`; raw responses in
  `simulation/logs/placebo-*.json`);
  (d) prompt-variant sensitivity probe — all 16 arms were re-forecast (3 samples each) under a
  deliberately different framing: no evidence digest, no expected-magnitude anchors, and a
  distribution-first elicitation (`--variant` mode). The probe's 3-sample responses were later
  overwritten on disk by the 5-sample production run of our companion anchor-free entry (same
  filenames); the `simulation/logs/variant-*.json` files shipped here are that 5-sample run,
  whose values agree with the probe (summary in `simulation/logs/variant_results.json`).
  Forecast levels were similar under both framings (the model's unanchored magnitudes were
  only slightly higher), and Spearman rank correlations of the 16 arms were 0.83–0.95 for the
  distal outcomes (belief, concern, policy, behavior), 0.63–0.78 for the trust-battery
  outcomes and funding perceptions, and ~0.51 for the two single-item trust measures — the
  lower trust-outcome correlations reflect near-ties among the top arms rather than
  reordering of clearly-separated arms (the lowest-effect arms were identical under both
  framings). We report this as a known limitation: the fine ordering among the strongest arms
  is prompt-sensitive.
  No prediction was altered in response to any diagnostic.
  Convergent evidence from our team's companion entries (each a one-factor variation of this
  one, deposited separately): an independently trained model (`gpt-5`, byte-identical
  prompts) produced closely matching magnitudes and arm rankings (Spearman 0.71 on the
  primary trust outcome, 0.74–0.91 on distal outcomes), and an anchor-free prompt framing on
  the same model likewise agreed (0.71 trust, 0.85–0.97 distal).
- **G.2 Post-processing** — parsing rules; handling of refusals/malformed/missing/out-of-range; exclusions; for approaches that generate individual responses, the resulting effective N per condition (descriptive disclosure, not a scoring input):
  Parsing is handled by the API's structured-output validation; a malformed or refused
  response triggers an automatic retry (up to 3 attempts) and is not otherwise used. No
  exclusions, no out-of-range corrections. Effective N: N/A (no individual responses).
- **G.3 Calibration corrections** — any post-hoc scaling/shifting/debiasing and exactly what data it was fit on (cross-ref H/I):
  None. All calibration is a-priori prompt guidance; no post-hoc scaling or shifting of the
  model's outputs, and nothing was fit to any data.

## H · Learning and conditioning components
- **H.1 Fine-tuning data** — exact corpus (hashes/DOIs), hyperparameters, checkpoints:
  N/A (no fine-tuning).
- **H.2 Context & retrieval corpora** — exact document set in context / indexed, archived in the deposit:
  The only documents placed in context are shipped in this repo: the stimulus and control
  texts from `survey/questionnaire.txt` and the outcome definitions derived from
  `codebook.csv` (both embedded in `simulation/predict.mjs`). No external retrieval corpus.

## I · Data inputs, blinding, and competing interests
- **I.1 Competing interests ★** — funding, in-kind compute/model access, relationships with LLM-interested entities:
  No team member has any competing interest to disclose. API costs for this entry were paid
  personally by Marcia Ferreira; no financial or in-kind support from LLM-interested entities
  was received for this work (Max Pellert's in-kind MareNostrum 5 compute allocation,
  disclosed in our Tier-1 entry, was not used here). Team members are employed by Graphwise,
  the University of Konstanz, and the Barcelona Supercomputing Center; none of these entities
  directed or funded this submission.
- **I.2 External human data †** — all external human datasets that informed the approach anywhere (training/fine-tuning/retrieval/ICL/calibration):
  No external human dataset was directly used in the pipeline (no fine-tuning, no retrieval,
  no raw data in context). The system prompt embeds a hand-curated digest of published,
  publicly available findings (Pew Research Center trust levels; Rode et al. 2021; Vlasceanu
  et al. 2024; Milkman et al. megastudies; Banas & Rains 2010; Benegal & Scruggs 2018),
  i.e. summary statistics from the literature, not datasets. No data from this study,
  including pilots, was used in any form; no web search runs at prediction time.
- **I.3 Blinding attestation ★** — **mandatory.** Signed attestation that no team member accessed, solicited, or was shown any human outcome data from this study, including pilots, before the prediction lock:
  We attest that no team member accessed or solicited any human
  outcome data from this study, including pilots, before the prediction lock, and that no
  such data informed this entry in any way. One passive exposure is disclosed: Max Pellert
  attended a 5-minute talk on preliminary results at the Behavioral Clones workshop (Max
  Planck Institute for Human Development, Berlin, May 2026), confirmed with the benchmark
  organizers (J. Pfänder, 20 Aug 2026). No specific results, effect sizes, or outcomes were
  retained; no outcome information was shared within the team; nothing from that talk entered
  this entry's design, prompts, or calibration. No other team member was exposed (see I.4 and
  the team's signed exposure declaration).
  — Farah Adeeba, Jing Ma, Marcia Ferreira, Max Pellert, August 2026.
- **I.4 Contamination note †** — training cutoff of every model vs public release dates of this project's materials; note any known exposure:
  `claude-opus-5` has a training cutoff in early 2026 (per provider documentation). The
  benchmark's public materials (survey instrument, stimulus texts, submission template) were
  published on GitHub in 2026 and could in principle overlap with the model's training data;
  however, the human outcome data remain sealed and have never been public, so no outcome
  contamination is possible through the model. Preliminary results were presented at three
  academic talks: one team member (Max Pellert) attended one — a 5-minute talk at the
  Behavioral Clones workshop, MPI for Human Development, Berlin, May 2026 — a passive
  exposure confirmed with the benchmark organizers (20 Aug 2026) and declared in the team's
  signed exposure declaration (per the benchmark's rules this is declared, not
  disqualifying). No other member had any exposure through any channel, and no information
  from that talk was shared within the team or used in this entry (see I.3).

## J · Internal selection procedure
- **J.1 Design-space search †** — how the final pipeline was chosen: how many configurations tried, internal validation criterion, what data it ran against:
  The pipeline design (direct Tier-3 forecast, single model, median of 5, calibration-guided
  prompt) was chosen a priori on theoretical grounds and time constraints; no configuration
  search, no internal validation against any outcome data (none is available before the lock).
  One configuration was run once. The only pre-production trial was the 2-call smoke test
  disclosed in C.1, which led to no change in prompts, model, or aggregation. Post-production
  diagnostics (stability, coherence, placebo — see G.1) were run after the prediction file
  was fingerprinted and did not modify it.

## K · Reproducibility & frozen artifacts
- **K.1 Code & materials** — link/DOI, secrets removed, determinism/seeds documented (also record the link in `metadata.json` → `code_repository` / `code_doi`):
  All code is in this repository (`simulation/predict.mjs`, plus the shipped validator
  scripts), released with the Zenodo deposit; `code_repository` in `metadata.json` points to
  the GitHub repository. No secrets in the repo (the API key lives in a gitignored `.env`).
  Non-determinism of the API is documented in F.1; the logs make the submission reproducible.
- **K.2 Raw output logs †** — complete unprocessed model responses archived, hashed, time-stamped (required for Tiers 1–2, public or escrowed; Tier 3 where intermediate generations exist; oversized logs may be a separate linked Zenodo upload):
  Public, in the deposit: `simulation/logs/*.json` — one file per API call (16 interventions ×
  5 runs) containing the complete raw API response (including summarized reasoning, token
  usage, request configuration and timestamps), plus `simulation/logs/run_summary.json`.
- **K.3 Computational resources** — API-call counts, total tokens, cost, compute time:
  Production run (from `simulation/logs/run_summary.json`): 80 API calls (16 interventions ×
  5 samples), 88,245 uncached input tokens + 520,240 cached-read input tokens, 109,825 output
  tokens, ≈ USD 3.45, 3 minutes wall clock. Plus the 2-call smoke test (≈ USD 0.12; 6,503
  cache-write tokens). Total ≈ USD 3.6. No local compute beyond a laptop driving the API.

## L · Disclosure class
Each item above is deposited as **public**, **escrowed** (sealed from the public but available to the
core team and auditors under confidentiality, with a public SHA-256 hash + timestamp so the lock is
still verifiable — an embargo with a sunset date is encouraged), or **withheld** (permitted only for
items marked neither ★ nor †). Your entry's class is set by its **most restricted item** and recorded
in `metadata.json` → `disclosure_class` (and `escrow_doi` if anything is escrowed):
- **A · Open** — all items public. Full results-table standing; all features enter the design-choice analysis.
- **B · Escrowed** — some items sealed but every item is available to the core team/auditors under confidentiality. Full standing with an *escrowed* badge; only publicly disclosed features enter the design-choice analysis.
- **C · Sealed** — one or more permitted items withheld even from escrow. Scored and reported with a *not independently verifiable* flag; excluded from the approach catalogue and design-choice analysis.

**This entry: Class A · Open — every item public, nothing escrowed or withheld.**

★ items must always be public (never escrowed or withheld); † items must be at minimum escrowed. Full
policy: <https://janpfander.github.io/llm_predictions_megastudy/#disclosure>
