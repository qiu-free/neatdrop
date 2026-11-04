# v6 backend delivery report

Scope: Task 1, trusted archive library listing and preview. Backend files only.

## Behavior

- `GET /api/v1/workspaces/{id}/library` returns relative archive metadata, stable opaque SHA-256 entry IDs, taxonomy keys, availability and `truncated`. It sorts all eligible records newest first before applying the 1000-entry response cap. Existing 500-transaction, journal byte/event and receipt byte limits remain in force.
- `GET /api/v1/workspaces/{id}/library/{entry_id}/preview` resolves the ID from validated persistent records in the session-granted workspace. It returns the existing preview JSON. Unknown/withdrawn IDs return 404; missing, changed or unverified archives fail closed with a 409 safety code.
- Copies remain visible after constructing a fresh workspace/executor for the same directory. Withdrawn entries are omitted, and a later forged completed event cannot revive an entry whose journal already marks it withdrawn.
- Same-size content edits may remain `available` in the lightweight list; mandatory hash verification rejects them when a preview is requested.

## Security reasoning and self-review

`Journal.read` applies `records.validate_plan` before any log fields are used: allowed target folders, safe leaf names, source IDs, plan digest and hash-chain validation all remain in place. Library event reduction additionally verifies immutable item fields, transaction ID, pending withdrawal and terminal withdrawal. A complete transaction is materialized before yielding so invalid later events cannot expose partially validated paths.

`TrustStore.load` must match the installation-local receipt's complete plan and workspace root identity. A matching per-file copy identity is required. Valid hash-chained logs alone are only unverified metadata: they never trigger a target stat or content read. No API accepts a target path; query-string paths cannot affect resolution. Category keys come from the server taxonomy and the validated relative target.

The list uses stat identity, file kind and size only. Preview rechecks receipt/journal state, then `prepare_input(expected_identity=...)` opens one locked no-follow read handle, checks regular-file kind, copy identity and exact expected size before reading at most `MAX_FILE + 1` bytes, verifies size/mtime/identity after reading, and hashes those same bytes. The existing safe decoder consumes those bytes without reopening the path. The global two-parser admission budget, root identity protection, Windows ancestor/destination pins, image limits, PDF parser limits and safe UTF-8 handling remain shared with existing previews.

No dependency, network request, recursive directory scan, client path input or deletion operation was added. Originals remain unchanged in real copy/preview/undo tests. The backend is frozen for controller review after this delivery commit.

## Verification

1. Initial sandbox command: `.venv/Scripts/python.exe -m pytest backend/tests/test_library_v6.py -q --tb=short` could not access the existing pytest temporary/cache directories (`WinError 5`). Reran with approved elevated test access.
2. Expected RED before implementation: same command returned **23 failed**. Failures were missing `Executor.library`/`library_preview` methods and the unregistered library endpoint (404).
3. First GREEN: same command returned **22 passed, 1 skipped in 8.75s**.
4. Additional terminal-withdrawal regression failed as expected: **1 failed, 25 passed, 1 skipped in 12.33s** because a forged completed event could restore an already withdrawn item to the list. Added the terminal-state check.
5. Final targeted regression command:

   ```text
   .venv/Scripts/python.exe -m pytest backend/tests/test_library_v6.py backend/tests/test_analysis.py backend/tests/test_hardening.py backend/tests/test_executor.py backend/tests/test_api.py backend/tests/test_parsing_security.py -q --tb=short
   109 passed, 1 skipped in 20.96s
   ```

   The single skip is creating a file symlink without local Windows privileges. Directory replacement, same-bytes leaf replacement, same-size hash changes, oversized files, missing files, target-directory rejection, forged/mismatched/absent receipts, unverified target-stat denial, parser admission, parent pinning, source preservation, session isolation, safe text/image decoding, stable IDs/reopening, response cap/sorting and real withdrawal all ran successfully.
6. `git diff --check -- backend`: exit 0; only repository line-ending conversion notices.

The controller will independently run the complete backend suite and cross-layer browser acceptance. No known remaining backend issue from this scope.
