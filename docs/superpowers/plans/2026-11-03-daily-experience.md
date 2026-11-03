# NeatDrop 日常使用体验完善计划

Confirmed plan recovered from the user message in the NeatDrop chat, 2026-11-03.
Implement in the existing React/FastAPI project. Keep forest green/light visuals,
copy only, original preservation and trusted withdrawal. No recursive scans,
deletion, watchers, deduplication or new file formats.

## Tasks and acceptance

- [x] Workflow state and progress: incremental analysis with current file/stage,
  cancellation preserving completed results, read-only per-plan execution snapshots,
  no automatic repeat POST after disconnect; synchronous execution remains compatible.
- [x] Main workflow: focused initial directory/tutorial state; explicit empty selection;
  choose -> analyze -> review -> results; visible-only bounded selection (50/200MiB),
  unreviewed/review/failed/selected filters, bulk classification and ordinary approval,
  individual approval for review-required/manual entries. Edits/reanalysis invalidate
  approval and plans; back navigation retains memory drafts; destructive draft reset
  requires confirmation. Responsive closable inspector and accessible modal focus.
- [x] Secure visual settings: Windows user DPAPI, versioned atomic private storage
  separate from receipts; no plaintext fallback or key disclosure. Environment fields
  override and lock UI. Key bound to endpoint, keep/replace/remove. Static save only.
  Public HTTPS; resolve and reject all non-public DNS results; pin connections while
  preserving hostname TLS. No redirects/proxies. Explicit paid-possible fixed-text
  connection test. Config snapshot per cloud job; consent bound to endpoint/version.
- [x] Tutorial/preferences: skippable/replayable four-step tour, six-task in-memory
  exercise with persistent practice marker and no real/cloud API requests. Searchable
  illustrated local help. Whitelisted versioned density/offline preference/tutorial
  progress only in browser storage; storage failures tolerated. No file data persisted.
- [x] Integration: regression and failure cases, offline/manual copy and trusted undo
  with source hashes unchanged; responsive/keyboard/focus/reduced-motion QA at
  1440x900,1280x800,390x844; full tests/build and documentation. No paid API required.

## Implementation ledger

No Git repository exists; work in the explicitly requested directory. Independent
ownership boundaries permit parallel domain work under dispatching-parallel-agents.
Root integrates App, execution progress, documentation, regression and browser QA.
Backend agent owns configuration/model/analysis/app; workflow agent owns workspace
hook/table/inspector/workbench/types/styles; learning agent owns help/tutorial/
preferences/settings UI/sidebar and isolated CSS. App is root-owned.

Interfaces: config API /model-config (GET/POST), /model-config/clear-key (POST),
/model-config/test (POST); app config.model includes endpoint/config_version.
Cloud JobBody adds optional config_version and endpoint for bound consent (required
for UI calls; legacy callers remain compatible). Execution status GET
/workspaces/{id}/executions/{plan_id} returns status, processed,total,current_file,
items,error and optional transaction. Root adds route after backend changes settle.

Progress 2026-11-03: baseline 110 backend / 12 frontend passed outside Windows
sandbox. Execution progress: four regression cases reproduced failing, implemented
read-only deep snapshots independent of journal writes, then 35 execution tests
passed. API isolation test reproduced missing route; backend agent adding route.
App first-run/practice and density integration tests reproduced missing behaviors;
integration underway. Full help instructions added in docs/daily-use.md.

Ruling: no separate Git worktree or branch — directory is not a Git checkout and
user explicitly requested in-place development. No Git initialization/commit.
Ruling: separate independent file owners in parallel — no shared file mutation;
root performs integration after agreed optional interfaces stabilize.

Final verification: 144 backend tests, 76 frontend tests, TypeScript and production
build passed. Independent domain and integration reviews resolved analysis resume,
approval gates, blocked settings reads, tutorial selection, actual concurrent execute
polling, claim/publication race, config token HMAC and multicast DNS findings.
Browser: six-step exercise zero requests; actual local analysis3+failure1, two-file
copy and trusted undo; manual edit/review/copy/undo one file; all5 original hashes
unchanged,3 withdrawn copies. 1440x900/1280x800/390x844 no page horizontal overflow;
mobile drawer focus/Escape/scroll lock and in-viewport geometry checked. Removed
parent workspace reveal transform after browser reproduction of fixed-drawer clipping.
Browser storage contains only white-listed preferences/tutorial completion after
refresh, no files/drafts. Settings save made only local config requests. No paid
provider request made. Service running http://127.0.0.1:8765 with final backend.
