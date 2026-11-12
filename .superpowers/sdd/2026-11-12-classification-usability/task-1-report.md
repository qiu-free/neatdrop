# Task 1 Report: Personal Classification Rules

## API contract

All request bodies use strict Pydantic models (`extra="forbid"`, strict types). Errors use `{"code":"..."}`. Business errors are HTTP 409; schema errors are HTTP 422 (`INVALID_REQUEST`). Existing session, workspace grant, Host/Origin/CSRF protections remain in force.

- `GET /api/v1/workspaces/{workspace_id}/classification-rules` returns `{revision: integer|null, rules: Rule[], available: boolean}`. `available=false` means metadata is unavailable/corrupt; `revision` is null and no mutation is permitted.
- `Rule` is `{id: string (32 lowercase hex), name: string, keywords: string[], extensions: string[], category: string, subcategory: string|null, enabled: boolean, created: string}`. `created` uses the existing `stamp()` timestamp format.
- `POST /api/v1/workspaces/{workspace_id}/classification-rules/preview` accepts `{job_id: string, name: string, keywords: string[], extensions: string[], category: string, subcategory: string|null, rule_id?: string}` and returns `{token: string, revision: integer, rule: Rule-like object, matched: [{file_id:string,name:string,keywords:string[]}], evaluated: integer, excluded: integer, total: integer}`. Preview evaluates at most 50 retained records; it never reads source files or accepts text from the client.
- `POST /api/v1/workspaces/{workspace_id}/classification-rules` accepts `{preview_token: string, confirmed: boolean}` and saves/enables the exact server-side draft.
- `POST /api/v1/workspaces/{workspace_id}/classification-rules/{rule_id}/disable` accepts `{revision: integer}`.
- `POST /api/v1/workspaces/{workspace_id}/classification-rules/{rule_id}/enable` accepts `{preview_token: string, confirmed: boolean}` and requires a fresh preview bound to that exact rule ID.
- `DELETE /api/v1/workspaces/{workspace_id}/classification-rules/{rule_id}` accepts `{revision: integer, confirmed: boolean}`.

Rule validation errors: `PERSONAL_RULE_INVALID_INPUT`, `PERSONAL_RULE_INVALID_NAME`, `PERSONAL_RULE_INVALID_KEYWORDS`, `PERSONAL_RULE_INVALID_EXTENSIONS`, `PERSONAL_RULE_INVALID_CATEGORY`, `PERSONAL_RULE_INVALID_SUBCATEGORY`, `PERSONAL_RULE_LIMIT`.

Preview and mutation errors: `PERSONAL_RULE_PREVIEW_UNAVAILABLE`, `PERSONAL_RULE_PREVIEW_LIMIT`, `PERSONAL_RULE_PREVIEW_REQUIRED`, `PERSONAL_RULE_PREVIEW_INVALID`, `PERSONAL_RULE_ZERO_MATCH`, `PERSONAL_RULE_STALE_REVISION`, `PERSONAL_RULE_NOT_FOUND`, and `CONFIRMATION_REQUIRED`. Corrupt, linked, or inaccessible state reports `PERSONAL_RULE_STORE_UNAVAILABLE` from mutations; listing reports `available=false`.

## Persistence and matching

Rules are stored in the installation-local `TrustStore.path/classification-rules/` directory, in one JSON file per SHA-256 of the canonical physical root path plus filesystem identity. State includes only the root-keyed filename, revision, and rule fields (`id`, name, normalized keywords, extensions, taxonomy target, enabled, created); it stores no source filename, sample text, or original file content. Mutations share the TrustStore process lock and guard, validate existing metadata through `metadata_file`, and write via fsync plus atomic `os.replace`. Corrupt or hard-linked metadata is preserved and never overwritten.

Names are 1-60 characters. Two to five NFKC/casefold/whitespace-normalized ordinary-text keywords are required, each 2-40 characters, unique, and pairwise non-containing. Extensions must belong to `SUPPORTED`; categories and subcategories come from server taxonomy. A store is limited to 50 rules and 256 KiB.

At local job creation, enabled rules and store availability are deep-copied as that job’s fixed snapshot. Cloud jobs receive no rules. Completed local jobs retain only decoded text (12,000 characters maximum), quality, file ID/name/extension, and scanned SHA-256 in process memory for previews. Retention is at most 50 files/job, 900 seconds/job, and 2 MiB of text across an `AnalysisJobs` manager; over-budget retention evicts oldest preview samples. Evicted jobs return `PERSONAL_RULE_PREVIEW_UNAVAILABLE`. Preview accepts only completed local jobs in the same granted workspace and compares retained hashes to the current in-memory workspace scan records.

Only quality `acceptable` and nonempty text participates in matching. Every keyword and the file extension must match. Rule results are review-required candidates with `personal_rule_matches`, provider `personal_rules`, and `personal_rule_applied` or `personal_rule_conflict`; conflicts do not replace the base classification target. Original classifier evidence and quality are preserved. Unavailable saved rules append `personal_rules_unavailable` without interrupting the base classifier. Rules never alter existing job results, review state, plans, or files.

Preview credentials are random server-generated tokens, retained in Session memory for at most 600 seconds and at most 16 outstanding tokens. They bind workspace, job, normalized draft, optional rule ID, and store revision; they are single-use on the matching save/enable route. A wrong workspace/rule route does not consume a valid token. Zero-hit previews cannot be committed. Re-enabling always requires a new preview.

## Verification

- RED: `python -m pytest -q --tb=short backend/tests/test_personal_rules.py backend/tests/test_personal_rules_api.py` initially failed collection because `neatdrop.personal_rules` did not exist, confirming the missing feature.
- GREEN/final: `& .venv/Scripts/python.exe -m pytest -q --tb=short backend/tests/test_personal_rules.py backend/tests/test_personal_rules_api.py backend/tests/test_analysis.py backend/tests/test_classification_pipeline.py backend/tests/test_api.py backend/tests/test_parsing_security.py`
- Result: `38 passed in 12.51s`.
- Coverage includes normalization/taxonomy validation, no-preview gate, preview/save, wrong-route and replay tokens, expiry, stale revisions, zero match, disable/re-enable/delete, conflict candidates, quality-limited exclusion, corrupt/hard-linked metadata preservation, local snapshot stability, and cloud isolation.

No additional dependencies were introduced. No known unresolved Task 1 behavior remains.

## Review fix round1 (49321fc)

Review identified cloud API None snapshot dereference, root-save accepting rule-bound enable credentials, and low-quality decoded text retained unnecessarily. Each had a failing regression before the fix. Fixed those paths, synchronized token credential lifecycle with Session.lock, removed duplicate import and unused preview_records. Covering exact assigned command (same six files above) passed41tests in14.06s. This is a controller-recorded summary of implementer evidence; scoped rereview pending.
