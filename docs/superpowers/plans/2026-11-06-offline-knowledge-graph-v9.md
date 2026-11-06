# Offline Knowledge Graph v9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browse classified archive copies as a clear category graph and inspect, confirm, or manually maintain evidence-backed offline file relationships.

**Architecture:** A graph service projects the existing trusted ArchiveLibrary, with a separate bounded installation-local relationship/index store. Explicit cancellable local jobs decode verified archive bytes, compute sparse text/image features, and publish atomic index snapshots. A lazy React graph page combines Cytoscape, an accessible file/relationship list, and the existing verified preview drawer.

**Tech Stack:** Python 3.12, FastAPI, existing Pillow/OCR and parsing isolation, React 19/TypeScript, Cytoscape.js bundled by Vite, pytest/Vitest.

**Spec:** `docs/superpowers/specs/2026-11-06-offline-knowledge-graph-v9-design.md`

**2026-11-06 approved refinement:** The user now requires Graphify form. The Graphify amendment at the top of the spec overrides the original tree layout/default collapse requirements in Task 2. Backend interfaces and all privacy, trust, file, indexing and acceptance constraints remain unchanged. Task 4 below implements this refinement.

## Global Constraints

- 本机离线优先；不新增云端请求、运行时模型下载或 CDN。
- 原件保留；复制执行必须有独立最终确认；图谱不改变归档路径、日志格式和可信撤回。
- 仅接受当前授权目录内的归档记录 ID；证据读取与候选确认重新核验身份、大小及 SHA-256。
- 主分类、子分类、文件为首版节点；自动相似关系始终是待确认候选，不能推断引用、事件、人物或版本事实。
- 每批最多 50 个文件、单文件最多 20 MiB、总量最多 200 MiB、文本最多 12000 字符。
- 单目录最多 1000 个索引、5000 条人工关系；每文件最多 256 个词项，每词最多 3 个位置；索引快照最多 16 MiB，关系状态最多 2 MiB。
- 每文件最多连接 5 条自动候选边；画布最多 200 节点，分类每次展开 50 文件，局部视图至多 20 邻居。列表不因画布限额丢弃搜索结果。
- 沿用现有主题、侧栏焦点/关闭/预览稳定规则；目录路径与内容不写入浏览器持久存储。
- 已撤回记录及其关系不展示；缺失/变化/未验证副本不读取；旧索引仅是历史快照。
- 验收至少 40 组相关、40 组易混淆无关独立样本；目标候选精度 90%、可读取相关样本的文件覆盖率 60%，报告实测及限制。

## Shared interfaces

The following JSON contract is authoritative across backend, frontend and acceptance tasks:

```ts
type GraphKind = 'duplicate' | 'text_similar' | 'visual_similar' |
  'related' | 'reference' | 'attachment' | 'version'
interface GraphRelation {
  id: string; source: string; target: string; kind: GraphKind
  status: 'fact' | 'suggested' | 'confirmed'
  origin: 'archive' | 'automatic' | 'manual'
  created: string; score?: number; keywords?: string[]
}
interface GraphListing {
  items: LibraryItem[]; relations: GraphRelation[]; truncated: boolean
  index: { count: number; revision: number; updated: string | null
    state: 'empty' | 'ready' | 'unavailable'; issues: {entry_id: string; code: string}[] }
}
interface GraphJob {
  id: string; status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'
  processed: number; total: number; current_file: string | null
  errors: {entry_id: string; code: string}[]; error?: string | null
}
interface GraphEvidence {
  relation: GraphRelation
  files: {id: string; name: string; excerpts: string[]; summary: string}[]
  explanation: string
}
```

All URLs below are relative to `/api/v1/workspaces/{workspace_id}/graph`:

| Method/path | Request | Response |
| --- | --- | --- |
| GET `/` (no trailing slash in actual route) | none | GraphListing |
| POST `/jobs` | `{entry_ids:string[], confirmed:true}` | GraphJob |
| GET `/jobs/{job_id}` | none | GraphJob |
| POST `/jobs/{job_id}/cancel` | `{}` | GraphJob |
| GET `/relations/{id}/evidence` | none | GraphEvidence |
| POST `/relations` | `{source,target,kind,revision,candidate_id?:string}` | GraphListing |
| POST `/relations/{id}/dismiss` | `{revision:number}` | GraphListing |
| DELETE `/relations/{id}` | `{revision:number}` | GraphListing |
| DELETE `/index` | `{revision:number}` | GraphListing |

