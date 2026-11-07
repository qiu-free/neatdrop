# Obsidian-inspired NeatDrop Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver the approved natural clustered graph in NeatDrop's warm white, light mint and ink palette, with a larger canvas and stable two-dimensional browsing.

**Architecture:** Keep trusted graph records and SVG rendering. Add a deterministic bounded force layout beside the existing branch fallback, session-owned visual settings, and separate two/three-dimensional cameras. A floating settings component contains display controls while existing explicit analysis and evidence flows remain intact.

**Tech Stack:** React 19, TypeScript, SVG, Vitest, existing local Vite bundle. No new runtime dependency.

**Spec:** `docs/v14-obsidian-graph-redesign-2026-11-07.md`, approved by the user's instruction to begin development with the project palette.

## Global Constraints

- Use the existing warm white / light mint / dark ink project tokens. No dark graph canvas, online assets, fonts, CDN or CSP relaxation.
- Only genuine file nodes and genuine relations. Preserve every relation record and its evidence, status and direction. Parallel edges do not inflate node degree or layout attraction.
- No text underneath graph nodes. Identity appears in hover/selection status and the existing preview drawer. Node hit targets are at least 24px.
- Default is 2D with empty-canvas pan. Optional 3D rotates; separate cameras restore on mode changes. Preview, hover and selection never trigger whole-graph layout.
- Retain 200 visible-node cap, 20 direct local neighbors, complete accessible file/relation lists, explicit local analysis consent/limits and index management.
- Saved positions survive filter round trips, capped at 400 per view. No graph/file content persisted in browser storage. Visual controls never start content analysis.
- Use a failing meaningful behavior test before changing behavior; verify each task and commit locally. Do not push or publish.
- Work in the requested checkout on `feat/obsidian-graph-v14`; user has approved direct implementation there.

### Task 1: Graph settings, topology and bounded natural layout

**Files:** Create `frontend/src/graphSettings.ts`, `graphSettings.test.ts`, `graphForceLayout.ts`, `graphForceLayout.test.ts`. Modify `graphTypes.ts`, `graphTypes.test.ts`, `graphProjection.ts`, `graphProjection.test.ts`. Keep `graphLayout.ts` and its fallback tests intact.

**Interfaces:**

```ts
export type GraphDimension = '2d' | '3d' // graphTypes.ts
// graphSettings.ts
export interface GraphForceSettings { center: number; repulsion: number; attraction: number; linkDistance: number }
export interface GraphVisualSettings {
  colorMode: 'neutral' | 'category'; showIsolates: boolean; showSuggested: boolean;
  nodeScale: number; edgeOpacity: number; edgeWidth: number; showDirections: boolean;
  layoutPreset: 'compact' | 'balanced' | 'spacious'; layout: GraphForceSettings
}
export const defaultGraphVisualSettings: GraphVisualSettings
export function normalizeGraphVisualSettings(value?: Partial<GraphVisualSettings>): GraphVisualSettings
export function graphLayoutPreset(preset: GraphVisualSettings['layoutPreset']): GraphForceSettings
// graphForceLayout.ts: same immutable GraphNode[] result contract as fallback
export function forceLayoutGraph(nodes: GraphNode[], edges: GraphEdge[], saved?: Record<string, GraphPosition>, settings?: GraphForceSettings): GraphNode[]
// graphTypes.ts
export function transitionGraphDimension(session: GraphSession, next: GraphDimension): GraphViewport | null
```

Session adds optional `dimension`, `visual`, and per-view/per-dimension camera cache; existing constructors and view transition remain backwards compatible. `GraphCanvas` later consumes settings plus `dimension` and a numeric `layoutRevision` prop. Projection adds `data.categoryLabel` and computes degree/size after the visible edge set is known. `visual.showSuggested` filters suggested edges; `showIsolates` filters canvas nodes while the full filtered file list remains available.

- [ ] Write red tests for unique visible neighbors with parallel edges; degree-driven sizes; suggestion/isolate visibility retaining full file lists; settings clamps and presets; independent view/dimension camera round trips. Example invariant:

```ts
expect(new Set(result.edges.map(e => e.data.relation))).toEqual(new Set(realIds))
expect(result.nodes.find(n => n.data.entry === 'hub')?.data.degree).toBe(3)
expect(result.nodes.find(n => n.data.entry === 'hub')?.data.size).toBeGreaterThan(result.nodes.find(n => n.data.entry === 'leaf')!.data.size!)
```

