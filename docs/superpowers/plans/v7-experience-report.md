# v7 frontend experience delivery

Task 3 implemented on `feat/offline-formats-onboarding-v7` from the supplied v6 baseline. Existing v6 readable theme and right drawer behavior are retained; no dependencies were added and no service was restarted.

## Workflow and learning

- `workflow.ts` provides six shared stages for live navigation, tour, practice and help: choose, analyze, review, plan/copy, library, history/undo. Workbench now shows one six-stage navigation instead of a duplicate four-stage strip.
- The tour supports back/skip/replay; only its explicit final actions mark completion. Preference schema 2 is written to the existing whitelisted preference key. v1 `tourCompleted` cannot distinguish a historical skip from completion, so it migrates to `legacy-dismissed` without claiming completion or forcing a repeat. File content, paths, filters and analysis data are never persisted.
- Practice uses two fixed synthetic examples in React state, with actual text preview beside independent selection. It calls no API, model, filesystem or file picker. It demonstrates candidate evidence, one-click approval including selected candidates, invalidation on category changes, a generated source/destination plan, independent copy checkbox, library preview and history withdrawal. Practice directories are derived from the generated taxonomy snapshot. Returning to edit resets the copy confirmation.
- Completion is emitted once after simulated undo. Simulation explains that original files remain in the source directory and withdrawn copies would remain in `.neatdrop/withdrawn` using disk space. It never performs that operation.

## Navigation and async work

- App mounts only the current page; inactive workbench/library components cannot keep preview effects running or leave drawer scroll locks/inert state active. The existing `useWorkspace` stays mounted to keep in-memory selected files, suggestions, edits, analysis and execution state.
- A single App-owned session ref retains workbench path (including an unsubmitted path after a scan), stage, search, filter, grid/list preference, bulk category and internal list scroll, plus help search, library search/category and per-page window scroll. It is discarded on refresh. Page changes focus the destination heading after old drawer cleanup.
- Page/stage arrival uses 180ms opacity/transform; drawers use 160ms. Stage animation cancels on rapid change, has no transition timer controlling state and honors reduced-motion preferences. Existing preview identity/abort protection remains, and directory picker requests are aborted on unmount.

## New format UI

- Optional `config.supported_extensions` drives the visible supported-format list. Older services without the capability retain the original seven format claims. Help documents DOCX/PPTX/XLSX/UTF-8 CSV extraction and formula-cache/macro/external-resource limits, and accurately lists old Office/scanned PDF/HEIC/GIF as unsupported.
- Friendly Office/CSV/worker error messages explain a recovery action and preserve the original. Preview sampling metadata is typed and shown; evidence positions include slide, sheet/cell/row, paragraph/table as well as existing PDF/image/text locations. Library previews use the same fixed 280px surface and show sampling summaries.
- Regenerated `taxonomy.generated.json` from current backend taxonomy using `scripts/generate_taxonomy.py` as requested.

## Verification

Red phase was observed against the old implementation: eight failing onboarding/preference/page-unmount tests, two failing Office help/evidence tests, and parser error tests failing with raw enum fallbacks. A later full-App test caught unsent path replacement on workbench remount and passed after tracking the scanned workspace identity.

Fresh scoped validation: **14 test files, 154 tests passed**. Files cover FirstRunTour, TutorialExercise, TutorialPractice, preferences, App, API, HelpPage, Inspector, Workbench, LibraryPage, Workflow, SettingsDialog, previewRequests and FileGrid. The App integration test exercises 20 rapid navigation changes and loaded workspace navigation with open workbench/library drawers, abort signals, overflow/inert cleanup, heading focus, selected draft, stage/search/list scroll/library filters and unsubmitted path retention. Exercises assert no network call and review/copy gating. A targeted red/green test also preserves busy-stage navigation disabling while allowing library/history page changes.

Fresh `npm run build`: TypeScript and Vite production build passed (1604 modules, no build warning). Windows sandbox initially blocked Vite subprocess creation with `spawn EPERM`; reruns used the approved escalated test/build commands.

Browser screenshots, measured animation durations/responsive overflow, full project test suites, true-ASGI format flow and five-person newcomer trial are delegated to root integration. **Human newcomer trial is unverified**; automated results are not a substitute and no usability completion rate is claimed.

## P2-5 review repair: delayed library scroll

Independent review identified that a library loading placeholder can clamp an early window scroll restoration to 0. Root reproduced this in a real 1440×1024 browser with 30 synthetic records and a 400ms delayed response: saved 1600px, restored 0px. The previous spy-only scroll assertion could not detect that browser behavior.

App now retains a pending saved position until the current workspace's LibraryContent reports its loaded list (or final error) committed via a layout effect. No timer or hidden mounted page is used. The loading view starts at the top and restores the old offset only when final content provides its real height. Wheel, touch movement, scroll keys, pointer interaction and input/change cancel the pending restoration; navigation preserves an untouched pending offset and cancels the old listeners. Restoration/cancellation/navigation/unmount remove all pending listeners. New workspace identity clears library/history saved positions. Obsolete fetch responses remain aborted/ignored.

Red/green evidence: a new test derives document height from the actual rendered synthetic list and models scrollTo clamping; the old implementation failed with actual scrollY=0 instead of 1600. It now passes. Added coverage includes repeated restoration, leaving before completion then returning, obsolete responses, wheel/touch/keyboard/filter intent and listener removal after completion. Fresh scoped verification: **6 files, 58 tests passed**; fresh `npm run build` passed (TypeScript and Vite, 1604 modules). Root retains actual-browser remeasurement and final full-suite verification; five-person newcomer trial remains unverified.