POST `/relations`: kind is one of related/reference/attachment/version; a candidate_id means confirmation, otherwise manual addition. source→target is directional for reference/attachment/version. Reject self-links, foreign IDs, stale revisions and unknown fields. DELETE `/index` clears extracted features and automatic candidate state but preserves confirmed/manual relations. API mutations use the existing session/CSRF mechanism. Backend errors are stable GRAPH_* codes mapped to Chinese by frontend.

## Task 1: Trusted graph service, local matching, persistence and API

**Files:**
- Create `backend/neatdrop/graph.py` (projection, service, mutations, evidence).
- Create `backend/neatdrop/graph_store.py` (bounded local state and revision commits).
- Create `backend/neatdrop/graph_matching.py` (pure sparse text/image matching).
- Create `backend/neatdrop/graph_jobs.py` (local job lifecycle and bounded indexing).
- Modify `backend/neatdrop/library.py` (reusable trusted archive descriptor/read with local extraction; preserve preview contract).
- Modify `backend/neatdrop/app.py` (strict request models, authorized routes and lifespan cleanup).
- Create `backend/tests/test_graph_v9.py`, `backend/tests/test_graph_api_v9.py`, `backend/tests/test_graph_matching_v9.py`.

**Interfaces:** Consumes `ArchiveLibrary(executor)`, validated journal records and receipt identities, `prepare_input`, `assess_content`, protected metadata I/O. Produces shared JSON above, plus public pure `text_features(text: str) -> dict` and `match_features(features: dict[str, dict]) -> list[dict]` for independent acceptance. Feature dict contains `terms` (term→bounded locations), `fingerprint` (hex or null), `quality`, `sha256`, `identity`, `updated`. Algorithms are versioned.

- [x] **Step 1: Add meaningful failing behavior tests.** Use real Executor+TrustStore archive fixture (follow test_library_v6). A 3-file archive should project proper categories and duplicate relation from journal SHA without decoding contents; removed receipt prevents facts/reads. Test manual directional link survives reopening, expected revision conflicts, foreign/self IDs, content changes, withdrawal pruning. Add route test proving missing feature 404 before implementation.

```python
def test_graph_route_requires_authorized_workspace(client, archived):
    response = client.get(archived.prefix + '/graph')
    assert response.status_code == 200
    assert {i['name'] for i in response.json()['items']} == {'paper.md', 'notes.md'}
    assert response.json()['index']['count'] == 0
```

- [x] **Step 2: Run new tests in red.** `& .venv/Scripts/python.exe -m pytest backend/tests/test_graph_api_v9.py -q --tb=short`. Fail for missing graph route, not fixture mistakes.
- [x] **Step 3: Implement trusted projection and bounded persistence.** Derive stable store key from trust.root_key rather than ephemeral Workspace.id; guard/pin every directory, deny links/hardlinks, read bounded JSON, validate all shapes/IDs, use atomic replacement under lock and fsync. Every mutation increments revision. Corrupt state yields graph index unavailable without suppressing classification items; explicit clear can rebuild safely. Manual relationship metadata never grants file access.
- [x] **Step 4: Add failing matching and evidence tests, then matching implementation.** Normalize NFKC/case, English terms and CJK character fragments, remove generic/template terms with corpus frequency filtering, sparse TF-IDF/cosine, require two independent informative common terms. Keep stable top edges with both endpoints' degree≤5. Fingerprint uses orientation-corrected bounded image; blank images produce none. Similarity is candidate-only. Duplicate facts say archive-time match. Evidence reopens verified bytes and uses actual bounded text intervals; no stored full text. Low quality cannot support text candidates.

```python
def test_same_template_different_subject_is_not_a_fact():
    # Two documents with repeated headings and unrelated body must not become
    # duplicate/reference/version edges; features derive only from decoded text.
    a = text_features('项目报告\n厨房设备巡检，清洗油烟过滤网。')
    b = text_features('项目报告\n森林样地鸟类调查，记录迁徙路线。')
    assert not match_features({'a': a, 'b': b})
```

