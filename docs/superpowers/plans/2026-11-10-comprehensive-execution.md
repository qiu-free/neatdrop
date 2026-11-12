# NeatDrop comprehensive optimization implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement the approved comprehensive optimization specification, starting with a working browser experience and production-aligned evaluation, then adding authorized catalog aggregation and supported extraction improvements.

**Architecture:** Keep local security/execution unchanged. Build-time adapters isolate a browser memory implementation; shared capability flags control actual operations and copy. Production evaluation reuses classification rather than reproducing decisions. Catalog aggregation requires current per-root authorization and fresh file verification.

**Tech Stack:** React19, TypeScript, Vite, Vitest, Python3.12, FastAPI, pytest, local ONNX/OCR.

**Spec:** `docs/superpowers/specs/2026-11-10-neatdrop-comprehensive-optimization-design.md`.

**执行记录（2026-11-11）：** 本轮工程已按下表完成并验证，详见`docs/releases/2026-11-11-comprehensive.md`。未勾选项保留为实际待办：完整递归迁移和公网Qoder发布。本轮不等于综合设计中的独立准确率、纠正数据与模型比较、外部用户研究均已完成。

## Global constraints

- Local 50 files / 20MiB each / 200MiB batch, graph200 nodes, copy-only, no overwrite, no uncertain execution retry.
- Preserve source identity, CSRF, Host/Origin and loopback protection, model integrity and budgets.
- Browser inputs: UTF8 TXT/MD max10, 512KiB each,2MiB total,12000 analysis chars; memory only, no API/cloud/localhost connection.
- Keep fixed taxonomy IDs, MASTER blue-white theme and five navigation destinations.
- Existing untracked web-demo draft is not approved authority; preserve it intact.
- Do not invent representative data, human study outcomes, Qoder authorship, public deployment or model accuracy.
- Implement with regression tests, inspect renders, record evidence and unresolved external inputs.

## Task 1: Production pipeline and evaluation alignment

**Files:** `backend/neatdrop/analysis.py`, new `classification_pipeline.py`, `scripts/evaluate_offline.py`, `backend/tests/test_classification_pipeline.py`, `test_evaluation.py`; split tooling `scripts/evaluation/make_group_splits.py` if needed.

**Interfaces:** consume verified decoded payload and file record; produce the exact existing production suggestion (category,quality,candidates,evidence locations,name,sampling). Export `classify_payload(record,payload,*,semantic=None)` from the new pure pipeline, retaining `local_suggestion` compatibility and cancellable semantic invocation in analysis.

- [x] Add failing parity tests comparing production and evaluate on low-quality, partial, image and Office/CSV fixtures; no paid requests or personal data.
- [x] Run targeted pytest and observe failures attributable to missing parity.
- [x] Extract existing decision/evidence/name logic preserving order; reuse in evaluation, add supported-format parity and actual product semantic toggle vs explicit experiment reporting.
- [x] Add source-group split CLI with deterministic assignment, group leak refusal and input/output metadata; do not claim data collection completed.
- [x] Run affected backend tests, document limits, commit scoped files and report.

```python
def test_evaluation_uses_production_quality():
    result = classify_payload(record, {"text": "abc", "sample": "test"})
    assert result["review_required"] is True
    assert result["quality"]["state"] != "acceptable"
```

## Task 2: Runtime contracts and experience build

**Files:** `frontend/src/api.ts`, new `apiMessages.ts`, `runtimeCapabilities.ts`, `experience/capabilities.ts`, `experience/experienceApi.ts`, `frontend/vite.experience.config.ts`, `frontend/package.json`, `frontend/scripts/check-experience-bundle.mjs`; competition docs.

**Interfaces:** same `api<T>(path,body?,signal?,method?)`, `initSession`, `bytes`, `explain`; `runtimeCapabilities` immutable named export with environment and independent file-vs-memory actions. Local unchanged.

- [x] Write contract/build tests: local still acquires CSRF; experience init calls no fetch; unknown routes reject; abort prevents state mutations.
- [x] Extract pure error text/bytes without editing transport semantics. Add exact aliases for api and runtimeCapabilities only in experience build.
- [x] Provide build:experience, preview:experience scripts and assert no `/api/v1`, `/api/session`, local picker/config service strings in runnable web modules; local build excludes datasets.
- [x] Prepare sourced requirements/real Qoder record template, submission draft and capability matrix; mark external facts unverified.
- [x] Verify both builds and API regression, commit.

## Task 3: Real browser text classification and matching

**Files:** new `experience/textClassifier.ts`, `textRelations.ts`, `classify.worker.ts`, `workerClient.ts`, `dataset.ts` and tests; shared fixtures generated from taxonomy profiles.

**Interfaces:** classify accepts actual name/text to return Suggestion-compatible result without file I/O; matching returns GraphRelation candidate and evidence. Worker requests have ID,task,payload; pending requests abort and terminate/reset safely.

- [x] Add tests: renamed filenames preserve content category, negated/tutorial/out-of-scope input refuses, changed content changes category, low/partial input requires review, unknown purpose never creates a path.
- [x] Implement versioned conservative learning subset from profiles and independent structure cues, maxTop3 and explicit evidence/sampling. No precomputed result by sample ID.
- [x] Real bounded sparse matching over body terms; category identity alone never creates edge; duplicate digest is only fact. Include evidence spans.
- [x] 12份可分发样例按已批准规格拆为8份实际文本及4份明确预录图片结果。正常路径与失败示例分开。
- [x] Test Worker abort/concurrency, run bundle and tests, commit.

