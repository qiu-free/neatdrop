# Task 1 backend report — offline quality v5

Implemented only Task 1 on `feat/offline-quality-v5`. No Git commit was created by this worker. Existing extraction, safety, model, taxonomy and cloud modules were not changed; parser/time/memory/text/batch budgets and the default-disabled semantic switch remain in place.

## Contract and behavior

`content_quality.py` provides copying `assess_content(payload, image_input)` and `apply_content_quality(classification, quality)`. The result contains only `state`, finite-whitelist `issues`, server-fixed `summary` text and bounded count metrics. `ocr_mean_confidence` is added only for actual valid finite numeric scores in the existing OCR-line `score` field; invalid, absent, string, Boolean and out-of-range values do not generate a metric or a fabricated probability. The quality object contains no input text, filename, boxes or arbitrary warning strings.

`analyze_local` assesses the existing extraction, applies protective reasons before `decide`, and permits title naming only when quality is acceptable. It preserves the original name for every limited/unavailable result, including partial reads. Existing `sampling` and its `partial_content` reason remain independent. Quality never upgrades a suggestion. Low-information-image warnings clear contradictory document/visual candidates and prevent optional semantic upgrades, preserving abstention for truly blank images. Cloud execution was not changed.

New reasons are `content_quality_limited`, `ocr_quality_limited`, and `purpose_uncalibrated`; existing `example_context` and `competing_categories` are reused. Rule metadata is version 5 and decision metadata version 2; quality metadata explicitly says heuristic/not calibrated.

The eight added purposes are study/experiment_material, study/technical_document, study/reading_excerpt, office/project_plan, office/requirements, office/email, life/warranty and life/insurance. Every rule requires a positive content anchor plus two different supported field groups. A group's synonyms/repetitions count once. A field value must contain a readable letter/number on the same line, before the next recognized field/semicolon; empty fields cannot borrow another line/label. Punctuation-only, missing-value markers and negated fields do not count. Filename-only, isolated titles and one field never select these purposes. Tutorials/templates retain example review; mixed legacy/new or multiple-new purposes disclose conflicts. Image fusion preserves these OCR document candidates against generic object/photo cues. The decision layer independently makes every new-purpose label candidate, even if an upstream review flag is lost.

## Explicit quality thresholds and limits

- The quality pass inspects at most the existing 12,000 characters / 150 OCR lines. Unicode letter/number characters count as readable. Punctuation and mathematical symbols are neutral; fewer than eight readable characters limits textual naming. Zero readable characters in text files gives unavailable. An image with no OCR is legal and does not receive `no_readable_text`; a photo/chart remains classifiable from its existing visual cues.
- U+FFFD is counted separately. Replacement/private-use/unassigned/non-whitespace control characters are suspect. At least two suspect characters comprising at least 10% of nonspace content flags garbling. Any suspect character in the first nonempty line (bounded at 200 characters) also flags it so a long readable body cannot validate a damaged name. These rules do not detect all valid-letter mojibake, bad semantics or factual errors.
- Any valid retained OCR line score below 0.8 limits the result. This is deliberately conservative: a high mean cannot validate a low-score title/support field. The optional mean remains a reading diagnostic. The existing engine discards scores below 0.65 before this module, so this change cannot diagnose discarded content or infer missing confidence values. Old fixtures with no score remain compatible; absence is not a pseudo-score.
- Photos with a few incidental OCR characters may acquire a quality limitation and review requirement while retaining the photo label/name. Completely text-free photos/charts are not rejected. The regression manifest explicitly records this tradeoff. No geometric detector, VLM, OCR/PDF extension, user-data collection or persistent cache was introduced.

## TDD evidence

Unmodified baseline before implementation:

```powershell
.\.venv\Scripts\python.exe -m pytest -q --tb=short
```

Sandbox execution was denied access to pytest temporary directories, existing model manifests and worker-process primitives: 197 passed, 15 failed, 105 setup errors. This was an environment failure before code changes. The same command with approved sandbox escalation passed **317 tests in 50.99 s**. No legacy test was deleted, skipped, loosened or rewritten.

First RED, before creating production quality code / purpose rules:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_content_quality_v5.py backend/tests/test_purpose_rules_v5.py -q --tb=short
```

Observed **65 failed, 41 passed**. Failures demonstrated ordinary/rename behavior for unreadable anchored notes and low-score invoices, missing quality contract, absent eight purpose candidates, erased OCR purpose candidates, absent conflicts, and an unguarded decision-layer promotion. Existing protective negative cases already passed. The first implementation then passed **106 tests**.

Additional RED/GREEN cycles used:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_content_quality_v5.py backend/tests/test_purpose_rules_v5.py -q --tb=short -p no:cacheprovider
```