- [x] **Step 5: Implement explicit local jobs with tests first.** Refuse unconfirmed/empty/>50/over-budget/unavailable inputs; one active job per directory and bounded global concurrency; index only available trusted entries. Decode verified bytes with existing limits/isolation, compute fingerprint and OCR/text features, keep progress/errors. Cancellation never commits partial batch; stale store revision prevents overwrite. Recheck current archive membership and file identity/hash at publish and confirmation. Bounded session jobs, teardown cancel. No cloud/model service calls. Job lookup authorized to same session and workspace.
- [x] **Step 6: Wire strict shared routes.** Reuse current granted/session/CSRF; no arbitrary paths. Include tests for CSRF, other-session workspace and job IDs, guessed relation IDs, stale revisions, missing/changed/same-size replacement, corrupted state and recovery. Add cancellation and failed-per-file tests. Use thread offloading for expensive work so cancellation requests are responsive.
- [x] **Step 7: Run backend graph tests and relevant library/security tests.** `& .venv/Scripts/python.exe -m pytest backend/tests/test_graph_v9.py backend/tests/test_graph_api_v9.py backend/tests/test_graph_matching_v9.py backend/tests/test_library_v6.py backend/tests/test_api.py -q --tb=short`. Inspect diff and commit Task 1.

## Task 2: Graph workspace UI and existing preview/navigation integration

**Files:**
- Create `frontend/src/graphTypes.ts`, `frontend/src/graphProjection.ts`, `frontend/src/components/GraphCanvas.tsx`, `frontend/src/components/KnowledgeGraphPage.tsx`, `frontend/src/components/GraphRelations.tsx`, `frontend/src/components/graph.css`.
- Modify `frontend/src/App.tsx`, `frontend/src/components/Sidebar.tsx`, `frontend/src/pageSession.ts`, `frontend/src/types.ts`, `frontend/src/api.ts`, `frontend/src/components/LibraryPage.tsx`.
- Create `frontend/src/graphProjection.test.ts`, `frontend/src/components/KnowledgeGraphPage.test.tsx`; extend navigation/library tests where needed.
- Modify `frontend/package.json`, `frontend/package-lock.json` for Cytoscape and TypeScript types only.

**Interfaces:** Consumes Task 1 JSON contract. Produces `KnowledgeGraphPage({workspace,history,taxonomy,session,onWorkbench,onLibrary})` with GraphSession containing workspace/query/category/kind/view/focus/expansion/viewport in App-owned memory. `LibraryPage` accepts optional `onGraph(entryId)`. Export reusable `LibraryDrawer` with optional relation footer/action content; preserve existing required props and stable DOM. Graph callback positions current workspace/focus and navigates; GraphCanvas loads Cytoscape lazily and has no runtime CDN.

- [x] **Step 1: Add failing projection tests** for root/category/subcategory/file IDs and deterministic positions, 200-node cap, 50-file expansion, 20-neighbor local view, no hidden search result loss, viewport stability when selection changes. (Root/tree assertions superseded in Task 4.)

```ts
it('keeps all search results outside the canvas limit', () => {
  const result = projectGraph(listingOf1000, {query: '', expanded: ['study/notes']})
  expect(result.nodes.length).toBeLessThanOrEqual(200)
  expect(result.files).toHaveLength(1000)
})
```

- [x] **Step 2: Run in red**, then implement pure projection and shared types. Install pinned available Cytoscape version through npm; bundle types. Use deterministic category/tree layout plus local center+neighbors, text wraps and color+shape+labels. GraphCanvas lifecycle creates once per mount, batch updates diffs, preserves viewport, disposes handlers/observer/instance; controls fit/zoom do not restart layout. Provide graceful render error with usable list. (Layout superseded in Task 4.)
- [x] **Step 3: Add failing interaction tests** for no workspace/no copies, categorized list, filters/search, selecting node/list item to preview, relation evidence, manual relation direction, candidate confirmation/dismiss, index consent/progress/cancel/errors/clear, workspace change abort/discard and memory session restoration.
- [x] **Step 4: Build page flow.** Heading/intro with local-only badge, category overview vs related-file tab, count summary, left/search results list, central canvas, legend/instructions. On narrow screens stack controls and list; use existing full-width drawer. Avoid a dozen competing primary actions: main action is Analyze relations; manual links and index clear in detail/management. Selection checkboxes choose ≤50 index inputs with budget explanation and explicit local-keyword persistence checkbox. Index clear requires reviewable confirmation inside page and preserves manual links. Candidate actions fetch evidence first and display source quality/limited sampling. (Panel placement superseded in Task 4.)
- [x] **Step 5: Reuse preview, wire navigation and API verbs.** Extend api optional method param backward-compatibly so DELETE has CSRF. Add Chinese GRAPH_* errors. Lazy load graph page and canvas. Add knowledge graph sidebar entry, memory-only graph session, workspace reset, focus intent. Library drawer action opens corresponding graph file; graph returns to library. Preserve existing page-scroll logic and drawer keyboard focus.
- [x] **Step 6: Run UI tests/build.** `npm test -- --run`; `npm run build`. Resolve actual regressions, verify no empty-loading races, stale content, unavailable reads or control overflow. Inspect diff and commit Task 2.

