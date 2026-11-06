# Task 2 frontend report

Status: implemented and verified; ready for controller review.

## Delivered

- Added `graphTypes.ts` shared client contract, in-memory `GraphSession`, graph kind labels, per-view viewport memory and Chinese `GRAPH_*` error mapping.
- Added deterministic bounded graph projection: root/category/subcategory/file nodes, stable positions, 200-node canvas cap, 50-file expansion, 20-neighbour relation view, search result preservation, relation filtering and focus visibility handling.
- Added lazy Cytoscape canvas with bundled `cytoscape@3.33.1`, preset positioning, node shapes/labels/colour, directional relation arrows, suggested dashed edges, focused node styling, category expand/collapse, fit/zoom/reset controls, ResizeObserver disposal and viewport preservation. Accessible file and relation lists provide equivalent actions.
- Added Knowledge Graph page with local-only intro, summary/index state, category overview and file relation modes, search/category/relation filters, evidence-first candidate confirmation/dismissal, directional manual links, manual deletion, verified preview drawer, local analysis consent/selection/progress/cancel/error display, index management and reviewable clear confirmation. Unavailable zero-count indexes remain clearable; manual relations are preserved by backend contract.
- Added sidebar navigation, App-owned memory session, workspace reset/race cancellation, lazy graph route and heading focus callback, library-to-graph and graph-to-library entry navigation, reusable `LibraryDrawer` footer/content hooks.

## Verification

- `npm test -- --run`: 26 test files, 221 tests passed.
- `npm run build`: Vite production build passed; Cytoscape is emitted as a local bundle chunk, with no runtime CDN.
- Added projection, graph API DELETE/CSRF, canvas lifecycle, Knowledge Graph interaction/race/error/job tests, navigation and library integration tests.

## Browser QA handoff

Parent task will perform real browser QA against the local service. Pay attention to CSP canvas rendering, category-node click expansion/collapse, graph edge evidence drawer, per-mode viewport restoration, drawer focus restoration, narrow-screen stacking and the index-unavailable clear flow.

## Known limitations

- The UI relies on the existing local preview drawer for decoded previews; no archive paths or remote image URLs are exposed to the browser.
- The list remains authoritative when the 200-node canvas cap is reached; category/file counts may exceed visible canvas nodes.
- Canvas layout uses deterministic preset positions rather than an animated force layout to preserve selection and viewport stability.

## Review round 1 follow-up

- Routed relation list selection, evidence opening, and canvas edge activation through the same viewport-aware mode transition; added a regression proving a direct evidence action restores the saved relation viewport and retains the category viewport independently.
- Expanded each accessible relationship button name to include source, relation label, and target.
- Kept canvas labels at the 13px base size by enforcing a 1.0 minimum zoom. Initial fit, mode fit, fit-to-content and reset share the readable-fit helper; larger graphs remain pannable and node density is intentionally not auto-shrunk below readable labels.
- Moved analysis and index-management panels before the long file/relationship lists in document order, and focus/scroll their heading when opened.
- Follow-up verification: 5 test files, 50 tests passed; `npm run build` passed. The viewport regression was briefly run with the central transition bypassed and failed with category viewport (zoom 1.4, pan 900/800) instead of the saved relation viewport (zoom 1.1, pan 50/60), then passed with the fix.