- **15 failed / 108 passed** demonstrated a damaged title hidden by the body, a low-score title hidden by the mean, empty fields consuming subsequent lines, common negative anchors and multiple new purposes without explicit conflict.
- Separate purpose run: **18 failed / 86 passed**, adding punctuation-only/empty same-line fields and `example.invalid` email domains falsely matching template words.
- **6 failed / 130 passed** demonstrated missing-value markers and a negated duplicate field being reused as support.
- **1 failed / 137 passed**, then **1 failed / 138 passed**, demonstrated blank-image warnings being overridden first by a contradictory visual candidate, then optional semantics.
- Last narrow RED: **1 failed / 28 passed** in the quality file demonstrated a high OCR mean hiding a low-score support field. The valid-score minimum now gates review; the mean remains diagnostic.
- Final v5 targeted GREEN: **140 passed in 0.83 s**. The overlap/nonfunctional-field, input immutability, valid image without OCR, mathematical text and missing-confidence cases also pass.

An earlier combined v5 + legacy classification/decision/chart-fusion run passed **202 tests**. Full backend runs during implementation passed **453** and **456**. The final complete command `.\.venv\Scripts\python.exe -m pytest -q --tb=short` passed **457 tests in 67.43 s**, all 317 legacy plus 140 v5 tests. It ran outside the sandbox with approved escalation for the real local-model/worker tests; there were no failures, skips or warnings. The scoped `git diff --check` also passed (only Git's line-ending notices).

## Development regression and actual classification changes

```powershell
.\.venv\Scripts\python.exe scripts/evaluation/check_quality_v5.py
```

The script runs real `analyze_local`, disables experimental semantics for deterministic execution, and restores the caller's environment. Baseline classifier/decision/analysis are loaded from local Git commit `3336fe5`; unchanged extraction/safety dependencies are shared. It does not use the old `evaluate_offline.py` direct rules path to claim quality-gate effects. Fingerprints, source, expected behavior, grouped variant scope and results are in `docs/evaluation/v5-development.json`, `v5-development-results.json` and `v5-development-results.md`.

Observed **88 / 88 grouped purpose checks**, **9 / 9 quality checks**, no failures. Eight positive text fixtures change from other/unclassified abstention to their intended reviewed candidates. Eight corresponding simulated retained-OCR fixtures also produce the intended reviewed candidates. All new-purpose ordinary counts are zero. This is bounded synthetic rule behavior, not 16 independently sampled documents or measured OCR success.

Frozen v4 vs v5 on the unchanged **40 old text scenarios** shows **zero category/subcategory, level or original-name-policy changes**: 22 ordinary, 11 candidate, 7 abstain. This result protects the legacy development behavior and does not estimate overall classification accuracy.

Replaying the existing **12 saved v4 image payloads** shows zero category/subcategory/form changes, all quality states acceptable. These saved payloads lack retained OCR scores and full sampling coverage, so the script neither invents those metrics nor claims another native OCR/CLIP run. No model inference was needed for this replay.

Quality probes demonstrate garbled notes, low-score invoice OCR and very short notes changing from ordinary to candidate and retaining original names. Partial notes remain candidate but stop using the extracted title. Normal text-free photo/chart labels remain; blank images and empty text remain abstentions. Short incidental photo OCR gains review while retaining its label and original name.

The development checks are hand-authored, grouped, deterministic fixtures with CC0-1.0 authorization. They are separate from the old manifest and do not provide a representative labeled dataset, calibration, production accuracy, or authority to enable ordinary suggestions for the new purposes.

## Review follow-up: negation/missing values and title separators

Two reviewed P2 cases were reproduced before fixes. `没有保修说明` with two otherwise valid fields still selected warranty because the v5-only anchor negation pattern lacked `没有`; `不存在` and `暂无` field values were also treated as readable support. The purpose-only negative/missing-value patterns now include those phrases. Legacy rule matching is unchanged. The exact reported samples are covered through real `analyze_local`, alongside focused rule tests.

The first extracted line `---` (including a Markdown frontmatter opening delimiter) could be sanitized into `---.txt`; `***` similarly became `___.txt`. Naming now independently requires at least one letter/number in the sanitized title. A first line consisting only of punctuation, an empty hash heading, or a frontmatter delimiter preserves the original name. This does not downgrade overall readable body quality or a well-supported ordinary classification. It deliberately preserves the original name instead of parsing YAML/frontmatter or choosing a later heading. Normal Chinese titles and `#` / `###` headings still rename as before. Photo and chart naming policies remain covered by the existing tests.

Review RED command:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_content_quality_v5.py backend/tests/test_purpose_rules_v5.py -q --tb=short -p no:cacheprovider
```

Observed **9 failed / 146 passed** before production changes. Added cases include the reported anchor/mixed missing-value samples, individual new missing markers, `---`, `***`, `...`, empty hash headings, `# ---`, a frontmatter block, and positive ordinary title compatibility.

Review GREEN command:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_content_quality_v5.py backend/tests/test_purpose_rules_v5.py backend/tests/test_classification.py backend/tests/test_decision.py backend/tests/test_chart_fusion_v4.py -q --tb=short -p no:cacheprovider
```

Observed **221 passed in 1.03 s**, including **155 v5 tests**. The development regression command was rerun to refresh current-source fingerprints: 88/88 purpose and 9/9 quality checks still satisfy expectations; zero old-40 label/decision/name changes and zero saved-12 image label/form changes. Final full command `.\.venv\Scripts\python.exe -m pytest -q --tb=short` passed **472 tests in 53.63 s**, all 317 legacy plus 155 v5, with no failures, skips or warnings. Scoped `git diff --check` passed. No commit was created.
