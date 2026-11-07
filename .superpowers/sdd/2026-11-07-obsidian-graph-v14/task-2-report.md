# Task 2 report: canvas hierarchy, 2D/3D and interaction

## Changes

- `GraphCanvas` accepts optional `visual`, `dimension` (default `2d`), and `layoutRevision` props. Structural topology and force parameters control the bounded force pass. Color, width, focus, hover, and evidence changes retain layout. Force parameter changes and explicit revisions ignore prior anchors; filtering and expansion reuse up to 400 per-view anchors with preserved z.
- 2D uses a flat projection and background pan; 3D uses depth, background rotation, and Shift-pan. Arrows pan in 2D and rotate in 3D. Switching dimensions cancels active gestures and fits the new mode when viewport is null. Camera persistence belongs to the parent session.
- Degree diameters use the projection's `size` (7–22px) and a minimum 24px hit circle; neutral gray remains stable across depth, with optional category colors. Status reports hovered or selected filename, category, and unique-neighbor count. No node text is rendered. Directed arrows appear on focused edges or by explicit visual setting. Suggested status alone causes dashes; every relation keeps its own curved hit path and evidence callback.
- Ordinary wheel zoom requires SVG focus; Ctrl/Meta-wheel remains available. Touch starts as native page scrolling. `操作图谱` toggles deliberate touch capture and pinch zoom. Blur, cancellation, release outside SVG, and mode switches end gestures. Lower-right control positioning and touch toggle presentation are handled by Task 3 CSS.

## RED / GREEN

- Initial focused test run in sandbox hit Vite `spawn EPERM`. Re-ran with `require_escalated` and observed six expected missing-behavior failures: 2D pan, 2D badge/projection, degree size, arrows/status, SVG-focused wheel, and stale camera expectations.
- Added a dimension switching regression: RED showed an unnecessary layout pass (`onPositions` 2 versus expected 1); GREEN after splitting the mode camera effect from structural layout.
- Added outside-SVG pinch release regression: RED showed a third viewport update from stale touch state; GREEN after window pointer end clears the touch map and pinch state.
- The final focused command `npm test -- --run src/components/GraphCanvas.test.tsx src/components/KnowledgeGraphKeyboard.test.tsx src/graph3d.test.ts` passed: 3 files, 32 tests. `npm run build` passed (TypeScript and Vite). `git diff --check` exited 0 with only Git's LF/CRLF notices.

## Self review

- Reviewed mode cancellation and stale viewport behavior, pointer capture release, keyboard focus and click suppression, all parallel evidence entries, suggested versus confirmed automatic edges, node diameter and hit area, and layout anchoring. Existing file and edge callbacks and accessibility roles remain.
- CSS remains owned by Task 3. The canvas provides `.graph-touch-toggle`, `.is-operating`, and `.is-suggested`; it also sets inline edge width and dash style so legacy automatic-origin CSS cannot turn confirmed edges dashed. Task 3 will position compact controls at lower-right and the touch toggle visibly at top-left.
- Tests verify DOM and callback behavior. Browser layout and gesture QA remains for the integrated Task 3 pass.