## Task 4: Browser memory workflow, imports and export

**Files:** new `experience/engine.ts`, `imports.ts`, `exportManifest.ts` and tests; experienceApi connects engine.

**Interfaces:** implement existing config,workspace,preview,analysis job,plan,execution,transaction,library and graph API contract in memory. Return cloned snapshots; execution requires digest + true confirmation and may happen once. Public export emits metadata only.

- [x] Test main routes using real classifier, cancellation, unknown IDs, invalid plans, review/edit invalidation, safe name/conflict, memory archive/withdraw and graph revision.
- [x] Implement bounded jobs progressing from real Worker computations, controlled cancel, reset and no phantom processing timers.
- [x] Imports validate count,size,UTF8,binary,extension, total and cancellation before state update. Render text as text, no HTML evaluation or automatic URLs.
- [x] Export JSON/CSV with spreadsheet formula-injection protection, deliberate download and no original content.
- [x] Test contracts and build, commit.

## Task 5: Shared UI capability integration and review clarity

**Files:** `App.tsx`, `Sidebar.tsx`, `Workbench.tsx`, `ConsentDialog.tsx`, `PlanDialog.tsx`, `HistoryPage.tsx`, `LibraryPage.tsx`, `KnowledgeGraphPage.tsx`, `useWorkspace.ts`, new `reviewEligibility.ts`, experience banner/import UI; relevant tests/CSS/help/workflow.

- [x] Tests for local unchanged, web no local directory/cloud config, separate canOrganizeInMemory vs canCopyFiles, honest save/withdraw semantics and reset.
- [x] Add experience header, learning load and text import, real progress, export, five-stage help. Model settings unavailable in web; do not merely show disabled dead actions.
- [x] Add ordinary-selected confirmation with explicit selected IDs, preserve one-click selected confirmation with candidate/main-only counts. Shared eligibility prevents UI/state mismatch.
- [x] Local preview/selection stability stays unchanged. Graph empty states distinguish no archive/no index/no matches; surface current-root scope.
- [x] Full frontend suite and two builds; browser desktop/mobile full workflow, cancellation and responsive keyboard QA; commit.

## Task 6: Authorized multi-root catalog and graph

**Files:** new `backend/neatdrop/catalog.py`,`catalog_store.py`,`catalog_graph.py`, API/session hooks and tests; frontend catalog API/types/components and page integration.

- [x] Root registry persistence never grants access; currently authorized workspaces only can preview/index.
- [x] Composite identity and per-root origin,10roots/1000paged entries, fresh verified links, revision and source changes tests.
- [x] Show add root/reauthorize/offline/remove states; revoke cancels jobs/preview and invalidates derived links. Preserve existing workbench draft.
- [x] Cross-root evidence validates both ends; no fake relations, old journal unchanged.
- [x] Backend security/integration and frontend graph tests + actual two synthetic-root verification, commit.

## Task 7: Extraction improvement with bounded scanned PDF OCR

**Files:** parsing/analysis/offline extraction path, new pdf_ocr worker/tests, local capability/config/docs.

- [x] Investigate available licensed rendering dependency before adding it. Text PDF remains unchanged.
- [x] Add missing/disabled/cancelled/encrypted/corrupt/budget tests. At most4sample pages, parent60s total, existing resource slots and memory/pixel caps.
- [x] Explicit local opt-in OCR fallback, real page/box evidence, partial warning, no hidden cloud/download.
- [x] Run actual generated scanned PDF OCR plus isolation tests, report speed and limits without accuracy claims, commit.

## Task 8: Directory recovery and controlled nested-file handling

**Files:** files/app/API records/frontend directory UI and tests. Full recursion additionally touches executor/trust/records only under source-relative-path versioning.

- [x] Child-folder navigation has explicit authorization and never follows reparse points. Canceled picker is not analysis error.
- [ ] 完整递归留待后续：defaultoff/maxdepth3/2000enumeration，拆分relative_path/basename并迁移读取、哈希、计划、日志和凭据；本轮未启用。
- [ ] 启用完整递归前补齐路径逃逸、junction、不同子目录同名、身份替换、批次上限及真实复制/撤回的迁移验收；本轮直接子目录已有独立身份和链接拒绝用例。
- [x] If migration cannot meet safety tests, keep recursion disabled and report reason; child open remains usable.

## Task 9: Release acceptance and competition evidence

**Files:** docs/releases report, competition draft and start/build checks.

- [x] Fresh full frontend/backend tests and local/experience builds; original digests unchanged in synthetic execution.
- [x] Actual browser flow, input mutation, zero API/cloud, mobile/keyboard/reducedmotion and graph evidence.
- [x] 产出独立静态构建、第三方声明及22份文件的提交/哈希清单；记录部署工具缺失和外部条件。
- [ ] Qoder Sites实际账户发布、公开URL、HTTPS/另一设备与回滚验收；不编造资格确认或Qoder工作历史。
- [x] Record exact delivered vs remaining data/human/external checks, commits, commands and per-feature switches. Do not claim full optimization until all required gates achieved.