- [ ] Run the new focused tests and record actual expected failures before implementation.
- [ ] Implement normalized defaults (neutral colors, isolates/suggestions on, nodeScale/edgeWidth 1, edgeOpacity .55, arrows off, balanced layout). Use sensible bounded parameter ranges, preserving values on unrelated edits. Preserve independent cameras for categories/relations and 2D/3D.
- [ ] Implement deterministic topology-based seeds and bounded force iterations: unique undirected neighbors, repulsion, weak centering, link attraction, degree-aware collision padding and disconnected groups at the perimeter. Sort inputs for deterministic results; never invent nodes or edges. Keep all saved nodes exactly anchored; place only new nodes near saved neighbors on expansion. No continuous animation/loop after return. Retain branch layout as finite-result fallback.
- [ ] Add tests for connected three-hub network with bridge edges, star/chain/ring/isolates, deterministic permutation invariance, minimum separation, exact anchors after filtering, incremental expansion, finite 200-node dense/tree/ring output and bounded execution. Do not assert arbitrary force graphs have zero crossings.
- [ ] Run `npm test -- --run src/graphSettings.test.ts src/graphForceLayout.test.ts src/graphTypes.test.ts src/graphProjection.test.ts src/graphLayout.test.ts` and `npm run build`; fix and commit `feat(graph): add stable natural clusters and visual settings`.

### Task 2: Canvas hierarchy, 2D/3D and stable interaction

**Files:** Modify `frontend/src/components/GraphCanvas.tsx`, `GraphCanvas.test.tsx`; optional focused pure helper and test file if edge geometry warrants it. CSS is completed in Task 3.

**Interfaces:** Consume Task 1 functions and types. Add optional `visual?: GraphVisualSettings`, `dimension?: GraphDimension` (default `2d`), `layoutRevision?: number` (default `0`) to existing canvas props. Keep every existing prop compatible. Parent performs camera transitions and passes a new viewport or null. An explicit layout revision ignores saved x/y and recomputes; selection and display-only settings do not.

- [ ] Write red tests for default 2D background pan, opt-in 3D rotation, 2D projection without depth, hover identity/category/unique-neighbor count, meaningful differing node sizes and stable colors across rotation, hidden node labels, default arrows off and selectable directed evidence. Add focus-wheel capture and inactive ordinary-wheel page scrolling tests; keep pointer-cancel, stale viewport, SVG keyboard focus and click suppression coverage.
- [ ] Run focused tests and record expected missing-behavior failures.
- [ ] Use `forceLayoutGraph` by structural/layout key. Layout parameters and explicit rearrange run bounded layout; pure appearance, focus, hover and evidence updates do not. Saved anchors survive filtering and expansion. Preserve real z in the cache; use z0 and rotation0 for 2D projection/drag only. When viewport becomes null after a mode change, fit that mode. Cancel active gestures when modes change.
- [ ] In 2D pan by background drag and arrows, in 3D rotate by background drag/arrows and Shift-pan. Zoom at pointer after the SVG itself has explicit focus; Ctrl/Meta-wheel remains available. Mobile starts with native vertical scrolling; a visible `操作图谱` / `退出操作` toggle permits deliberate touch capture and touch-action none only while active. Support touch pinch while operating if feasible within existing pointer model; provide zoom buttons regardless. Blur/cancel must release captures cleanly.
- [ ] Draw logarithmic degree-based diameter from projection (ordinary 7–9px, medium 10–14px, hubs up to22px), with at least24px hit circles. Gray depth-independent dots by connectivity; optional category colors and mint focus ring. Keep curved hit paths, suggested dashed styling, all individual evidence entries. No SVG node text. Status shows hovered or selected filename, classification and neighbor count. Default direction arrows hidden, show for focused directed edges or explicit setting.
- [ ] Move compact zoom/fit/reset controls to lower-right, provide accurate mode-specific hints and mode badge. Preserve all existing semantic roles and file→drawer/edge→evidence callbacks.
- [ ] Run `npm test -- --run src/components/GraphCanvas.test.tsx src/components/KnowledgeGraphKeyboard.test.tsx src/graph3d.test.ts` and `npm run build`; fix and commit `feat(graph): add stable 2d browsing and optional 3d exploration`.

### Task 3: Large themed canvas and floating settings integration

