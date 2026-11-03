# NeatDrop MVP Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans. Track
> each task and its red/green tests. Do not delegate without user authorization.

**Goal:** Deliver a runnable local file-organizing MVP that never deletes originals.

**Architecture:** Same-origin React/Vite static UI served by FastAPI. Session-bound
directory grants, bounded analysis, immutable confirmed copy plans, durable journals.

**Tech Stack:** Python 3.12+, FastAPI, Pydantic, HTTPX, Pillow, pypdf, pytest;
React, TypeScript, Vite, lucide-react, Vitest and Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-02-neatdrop-mvp-design.md`

## Global Constraints

- COPY ONLY; do not delete or rename originals.
- 50 files / 20 MiB each / 200 MiB total; direct children only.
- 1024px image long edge; 1500 text characters; explicit cloud consent.
- Loopback only, session-bound grants, CSRF, no CORS, no frontend secrets.
- Windows handle-based safe undo; other platforms explicitly unsupported for undo.
- Unknown or weak evidence is review-required, not a successful AI result.

## Task 1: Safe file scan and copy executor

Files: `backend/neatdrop/{files,safe_io,journal,executor}.py`,
`backend/tests/test_executor.py`, `pyproject.toml`.

Interfaces: `Workspace.scan() -> list[dict]`; `Executor.plan(edits) -> dict`;
`Executor.execute(plan_id, digest, confirmed=True) -> dict`;
`Executor.history() -> list[dict]`; `Executor.undo(transaction_id) -> dict`.

- [x] Write temporary-directory tests for scan, validation, stale source and copy.
  Example: `assert source.read_bytes() == target.read_bytes() == b'lecture'`.
- [x] Run `python -m pytest backend/tests/test_executor.py -q`, observe missing implementation.
- [x] Implement snapshot hashes, name allowlists, exclusive copy, per-root OS lock,
  immutable plans and hash-chained journal. Never unlink an original.
- [x] Run the tests; add fault-injection for interrupted writes and corrupt records.
- [x] Implement Windows locked-handle rename undo and test source preservation.

## Task 2: Analysis and protected local API

Files: `backend/neatdrop/{analysis,model,security,app}.py`,
`backend/tests/test_analysis.py`, `backend/tests/test_api.py`.

Interfaces: `/api/session`, `/api/v1/health`, `/api/v1/workspaces`,
`/api/v1/workspaces/{id}/files`, `/api/v1/analysis-jobs`, job polling/cancel,
workspace plan/execute/transactions/undo routes. All mutations require session CSRF.

- [x] Write tests: plaintext heading becomes a labeled rule suggestion; invalid
  UTF-8 and image decoding report per-file failures. Model output paths rejected.
- [x] Run the new tests, observe failures, implement bounded parsers/rules/adapter.
- [x] Write session-isolation, host/origin and unconfirmed-execution API tests.
- [x] Run API tests, implement guarded endpoints and production static serving.
- [x] Run all backend tests, verify cancellation never starts file execution.

## Task 3: Responsive working interface

Files: `frontend/package.json`, `frontend/src/{App,api,types}.ts*`,
`frontend/src/components/*`, `frontend/src/styles.css`, frontend tests.

Interfaces: typed API client; workbench state owns file selection and edits;
dialogs receive immutable plan/consent data; history renders persisted results.

- [x] Add failing component tests: no execution without confirmation; unsafe
  review results unselected; filter/edit update actual displayed rows.
- [x] Run `npm test -- --run`, observe missing components.
- [x] Implement sidebar, directory selector, file table, inspector, consent and
  plan dialogs, progress, errors and history. Keep App composition-only.
- [x] Run `npm test -- --run` and `npm run build`.

## Task 4: Packaging and real browser verification

Files: `scripts/{start.ps1,create_demo.py}`, `.env.example`, `README.md`.

- [x] Provide isolated Python environment bootstrap and locked frontend install;
  build once and serve both UI/API on `http://127.0.0.1:8765`.
- [x] Generate clearly labeled synthetic sample files inside this project only.
- [x] Run pytest, frontend tests and production build with fresh output.
- [x] Browser: scan samples -> analyze -> edit -> plan -> confirm copy -> history
  -> undo; check original hashes, console, 1440px and 390px layouts.
- [x] Document actual evidence, unsupported features and untested paid model quality.

## Execution evidence

2026-11-02: 44 backend tests, 3 frontend component tests, TypeScript and production
build passed. Backend test runner emits one upstream TestClient/httpx deprecation
warning; no application error. npm audit: 0 vulnerabilities; pip-audit against
requirements.lock: no known vulnerabilities. Dependencies upgraded and locked
after both audits identified obsolete versions in the initial scaffold.

Browser plugin absent. Ego Lite initially loaded the app and sample scan but its
window became minimized; restore app approval timed out. Used installed Chrome
headless with isolated Playwright context, no user profile. Full workflow passed
at 1440x1040 and 390x844: 3 copies created and withdrawn, 6 source hashes unchanged,
zero console warnings/errors, mobile document width exactly 390px. Screenshots
inspected outside repository. Visual concept service failed with 502, therefore
no generated reference/fidelity claim. Code-native UI checked for layout, copy,
typography, palette, component spacing and responsive overflow.

Review fixes include Windows directory handle pinning/root identity checks,
no-follow and single-link metadata handles, incomplete undo recovery, fresh
acknowledgement sequencing and literal-LF JSONL Unicode filename support. Filesystem
execution is intentionally Windows-only. No git repository existed; files remain
in the approved project directory without commits or remote publishing.