## Task 3: Independent quality evaluation, live browser acceptance and delivery

**Files:** Create `backend/tests/test_graph_acceptance_v9.py`, `scripts/evaluate_graph_v9.py`, `docs/v9-delivery-2026-11-06.md`; amend implementation only for demonstrated acceptance defects. QA fixture/scripts/screenshots live in `.tmp-graph-v9/` or authorized visualizations folder, never include private files.

**Interfaces:** Consumes pure Task 1 matching and actual API, Task 2 production frontend. Produces explicit measured precision/coverage report, graph screenshots, release Git commit; no fabricated accuracy claims.

- [x] **Step 1: Create held-out evaluation data independently** of development examples: ≥40 related pairs and ≥40 challenging negative pairs across Chinese/English, structured documents, image OCR-like text, blank/noisy text, same template unrelated content, same name/different content, duplicate bytes vs similar image. Include ≥80 distinct subjects so evaluation is not one duplicated case. Label related groups; report exact edge precision and per-file related recall coverage using full graph labels. Keep image actual-byte tests separate from OCR-like text tests; report this limitation.
- [x] **Step 2: Run evaluation and security acceptance.** Establish failures before correcting code; retain threshold tuned on dev data, do not tune held-out labels. Report precision, coverage, no-result count, quality limitations, and timing at 1000 feature records. If thresholds unmet, improve evidence logic using separate development cases then rerun held-out; keep all results honest.
- [ ] **Step 3: Run full automated checks once on final code.** `& .venv/Scripts/python.exe -m pytest -q --tb=short`; `npm test -- --run`; `npm run build`; `git diff --check`. Sandbox child-process failures request proper escalation, never bypass.
- [ ] **Step 4: Use ego-browser skill for real production QA.** Start local Uvicorn using project venv in a persistent process; open one goal-specific browser taskspace. In synthetic authorized directory, actually classify/copy, open graph, expand/search/select/preview, run indexing, inspect evidence, confirm/manual/dismiss, reload/reopen, clear index, verify manual links survive, undo and verify graph excludes copies. Take desktop 1440px and narrow 390px screenshots, check console/network/UI semantics and horizontal overflow. Confirm graph-only actions do not issue external requests. Record limitations if full network blocking cannot be demonstrated.
- [ ] **Step 5: Delivery.** Update spec status and plan checklist, write measured delivery report including remaining limits and reproducible commands. Commit validated source/tests/docs; retain current feature branch and prior v8 history, do not merge main or publish without an explicit request. State working local URL, version commit and actual results in final.

## Task 4: Graphify form refinement (user requested)

**Files:** `frontend/src/graphProjection.ts`, graph components/styles and their meaningful behavior tests. Do not change the backend contract.

- [x] **Step 1: Inspect the real reference.** Browse the official Graphify repository, website and graph-hero.png. Record the dark force-directed graph, category/community palette, circular nodes, right-side groups/counts and click/filter/search interactions. Add the approved spec amendment.
- [ ] **Step 2: Add failing behavior tests and implement.** Remove the artificial root/tree, show a bounded clustered global network by default, retain local focus, consent/jobs/evidence/manual relations, file/relationship lists and trusted preview. Stable finite force layout must not restart on selection; preserve dragging and viewports, honor reduced motion. Right-side category groups must truthfully represent archive categories. Keep 200-node and 20-neighbor limits explicit.
- [ ] **Step 3: Review and verify.** Run focused then full frontend tests and production build; obtain scoped review of the refinement. Browser-test desktop1440 and mobile390, node/edge interactions, search/group collapse, navigation/viewport/drag stability and full-width preview. Record 1000-record projection/layout timing separately from matching.
- [ ] **Step 4: Deliver.** Complete the original real-flow withdrawal check, verify original hashes, update documentation and commit validated changes on the existing feature branch.