**Files:** Create `frontend/src/components/GraphSettingsPanel.tsx` and meaningful interaction tests. Modify `KnowledgeGraphPage.tsx`, its tests, `KnowledgeGraphKeyboard.test.tsx` when necessary, `graph.css`, and only graph-scoped overrides in `theme.css`.

**Interfaces:** Consume Task 1 session/settings helpers and Task 2 props. Panel is controlled by page; receives current filters/visual/dimension/groups and callbacks. Factor header/body/footer as needed rather than duplicating existing analysis/evidence implementations. All settings use React state plus existing session memory. `layoutRevision` increments for explicit rearrange and reset only; editing force settings already changes canvas layout key.

- [ ] Write red tests for settings initially closed, opening/closing with Escape and focus restoration, preview closes settings, display edits update canvas props without requests, independent 2D/3D camera transitions, reversible expanded canvas with Escape, and accessible expandable file/relation lists. Update existing tests to open the settings section before interacting with moved controls; retain assertions for consent, cancellation, index reset, relation mutations, evidence abort and taxonomy.
- [ ] Run focused tests and record actual failures.
- [ ] Implement compact page intro and full-width graph: toolbar global/local, filename search, visible counts, analysis, settings, expand. Move search from aside to toolbar; do not duplicate accessible search labels. Keep explicit refresh/index actions. Replace permanent aside with a ~280px floating panel at top-right, four native folding sections `筛选`, `颜色组`, `外观`, `布局`. Filters include category, kind, isolates, candidates; category group toggles and subgroup continuation remain accessible. Appearance includes neutral/category, node size, edge opacity/width, arrows, 2D/3D; layout has compact/balanced/spacious, advanced four force sliders, rearrange/reset.
- [ ] Keep analysis and index management outside visual settings. Manage-index trigger may be a toolbar secondary action. Opening preview/evidence closes settings, and panel close returns focus to its trigger. Panel permits keyboard traversal, Escape and close button. Expanded canvas uses a reversible local fixed viewport mode, Escape exits, and does not escape browser security/fullscreen requirements. Avoid conflicts with preview Escape.
- [ ] Retain full files/relations in native `<details>` below canvas; open by default is acceptable for backwards compatible access, users can collapse. Do not remove analysis progress, issue notices, empty/error states, library links or manual relation form.
- [ ] Implement graph-scoped warm-white token styles: canvas desktop height `clamp(520px, calc(100dvh - 220px), 820px)`, neutral gray links/dots, pale mint selected controls, readable text. Floating panel has bounded scrolling; mobile panel becomes a bottom sheet. Mobile toolbar wraps without overflow, canvas retains usable height, active touch interaction is reversible. Use reduced-motion CSS for short fades/transitions. No decorative assets or broad changes outside graph.
- [ ] Run focused page/panel/keyboard tests, then the full frontend suite and build. Review React effects/memoization against the existing React best-practices skill. Commit `feat(graph): expand canvas and integrate themed graph controls`.

### Task 4: Browser acceptance and final review

**Files:** Only targeted fixes and corresponding regression tests if evidence reveals defects. Browser scripts/screenshots stay outside tracked source. Synthetic fixture lives in ignored `.cache/v14-*` and must be created through actual trusted archive/executor receipts.

- [ ] Use the Ego browser skill and a fresh single task space at `http://127.0.0.1:8765/`. Preserve user data; create one isolated synthetic three-hub graph with bridge edges for QA, retain existing24-file/21-relation and1000-file scale fixtures.
- [ ] Verify desktop1440×1000 and mobile390×844: app identity/nonblank/no overlay, console/CSP health, natural clustered topology, node hierarchy/no labels/curves, hover, 2D pan, focus zoom, 3D and2D restoration, settings/preview mutual exclusion, Escape/focus, expand/exit, filters round trip, ordinary mobile scrolling/operation toggle and no horizontal overflow. Verify the200-node cap and complete1000-file list with scale fixture.
- [ ] Capture final desktop and mobile screenshots outside repo. Make only evidence-driven fixes, with regression tests and relevant checks; avoid repeating passing suites unnecessarily.
- [ ] Dispatch a whole-branch reviewer with approved spec, plan, full diff and test/browser evidence. Address Critical/Important findings, run covering checks, and complete scoped re-review.
- [ ] Commit final targeted fixes, retain the running preview and local feature branch. Report URL, visible changes, verified tests/interactions, evidence and any material limitations in Chinese.
