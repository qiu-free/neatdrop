# NeatDrop 离线分类能力提升 Implementation Plan

> **For agentic workers:** Use executing-plans and dispatching-parallel-agents for independent ownership domains; do not concurrently edit shared files. Track each verified deliverable below.

**Goal:** Deliver bounded local extraction, semantic candidates, explicit review decisions, useful explanations and reproducible offline evaluation.

**Architecture:** Preserve safe file reading and execution. Extraction produces bounded text/layout plus sampling metadata; rules and a verified local ONNX semantic package generate candidates; a separate conservative decision function controls review. No semantic category is ordinary until independently validated.

**Tech Stack:** Python 3.12, ONNX Runtime, tokenizers, RapidOCR, NumPy, FastAPI, React/TypeScript/Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-offline-classification-improvement-design.md`

## Global Constraints

- Preserve originals, fixed taxonomy and directories, explicit confirmation and trusted undo.
- Inference never downloads or calls cloud; model preparation is explicit. Cloud payloads remain ≤1500 text characters / ≤1024px EXIF-free thumbnails.
- Keep file/batch/image budgets and PDF worker 12 second / 384 MiB isolation. Bound native inference with disposable workers/timeouts where necessary.
- Default runtime content/vectors remain in memory. Evaluation accepts explicit authorized manifests; no automatic collection.
- Nine main classes, 35 subcategories. Fallback labels do not compete as semantic concepts.
- Publish measured scope and sample limitations. Synthetic fixtures do not establish production accuracy.
- No Git checkout exists; implement in user-named directory. No Git initialization or commits.

## Shared contracts and ownership

`sampling` is `{kind: str, truncated: bool, budget_exhausted: bool, segments: list[dict], summary: str}`. Text segments use `start/end`; PDF uses `page`; image uses `box` in original pixels. Summary is Chinese user-facing plain text.

`semantic.classify_semantic(text: str) -> dict` returns `{candidates: list, warnings: list[str], version: str, truncated: bool}`. Candidate is `{category, subcategory, score, evidence?: str}`; semantic is candidate-only until calibrated. `semantic_status() -> dict` returns available/name/state/version/integrity_check, never initializes over network.

`decision.decide(rule_result: dict, semantic: dict | None = None, sampling: dict | None = None) -> dict` preserves current suggestion keys, adds decision_level/candidates/engine_versions/sampling, returns review_required true for candidate/abstain. No externally supplied directory.

Extraction owner: extraction.py/parsing.py/offline.py and new extraction-specific tests. Semantic owner: semantic.py/classification_profiles.json/scripts/prepare_semantic.py and semantic tests. UI owner: frontend types/Inspector/Settings and related UI CSS/tests. Root: classifier.py/decision.py/analysis.py/evaluation/docs; integrates after domain reports. Agents must not spawn agents.

### Task 1: Extraction and local image processing

- [x] Tests fail for head/middle/tail sampling, four-page PDF quotas, OCR coordinates/overlap deduplication, bounded long-image views and integrity status.
- [x] Implement `extraction.sample_text(text, limit=12000) -> dict` with text/sample/truncated/sampling and `image_regions(size) -> list[tuple]` for full view + ≤5 tiles. Update PDF local path only; retain cloud sampling behavior.
- [x] Retain existing `OfflineEngine.analyze(image, use_ocr=True, use_vision=True)` shape; add sampling and box data. Full-image letterbox visual input plus bounded local view; do not erase existing warnings. Add worker entry usable by analysis for hard native timeout.
- [x] Run extraction, parsing, offline and security-focused regression tests. Real OCR/CLIP must be exercised, not only fake sessions.

Test intent:
```python
result = sample_text('A' * 9000 + 'MIDDLE' + 'B' * 9000 + 'TAIL')
assert len(result['text']) <= 12000
assert 'MIDDLE' in result['text'] and 'TAIL' in result['text']
assert result['sampling']['truncated'] is True
```

### Task 2: Profiles and semantic candidates

- [x] Tests fail for profile consistency, fallback exclusions, unknown model/missing/corrupt packages, deterministic chunk budgets, bounded ONNX inference and no-network operation.
- [x] Define all 35 profiles with definitions, positive/negative examples, necessary structure and candidate support status. Group/subtype authority remains taxonomy.py.
- [x] Implement verified local ONNX + tokenizer CPU candidate engine, masked mean pooling for E5 with required query/passages, or documented BGE CLS pooling. Bound six ≤384-token chunks with ≤48 overlap; process one model at a time; no persistent document embeddings.
- [x] Explicit prepare/import CLI selects fixed model revision and trusted expected file digests from authoritative model metadata, validates HTTPS redirects and safe relative paths, size caps, licensing and atomically publishes a verified package. Never use remote-code model loading.
- [x] Prepare a small candidate package if network is available; run real inference with networking blocked. Report exact revision, hashes, package size and latency; keep candidate-only.

Run: `.\.venv\Scripts\python.exe -m pytest backend/tests/test_semantic.py -q`

### Task 3: Rules, decision and analysis integration

- [x] Save original rule classifier under scripts/evaluation as fixed baseline before modifications.
- [x] Write failing tests for unanchored academic structure, notes, competing same-main subtypes, semantic-only review, missing capabilities, sampling coverage and naming refusal.
- [x] Add structure-only candidate rules for clearly recognizable documents while preserving negation/example safeguards; keep unvalidated new rules review-required.
- [x] Implement decision layer: merge valid candidates without mixing score scales; propagate all mandatory review reasons; main-only if close same-main candidates; conflicting main classes require review; no candidate => abstain; all uncalibrated semantic/structural results require review.
- [x] Integrate local text sampling, bounded worker image/semantic processing, candidate metadata and engine versions. Cloud branch unchanged. Reject invalid candidate IDs. No confidence percentages.

Test intent:
```python
r = decide({'category': 'other', 'subcategory': 'unclassified', 'review_required': True,
            'review_reasons': ['insufficient_evidence'], 'candidates': [], 'evidence_items': []},
           {'candidates': [{'category': 'study', 'subcategory': 'paper', 'score': .85}],
            'warnings': [], 'version': 'test', 'truncated': False})
