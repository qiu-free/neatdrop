# Task 1 report: production pipeline and evaluation alignment

## Delivered

- Added `neatdrop.classification_pipeline.classify_payload(record, payload, *, semantic=None)` as the shared, deterministic suggestion builder for already decoded inputs.
- Moved production quality assessment/application, text or image classification, decision fusion, evidence coordinate mapping, safe title generation, and suggestion metadata into that pipeline. `analyze_local` delegates to it after running the existing optional semantic adapter. Existing module-level classifier, image fusion, quality, decision, semantic, `analyze_local`, and `local_suggestion` integration seams remain patchable/available.
- Changed offline `rules` and `semantic` stages to use the production pipeline. `rules` observes `NEATDROP_SEMANTIC_CANDIDATES`; `--semantic off|on` explicitly overrides that rules-stage setting. The `semantic` stage remains a clearly reported forced experiment.
- Extended explicit evaluation file paths to DOCX, PPTX, XLSX, and CSV in addition to the previously supported formats. Extraction continues through the bounded local `prepare_input` path. Scanned PDF and Office embedded images remain unsupported.
- Added anonymous aggregate counts for content quality states, evidence source types, and suggested name changes. Reports contain no suggestion evidence text or names. Engine, evaluation script, split script, sample, baseline, and model/package provenance remains fingerprinted.
- Added `scripts/evaluation/make_group_splits.py`, a seeded SHA-256 group assignment CLI with split-ratio validation, leakage refusal, input digest, algorithm/seed/ratio metadata, and group/record counts. It only repartitions provided rows; it does not collect data or establish quality evidence.
- Updated `docs/evaluation/README.md` with accepted formats, product/experiment semantic behavior, report fields, and split-tool usage.

## Verification

- TDD: the new pipeline import test failed before implementation (`ModuleNotFoundError`); the legacy classifier patchability test also failed before its compatibility adapter was restored. Both now pass.
- Focused production/evaluation and affected analysis, purpose-rule, quality, evidence, chart/image, and document-format suites: **546 passed**.
- Full `backend/tests` after the final semantic-toggle reporting test: **870 passed, 2 skipped**.
- Offline development-manifest run, baseline vs product `rules`: both processed 40/40 with no failures. Baseline recorded 29/35 labeled top-1 subtype hits and 28 ordinary suggestions / 1 ordinary error. Rules recorded 35/35 and 21 / 0 respectively. These are hand-authored synthetic development fixtures only, not independent accuracy results.
- Group split CLI on the same 40 development records, seed `task1-review`: 40/40 groups kept intact and assigned 24 development, 8 calibration, 8 test groups. Input manifest SHA-256: `76524ab434b3561010361575cbda1873abd96900e4ec90d43a29bc46ea461259`.
- Existing frozen quality behavior checker: all checks passed (legacy40 40/40, diagnostic40 40/40, new7 168/168, adjacent 14/14, robustness 6/6, prior8 88/88, quality9 9/9, review13 13/13; no failures).

## Limits

- The evaluation corpus still contains only 40 synthetic development fixtures. The generated split metadata does not create a frozen or independent test set, and no real-user accuracy claim is supported.
- Semantic behavior is split into the product-toggle rules run and a separately labeled explicit semantic experiment. Semantic candidates remain experimental and do not gain calibration from this work.
- Scanned PDF OCR and embedded Office image extraction are still outside the supported evaluation path.
- Temporary evaluation artifacts were written under ignored `.cache/task1-*` paths and are not part of this change.
