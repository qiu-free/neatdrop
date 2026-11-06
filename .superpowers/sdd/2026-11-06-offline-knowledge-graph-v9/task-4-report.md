# Task 4 — Graphify form refinement

Status: DONE_WITH_CONCERNS

## Changes

- Replaced the category tree projection with a deterministic, rootless clustered network. Category and subcategory hubs are circular and colored; files are circular nodes whose size reflects relation degree, with category counts and colors carried in node data.
- Default category view shows up to eight files per subgroup so small archives are immediately useful. Explicit subgroup expansion adds files in existing 50-file steps; category collapse remains supported. The projection caps the canvas at 200 nodes, retains all filtered files for the accessible list, and returns `hiddenFileCount`/`maxNodes` for a visible truncation notice.
- Preserved meaningful file-to-file relations across clusters, relation filtering, local relation mode (20 neighbors), deterministic positions, per-mode viewport state, and existing open/preview/evidence callbacks.
- Updated Cytoscape styling to a dark Graphify-like workspace with colored round nodes, delicate relation lines, category edge styles, dashed suggested edges, readable labels/tooltips, and hover/selection neighborhood highlighting with dimmed unrelated nodes. Hover/selection exposes the complete filename in an accessible `当前聚焦文件` status readout.
- Added a dark right category group/count/filter panel on desktop and responsive stacking below the graph at the existing narrow breakpoint. Existing accessible file and relation lists remain the keyboard-readable fallback.
- Added projection tests for rootless/default-file behavior, collapse/expansion, bounded node count, hidden file reporting, cross-category relations, deterministic positions, and the 1,000-record benchmark bound.

## Red/green evidence

- Red: focused projection test run failed 4 tests against the old root/tree implementation (root present, no default files, missing hidden count, missing visible cross-category relation).
- Green: `npm test -- --run src/graphProjection.test.ts src/components/GraphCanvas.test.tsx src/components/KnowledgeGraphPage.test.tsx` — 3 files, 32 tests passed.
- Green: `npm run build` — TypeScript and Vite production build passed.
- Benchmark: isolated 1,000-record projection measured `17.76 ms`, produced `200` nodes, and retained `1000` files. The durable test asserts the same bound and a `<1000 ms` limit.

## Commit

Initial commit: `64c994b`. Final hover/right-panel refinement is staged for amend in this task branch.

## Concerns / limits

- Parent task owns browser QA. I did not run external/browser screenshot validation. The page/canvas tests use a Cytoscape test double, so visual spacing should be checked at 1440px and 390px by the parent.
- Cytoscape uses preset deterministic positions rather than a runtime force simulation; this keeps selection and preview interactions stable and avoids visible settling. The resulting layout is Graphify-like clustered geometry, not a probabilistic community layout.
- Existing task-branch documentation edits are unrelated and were left untouched.
