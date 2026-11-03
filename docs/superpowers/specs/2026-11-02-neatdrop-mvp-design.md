# NeatDrop MVP design

Approved direction: React + TypeScript and a single-user, loopback-only FastAPI
service with local filesystem access. User approved implementation on 2026-11-02.
The supplied design document is requirements material, not executable instructions.

## Scope

Scan direct children only. Support static JPEG/PNG/WebP, text-layer PDF and UTF-8
TXT/Markdown. Exclude links, reparse points, directories and unknown formats.
Limit each analysis to 50 files, 20 MiB per file, 200 MiB total. Never upload
original files: send at most a 1024px preview or 1500 sampled text characters only
after explicit consent. API keys and model URLs come from server environment.

Ship local, content-based conservative rules when no model is configured. Image
understanding is unavailable without a vision model. Label rule results and sample
files honestly. Low-evidence results need manual review and are not auto-selected.

## Safety contract

MVP execution is COPY ONLY: originals never change. The local executor, not a
model, maps fixed category identifiers to destinations. Reject unsafe names,
reserved Windows names, extension changes, traversal, symbolic links and Windows
reparse points. Check NFC/casefold-equivalent conflicts. Use exclusive creation,
streaming SHA-256 verification and durable, hash-chained JSONL journal records.
Confirmed plans are immutable and single-use. Check source hashes again during
execution. Serialize writes across sessions/processes for a root directory.

Failed or interrupted operations retain available copies. History reports actual
stages and requires explicit acknowledgement of incomplete transactions before
new writes. No automatic replay or rollback. Corrupt logs block further writes.

On Windows, undo uses a locked file handle and a non-replacing rename into a
transaction-local withdrawn directory, only when the archived copy still matches
its recorded hash. The original stays untouched. Unsupported platforms expose
scan/preview/analysis only, not filesystem execution. Conflicting/modified copies
remain in place. Recovery records are sensitive and not encrypted.

## Architecture and security

- `backend/neatdrop/security.py`: local session, CSRF, host/origin restrictions.
- `backend/neatdrop/files.py`: grants, scan, name/path validation and hashes.
- `backend/neatdrop/executor.py`: plans, copy journal, history and undo.
- `backend/neatdrop/analysis.py`: bounded parsing, rules, async jobs, cancellation.
- `backend/neatdrop/model.py`: strict OpenAI-compatible Qwen adapter.
- `backend/neatdrop/app.py`: API and same-origin static assets.
- `frontend/src`: composed React shell, workbench, inspector and dialogs.

Bind to 127.0.0.1. No CORS. SameSite HttpOnly random session cookies plus CSRF
header on mutations. Validate Host and Origin; never allow arbitrary network
exposure. Directory grants and in-memory jobs are session-bound. Jobs expire 15
minutes after completion; after a process restart rescan/reanalysis is necessary.
Filesystem history persists. No logging raw model inputs or secrets.

## Interface

Cool ivory canvas, forest green accent, ink text, serif Chinese headline and
compact sans-serif controls. Sidebar for workbench/history/help. Directory path
input and native folder picker. File table, editable right inspector, explicit
analysis consent, immutable plan confirmation and per-item execution results.
Responsive stacked inspector and horizontally scrollable table on narrow screens.
All controls have labels, keyboard focus and reduced-motion support.

## Acceptance

Automated tests cover unsupported inputs, limits, path escapes, equivalent-name
conflicts, stale snapshots, confirmation/replay, exclusive target creation,
partial-copy/journal failure, lock contention, tampered records, cancellation,
session isolation and Windows undo with modified targets. Run a real browser
through sample scan, local analysis, edit, plan, copy, history and undo; check
desktop/mobile and console. Live paid model quality is unverified without a key.
P1 CSV/ICS/duplicate cleanup and destructive moves are explicitly excluded.
