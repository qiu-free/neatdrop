# Workflow implementation report

Status: workflow implementation and regression fixes complete; the parent task should recheck the rebuilt responsive UI.

Hook contract is stable for integration/build: it exposes `refreshConfig()` for
settings saves, `reviewed`/approval methods, bounded `setSelected`, partial `job`
progress, and `execution`/`checkExecution()`.

Root review follow-ups are incorporated: unapproved review-required files leave the
batch and cannot be bulk-selected; approval of a manual untouched file creates a
default editable entry; disconnected analysis resumes by polling the same job;
stage controls lock while work is active; closing a fresh plan returns to review.

The workflow hook will expose `reviewed`, `approve`, `approveOrdinary`, bounded
`setSelected`, `execution`, and `checkExecution` alongside its current actions.
`Workbench` will accept optional `onTutorial` and `onHistory` callbacks. The
execution status contract is being added to `types.ts`; the hook will read the
parent-owned `GET /workspaces/{id}/executions/{plan_id}` endpoint after sending one
execute request, including after a connection failure.

Integration contract: `execution` is `ExecutionSnapshot | null`, matching the
parent-provided status shape: `plan_id`, `status` (`planned`, `running`,
`completed`, `partial`, or `interrupted`), `processed`, `total`, `current_file`,
`items`, `error`, and optional `transaction`. `checkExecution()` performs a
status-only GET for the current plan; `execute()` sends at most one POST for that
plan and then follows the snapshot. Root will wire `onTutorial` from `App`.

Implemented the four-step choose/analyze/review/results workbench with an empty
landing, tutorial and history callbacks, a review drawer, batch selection limits,
review gates, filters, bulk classification/unselection, confirmed draft reset,
partial analysis polling/recovery, bound cloud consent, and plan-bound execution
status/results. The hook preserves drafts during stage navigation and clears them
only after confirmation or a new workspace scan.

Validation: `npm test -- --run` passed all 15 frontend test files (53 tests).
`npm run build` passed TypeScript and Vite production bundling. The first build
reported one unused test import; it was removed and the build then passed.

Concern: responsive browser QA is being run by the parent task against the rebuilt
bundle. The execution status route remains a backend integration point.

## Follow-up regression fixes (2026-11-03)

- Prevent a new analysis or failed-item retry while a tracked analysis job remains
  queued or running. The UI leaves resume/cancel controls available, and the hook
  also rejects direct attempts to submit another job.
- Remove failed files and review-required suggestions from the selected batch as
  job results arrive. The pending-review filter and count now exclude individually
  approved files.
- Invalidate an existing plan when `setSelected` changes the selection directly.
- Make the narrow-screen inspector a labelled modal drawer: it receives focus when
  opened, locks background scrolling, traps Tab navigation, closes on Escape,
  restores focus to its trigger, and preserves previous/next focus when navigation
  remounts the inspector. The backdrop is hidden outside the mobile breakpoint.
- Pass `offlineFirst` through `Workbench`; cloud is the default only when the
  preference is explicitly false and a model is configured. Cloud consent remains
  unchecked until the user approves it.
- Poll execution status while the execute request is pending so copying progress
  is visible before the POST returns, and dismiss the plan dialog as soon as
  execution starts. A `planned` snapshot is polled only while the POST remains
  pending; a rejected POST followed by an unchanged plan stops polling. Late POST
  responses cannot replace an authoritative final status.
- Translate known analysis phases to Chinese. Correct the workflow navigation CSS
  so the four steps stay horizontal on desktop and compact on mobile.
- Await preview updates in Inspector tests to remove the remaining async React
  `act(...)` warnings.

The parent reported that the local analyze, batch approval, two-file copy and
trusted-undo flow passed. The desktop stepper screenshot exposed the global `nav`
column-style override; the latest build includes an explicit horizontal stepper
rule for a final responsive browser recheck.

Follow-up validation: `npm test -- --run` passed all 15 frontend test files (76
tests) without React `act(...)` warnings. `npm run build` passed TypeScript and
Vite production bundling.