assert r['category'] == 'study' and r['review_required']
assert r['decision_level'] == 'candidate'
```

### Task 4: UI candidates and explanations

- [x] Tests fail for candidate edits (not approval), disabled controls during analysis, no percent score, sampling scope, main-only and semantic capability states.
- [x] Extend Suggestion types with nullable subcategory, decision_level/candidates/sampling/engine_versions and optional evidence locations. Extend Config offline.semantic.
- [x] Render bounded valid candidate buttons and Chinese explanations; candidate selection calls current onEdit with original name + category/subtype, invalidating confirmation through existing hook. Render semantic status in settings without implying model installation triggers a download.
- [x] Accessible keyboard/mobile layout; retain current visual style. Run targeted Vitest then production build.

### Task 5: Evaluation tooling and development corpus

- [x] Tests fail for split-group leakage, unsupported/malformed manifests, abstention counted as miss, ambiguous must-review errors, Wilson intervals and no private text in reports.
- [x] Add explicit manifest evaluator with frozen baseline/new stages, strict local paths, source/group/split metadata, per-class precision/recall/F1/confusion, Top-1/Top-3, ordinary error/coverage, review/abstain, processing failures and runtime metrics.
- [x] Publish small hand-authored licensed synthetic development corpus covering positives, unanchored structures, confusing examples, empty/misleading filenames and out-of-scope content. Do not inflate template variants to claim 300–500 independent examples.
- [x] Run comparison and save anonymous JSON/Markdown reports. Include sample hash/version, exact denominator, latency and uncertainty; no deployment accuracy claims.

Run: `.\.venv\Scripts\python.exe scripts/evaluate_offline.py --manifest docs/evaluation/development.json --output docs/evaluation/2026-11-03-development-report.json`

### Task 6: Review, integration and final verification

- [x] Independent task review of each domain after report. Resolve correctness/safety defects before final regression.
- [x] Full backend tests, full frontend tests and TypeScript/production build. Verify cloud payload bounds and current confirmation/undo behavior.
- [x] Real OCR + semantic + CLIP with in-worker Python socket/DNS denial (completed); OS firewall/packet-level acceptance remains unverified and disclosed. Missing model and timeout paths produce explicit review/warnings.
- [x] Browser desktop/mobile validation: analyze, inspect scope/candidates, choose candidate, individually confirm, copy and trusted undo; hash originals before/after.
- [x] Update README/daily-use and delivery report with actual results and limitations. No claim that real-user frozen evaluation exists.

## Progress and rulings

- Ruling: in-place development — specified folder is not a Git repository; keep all previous work.
- Ruling: independent extraction/semantic/UI ownership permits parallel work under dispatching-parallel-agents; root owns integration and final review.
- Ruling: authorized scope includes explicit public model preparation and synthetic evaluation; real personal samples are not automatically collected.
- Ruling: use candidate-only status for new semantic/structure capabilities until representative independent validation; ordinary current rules are preserved only where existing conservative gates remain satisfied, with explicit uncalibrated quality status.
- Ruling: no 400-template synthetic inflation. Deliver evaluation infrastructure and an honest small development corpus; representative collection remains a separate data dependency.


## Final delivery ledger (2026-11-03)

- Tasks 1–6 engineering deliverables complete; see docs/offline-classification-delivery-2026-11-03.md for actual results and remaining data/environment acceptance.
- Ruling: semantic package remains experimental and default off — final 40 synthetic development scenarios show no additional Top-1/Top-3 gain. Explicit NEATDROP_SEMANTIC_CANDIDATES=1 is required. No further similarity threshold tuning on these fixtures.
- Ruling: preserve independently sufficient rules on optional semantic failure, disclose engine warnings/degraded metrics. Missing rules plus missing semantic evidence still abstains.
- Ruling: 300–500 representative authorized samples and OS firewall/outbound capture are not fulfilled; do not label them complete or claim calibrated production quality. Engineering fixtures/no-Python-network tests are bounded evidence only.
- Independent reviews and fixes completed: semantic/CLIP immutable verified bytes, OCR pinned model/ancestor handles; real native PID termination; PDF cancellation and newline sampling; main-only and same-parent conflicts; tutorials/examples; natural-photo OCR naming; report leakage/denominators/fingerprints.
- Frontend final: 15 files / 99 tests passed; TypeScript and production build passed. Browser 1440x1000 and390x844: candidates and read scope, confirmation invalidation, copy1/trusted undo1, four original hashes unchanged, external fetch0, runtime console issues0.
- No source Git repository; no commits/PRs/pushes. Current in-place checkout preserved; same local service remains at127.0.0.1:8765.
