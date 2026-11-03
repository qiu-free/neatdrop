# Daily backend settings and analysis report

Date: 2026-11-03. Scope: `backend/neatdrop/configuration.py`, `model.py`,
`analysis.py`, `app.py`, and new backend regression tests. No Git repository exists.

## Changes

- Added DPAPI user-protected model settings in
  `.neatdrop-state/model-config/settings.json`, separate from trust receipts.
  The file uses a strict version-1 encrypted envelope, a bounded read, and a
  same-directory temporary file plus atomic replacement. There is no plaintext
  fallback. Corrupt or unreadable settings appear as unconfigured with a safe
  `settings_error`; writes fail closed rather than replacing corrupt data.
- Added static endpoint/model/budget validation, saved-key endpoint binding, and
  per-field environment source/lock metadata. An environment API key forces the
  endpoint to the environment base URL or the default endpoint and locks it.
  Public configuration responses expose no key value.
- Added public HTTPS DNS validation for model connections. Every answer must be
  public; the transport connects to one validated address, checks the expected
  host and port, and carries the original hostname through SNI and certificate
  verification. Model traffic disables redirects and environment proxies and
  keeps the existing timeout, identity-encoding, and response-size limits. DNS
  lookups have a two-worker cap that remains held until a timed-out resolver thread
  exits.
- Added fixed-text connection tests requiring `confirmed: true`. A test sends one
  request with a 24-token response limit, caps the response at 32 KiB, returns no
  model-generated text, and does not save settings. Saving settings performs no
  model request or DNS lookup.
- Bound cloud jobs to an immutable model snapshot. New callers can provide both
  `endpoint` and `config_version`; a stale or partial binding returns
  `MODEL_CONFIG_CHANGED`. Jobs retain the approved snapshot for every file.
  Legacy callers may omit both fields; one-argument `suggest(payload)` patches
  remain supported.
- Analysis job snapshots and getter results are deep copied under an `RLock`.
  Jobs publish `current_file`, `current_file_id`, and `phase` as work proceeds;
  completed results are visible while later files are running.
- Added the workspace-scoped execution status route requested by root:
  `GET /api/v1/workspaces/{identifier}/executions/{plan_id}`. It reads the
  executor snapshot without starting execution and returns 404 for an unknown
  plan or a workspace outside the session.

## API contract for UI integration

`GET /api/v1/model-config` returns `endpoint`, `text_model`, `vision_model`,
`max_requests_per_batch`, `configured`, `key_source`, `key_locked`,
`config_version`, and `settings_error`. Each non-secret setting also has a
`*_source` value (`default`, `saved`, or `environment`) and a `*_locked` boolean.
The key source is `none`, `saved`, `endpoint_mismatch`, or `environment`.

`POST /api/v1/model-config` accepts optional `endpoint`, `text_model`,
`vision_model`, and `max_requests_per_batch`, plus `key_action` (`keep`,
`replace`, or `clear`). `api_key` is accepted only with `key_action: "replace"`.
The `keep` action preserves the current saved key only while its bound endpoint
matches. Environment-locked fields reject differing writes with
`MODEL_SETTING_LOCKED`.

`POST /api/v1/model-config/clear-key` requires `{"confirmed": true}`.
`POST /api/v1/model-config/test` also requires `confirmed: true` and accepts the
same temporary form fields. It can test an unsaved replacement key; keeping an
existing key while changing endpoint returns `MODEL_KEY_ENDPOINT_MISMATCH`.

The regular `/api/v1/config` response now includes `model.endpoint` and
`model.config_version`. Cloud analysis clients should send both exact values
with `cloud_consent: true`. The execution status response contains `plan_id`,
`status`, `processed`, `total`, `current_file`, `items`, and `error`.

## Tests

- New settings and execution-route regressions: 17 tests cover redaction,
  environment precedence/locking, endpoint/key binding, keep/replace/clear,
  DPAPI-encrypted storage, corrupt-store behavior, fixed-text testing, public DNS
  rejection and pinning, TLS hostname preservation, stale consent, immutable job
  snapshots, progress snapshots, and execution-status access.
- Full backend suite: `pytest backend/tests -q --tb=short -p no:cacheprovider
  --basetemp=backend/.pytest-run` — **132 passed**.
- Pytest needed to run outside the workspace sandbox because the sandbox returned
  WinError 5 while enumerating pytest temporary directories. The test run itself
  used the project-local virtual environment and workspace-local basetemp.

## Integration notes and limitations

- Settings writes require Windows DPAPI. On other platforms, environment
  configuration remains readable, but persistent settings writes return
  `MODEL_SETTINGS_UNAVAILABLE` rather than storing plaintext.
- New UI-visible error codes include `MODEL_CONFIG_CHANGED`,
  `MODEL_SETTINGS_CORRUPT`, `MODEL_SETTINGS_UNAVAILABLE`,
  `MODEL_SETTING_LOCKED`, `MODEL_SETTING_INVALID`,
  `MODEL_KEY_ENDPOINT_MISMATCH`, `MODEL_DNS_FAILED`, `MODEL_DNS_BUSY`, and
  `MODEL_TEST_BUSY`.
- `settings_error` is `null` when the encrypted store is readable. When it is
  corrupt or unavailable, public settings use defaults/environment values and
  report the error while preserving the existing file.

## Execution review note

Root-owned executor code was reviewed without modifying `executor.py`. Plan
consumption remains protected by the workspace root lock and the executor lock;
the second concurrent execution cannot claim the already-popped plan. Journal
and trust writes still occur in the established order, and the status route checks
the session's workspace grant.

One visibility race was reproduced: `execute()` removes the plan from
`self.plans`, then calls `_progress_start()`. A status read during that interval
can miss both stores and return `EXECUTION_STATUS_NOT_FOUND`. Rechecking the
progress map after a plan fallback miss, or making the claim-to-progress
transition observable under a shared lock, would close the gap. This finding was
reported to root; the executor file remains unchanged here.
