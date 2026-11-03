# Backend review follow-up

Date: 2026-11-03. Read-only review of the current backend after the executor
progress-race repair. No backend source was changed in this follow-up.

## Low-severity hardening note: public configuration version is a key verifier

`backend/neatdrop/configuration.py:343-348` includes
`SHA-256(api_key)` in `version_material`, then publishes a deterministic
configuration digest truncated to 20 hex characters as `config_version`.
`backend/neatdrop/model.py:33-37` includes this value in `model_status()`, which
is returned by `/api/v1/config` in `backend/neatdrop/app.py:140-143`.

If a configuration version is copied into a log, screenshot, or support report,
someone who knows the other public configuration values can test guesses for a
low-entropy API key offline. The deterministic digest can also correlate repeated
snapshots when the same revision and effective settings recur. This is a limited
exposure: the API is loopback-only and session-protected, and provider keys are
usually high-entropy. I did not reproduce recovery of a real key, so this is a
hardening concern rather than a demonstrated credential compromise.

Consider deriving the public binding value with an installation-held secret, or
using an opaque configuration revision that does not depend on key material. Any
replacement should still make environment-key changes invalidate stale consent.

Resolved in final implementation: `config_version` is HMAC-SHA-256 with a
process-random key. It remains stable within a process for unchanged configuration,
changes when effective settings/key change, and expires across server restarts.
The final 144-test backend regression includes keyed version and multicast checks.

## Executor visibility race: repaired

The earlier plan-to-progress gap is addressed in `backend/neatdrop/executor.py:75-94`.
After a status read misses progress and observes that the plan is no longer stored,
it rechecks progress while coordinated with the plan lock. Execution claims the
plan and publishes initial progress while holding that same lock. The regression
test `backend/tests/test_execution_progress.py:132-155`
(`test_status_does_not_disappear_when_execution_claims_plan`) covers the concurrent
reader during delayed progress publication and accepts only `running` or
`completed`. This review confirms the repair is present; the backend test suite was
not rerun as part of this frontend follow-up.
