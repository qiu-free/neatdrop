# v6 workspace implementation report

Task 2 implements selected-file approval and an on-demand right sidebar. `Workbench` accepts `active?: boolean` (default true) and `onLibrary?: () => void`; finished execution offers a library entry.

## Behavior

- One-click approval includes only selected supported files with a suggestion or explicit manual edit and no unresolved per-file error. Review-required candidates are eligible; the UI explicitly confirms current classification/name, including selected files outside a filter. The count excludes previously reviewed items, and skipped items are explained.
- Untouched files cannot silently become `other`. Individual approval follows the same eligibility rules. Edits and reanalysis invalidate review and plans; selection changes invalidate plans and preserve existing per-file approvals.
- Details begin closed at every viewport. File click opens a right sidebar; checkboxes affect only the batch. The portal carries `app-shell` for existing typography/theme, inerts the background, locks scrolling, handles Escape/backdrop/close, traps Tab around visible enabled controls, and restores trigger focus when closing. `active=false` and results close the sidebar.
- Inspector stays mounted after its first visit, preserving bounded in-memory caching and fixed preview geometry while switching files. Preview requests are disabled/aborted while closed. Existing shared two-request budget remains unchanged.
- Bulk classification and reanalysis live inside a closed “更多操作”. Final PlanDialog independent checkbox is preserved.

## TDD evidence

Initial focused command: `npm test -- --run src/useWorkspace.test.ts src/components/Workbench.test.tsx src/components/Inspector.test.tsx src/components/FileTable.test.tsx`.

Before implementation: **14 failures / 51 passes**, including untouched-file fallback, absent `approveSelected`, checkbox-driven activation, initially mounted details, absent desktop dialog/close behavior, and missing library entry. Sandbox run initially failed with Vite `spawn EPERM`; rerun outside sandbox produced those expected assertions.

After implementation: first focused regression run was **90 passes / 1 failure**. The failure was a jsdom closed-details role query; corrected the expectation to assert visibility, since the control remains in the DOM inside native closed details.

Fresh final command: `npm test -- --run src/useWorkspace.test.ts src/components/Workbench.test.tsx src/components/Inspector.test.tsx src/components/FileTable.test.tsx src/components/FileGrid.test.tsx src/components/Workflow.test.tsx src/previewRequests.test.tsx`.

Final result at 2026-11-04 11:17:43: **7 test files passed, 101 tests passed**, exit 0. Existing Workflow checkbox expectation was deliberately updated to the new selection-only behavior. Coverage includes no document preview request before first click, drawer desktop/mobile semantics, focus return/body lock/inert, retained shell/cache, selection and candidate approval, invalidation, stale preview responses, thumbnail lazy loading, and preview request concurrency. `git diff --check` passed.

## Integration status / limitations

An early full suite was run during parallel library implementation: **151 passes / 8 failures**. Seven were the library's active stub; one was the old Workflow checkbox expectation, since updated and passing. An early build found only App.test.tsx `ByRoleOptions.exact` type errors in the other agent's files. Controller will rerun complete suite/build after all owners finish.

Rendered desktop/mobile screenshots and real synthetic analysis→copy→library→undo QA are delegated to controller Task 4 as planned. This subtask has no screenshot/real-backend claim. The listed Browser plugin is absent (ego-browser is the available browser route); no fallback was invoked here. No dependencies added, no backend/source-copy execution logic changed.
