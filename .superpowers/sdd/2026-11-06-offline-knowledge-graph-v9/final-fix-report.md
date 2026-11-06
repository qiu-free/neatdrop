# Final lifecycle fix report

## Scope

Backend graph-job lifecycle only. The fix addresses same-session reauthorization of
the same physical root orphaning a running graph job after the UI receives a new
workspace id.

## Implementation

- Graph job lookup and cancellation now authorize against the stable graph-store
  root key, while remaining scoped to the current session's `GraphJobs` manager.
- A successful `open_workspace` constructs and scans the new workspace first,
  then cancels queued/running graph jobs for that root. Failed authorization or
  executor construction therefore leaves an existing job untouched.
- Cancellation marks the job immediately but leaves `_ACTIVE` and the semaphore
  slot owned until the worker exits through its existing `finally` cleanup.
- The queued-to-running transition is serialized under the manager lock so a
  reauthorization cancellation cannot be overwritten by a late worker start.

## Regression coverage

`test_reauthorizing_same_root_cancels_prior_job_and_allows_retry` uses the real
FastAPI API and a blocked decode to verify that:

- a failed reopen preserves the old running job;
- a same-session successful reopen exposes and cancels the old job by stable root;
- no partial graph index is published;
- a different root and a different session cannot control the old job;
- a retry remains `GRAPH_JOB_BUSY` until the blocked worker releases its resources,
  then starts and completes successfully.

## Verification

Command:

```text
python -m pytest backend/tests/test_graph_api_v9.py backend/tests/test_graph_v9.py backend/tests/test_api.py backend/tests/test_hardening.py backend/tests/test_library_v6.py -q --tb=short
```

Result: **81 passed, 2 skipped**.

## Concerns

No known concerns remain within this backend lifecycle scope. The parent task is
responsible for the final full-suite run and frontend review.
