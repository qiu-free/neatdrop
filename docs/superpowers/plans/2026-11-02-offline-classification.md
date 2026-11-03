# Offline Classification Implementation Plan

> Execute inline using superpowers:executing-plans, test-first. User already
> approved implementation. No git repository exists; preserve existing files.

**Goal:** Real offline image/text classification with clear active-file UI.
**Architecture:** Fixed taxonomy + scored text evidence + OCR/CLIP adapters.
**Tech Stack:** Existing FastAPI/React; CPU ONNX Runtime, RapidOCR, tokenizers.
**Spec:** `docs/superpowers/specs/2026-11-02-offline-classification-design.md`

## Global Constraints

- Originals never change. Copy and Windows locked-handle undo remain mandatory.
- Preserve old six IDs/flat transaction paths; fixed allowlisted nested folders.
- Local inference never downloads or calls cloud; setup is explicit.
- Similarity/rule scores are not accuracy; unknown/conflicts need review.
- Keep local 12000-character sample separate from 1500-character cloud sample.
- Single active-file identity drives row and detail; batch check is separate.

## Task 1: Taxonomy and conservative evidence scoring

Files: `taxonomy.py`, `classifier.py`, `analysis.py`, `files.py`, `executor.py`,
`app.py`, `model.py`; tests `test_classification.py`, `test_executor.py`.

- [x] Write tests: lecture mentioning invoices -> study/notes; real invoice fields
  -> finance/invoice; two competing document kinds -> review; filename-only -> review.
  `assert classify_text('课程笔记', '讲解发票识别算法')['category'] == 'study'`.
- [x] Run new tests and observe failures, implement normalized weighted evidence.
  Contract: `classify_text(name, text) -> dict` with category/subcategory/tags/form,
  evidence/review_required/review_reasons. Fixed `destination(category, subcategory)`.
- [x] Add nested archive/undo and invalid category-subcategory tests, observe red,
  implement server path registry with legacy flat-path compatibility, rerun suite.

## Task 2: Actual offline OCR and visual encoder

Files: `offline.py`, `scripts/prepare_offline.py`, `pyproject.toml`,
`backend/tests/test_offline.py`.

- [x] Write tests for OCR text extraction contract, ambiguous visual scores and
  explicit missing models; run red. Adapter `analyze_image(data) -> dict` returns
  text evidence + visual candidates, does not claim success without models.
- [x] Install CPU dependencies and inspect shipped APIs/model graphs. Download only
  fixed known model files via explicit setup, save revision/hash manifest locally.
- [x] Implement OCR+CLIP runtime and capability status. Infer with local files only,
  CPU sessions capped; initialize lazily and serialize inference with a lock.
- [x] Run real OCR Chinese receipt and CLIP scene fixture with socket access blocked;
  retain honest review on ambiguous/blank images and measure observed timings.

## Task 3: Active file and detailed classification interface

Files: `types.ts`, `FileTable.tsx`, `Inspector.tsx`, `Workbench.tsx`, `useWorkspace.ts`,
`ConsentDialog.tsx`, `SettingsDialog.tsx`, `styles.css`; frontend component tests.

- [x] Add failing tests: row-cell click activates it, checkbox focuses that file,
  stale preview never appears after a later request; search filter reconciles detail.
- [x] Run tests, implement shared visible-file selector; single active ID plus
  independent checked Set. Add accessible current-view indicator/keyboard control.
- [x] Show two-level labels, form/evidence/review/status. Increase contrast/type,
  bounded table scroll and sticky detail, mobile jump-to-details and navigation.
- [x] Run frontend tests, TypeScript and build, correct regressions.

## Task 4: Integrated verification and local delivery

- [x] Backend regression, frontend tests, model hash verification and audits.
- [x] Browser 1440px/390px: offline analysis -> row/checkbox/detail sync -> filter
  -> edit subcategory -> confirm nested copy -> undo; verify source hashes unchanged.
- [x] Update README/config/startup and record model/fixture limits and evidence.
- [x] Restart only this app's known service and leave http://127.0.0.1:8765 usable.

## Verification evidence (2026-11-02)

- 74 backend tests pass, including actual Chinese OCR, actual quantized CLIP, local
  job with socket connections blocked, old flat undo and new nested undo.
- 10 frontend tests pass, including row/checkbox/keyboard, stale A/B preview and
  stable-ID changed-hash preview refresh. TypeScript and Vite production build pass.
- Pinned CLIP revision and SHA-256 validated; installed model weights total about
  156 MB. RapidOCR local weights ship in the pinned dependency. No inference download.
- Public model-doc fixture `huggingface/documentation-images/coco_sample.png`
  retrieved from hf-mirror for the test cache only; cats classified photos/pet.
  Synthetic Chinese invoice classified finance/invoice. These are smoke examples,
  not an accuracy benchmark. First cold OCR+CLIP observed about 5 seconds on this
  host in one synthetic example; no general performance promise.
- Browser plugin absent. Ego Lite loaded page/snapshot but later clicks failed
  'element is not visible in viewport'. Isolated headless Chrome/Playwright used.
  1440x1100 and 390x844 passed: category-cell activation, checkbox detail sync,
  keyboard, delayed stale preview, search reconciliation, nested confirmed copy,
  withdrawal, mobile jump, and changed same-name file rescan. Six originals checked
  unchanged after copy/undo. No console errors or external browser requests.
- Screenshots outside repo inspected: active rail/background/badge, checked-row
  distinction, typography contrast, category/subtype/form labels, inspector and
  mobile table scroll. No redesign or generated reference used.
- npm audit reports zero; Python 3.12 pip-audit of all pinned transitive dependencies
  using --no-deps reports no known vulnerabilities. Earlier audit tool defaulted
  to Python 3.15 and could not resolve RapidOCR; fixed by choosing project Python.
- Review reproduced and fixed negated/quoted invoice evidence, visual fallback
  erasing OCR conflicts, and same-ID rescan stale preview. No unresolved review item.
