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

## Review round 1 fixes

- Preserved every consistent existing group split assignment when a manifest is extended; only groups without a split receive deterministic SHA-256-ranked assignments. Existing within-group conflicts still raise `GROUP_SPLIT_LEAK`. Metadata now records preserved and newly assigned group counts.
- Added `parsing.py` and `document_formats.py` to evaluation engine fingerprints so Office/CSV extraction changes are represented in reports.
- Reports now distinguish the requested rules toggle mode (`product`, `off`, or `on`) from the effective semantic-enabled boolean. `evaluate(..., semantic_mode=...)` makes this state testable and the CLI passes the requested mode directly.
- Added regression tests for frozen assignment stability after appending a group, both parser fingerprints, and enabled/disabled semantic state reporting.
- Added the Task 7 `pdf_ocr.py` extraction module to the fingerprint set and asserted that it appears in reports; Task 7 implementation files remain untouched.

Verification commands and observed output:

```text
.venv/Scripts/python.exe -m pytest backend/tests/test_evaluation.py -q --tb=short -p no:cacheprovider
20 passed in 4.82s
```

The two parser fingerprint assertions failed with `KeyError: 'parsing.py'` before the fix. The semantic-state tests failed with missing report keys before the fix. The initial frozen-group test failed because `preserved_group_count` was absent and group assignments were recalculated; after the fix, its existing group-to-split mapping stayed unchanged when a new group was appended.

Final focused verification after adding the PDF OCR extraction fingerprint:

```text
.venv/Scripts/python.exe -m pytest backend/tests/test_evaluation.py backend/tests/test_classification_pipeline.py backend/tests/test_analysis.py backend/tests/test_analysis_v3.py backend/tests/test_document_formats_v7.py -q --tb=short -p no:cacheprovider
117 passed in 56.21s
```

## Review round 2 fix

The round 2 reviewer found that `pdf_ocr.py` is supplied by a concurrent Task 7 change and is absent from Task 1 commit `bc69f08`. Its optional source fingerprint now returns the explicit value `unavailable` when the module is absent; when present it still reports the module SHA-256. All required engine files still fail visibly if missing. The regression test simulates that clean commit boundary by hiding the optional file and confirms that text-only evaluation completes and reports `unavailable`.

TDD evidence: before the fix, the new test failed at `evaluate()` with `FileNotFoundError` while reading `pdf_ocr.py`. After the fix:

```text
.venv/Scripts/python.exe -m pytest backend/tests/test_evaluation.py backend/tests/test_classification_pipeline.py -q --tb=short -p no:cacheprovider
28 passed in 2.70s
```
