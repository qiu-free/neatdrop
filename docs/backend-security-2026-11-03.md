# Backend security audit and hardening

Date: 2026-11-03. Scope: local Windows NeatDrop service, trusted application files,
untrusted selected directories/documents/model responses. Not a formal penetration
test or guarantee of no remaining vulnerabilities. Original files never removed.

## Reproduced findings and repairs

1. **High impact: forged history authorized withdrawal of unrelated files.** The
   old journal used a recomputable hash chain and could be pre-seeded. Undo now
   requires an installation-local receipt outside the selected root, matching the
   exact immutable plan, normalized root path, root volume/file identity and each
   created archive identity. An imported or legacy journal cannot create trust.
2. **High impact: same-byte replacement could be withdrawn as if app-owned.** Undo
   now checks OS file identity on the locked target handle before hashing/rename.
   Same bytes with a different file identity fail with TARGET_REPLACED.
3. **Availability: unbounded requests, parsing and model responses.** Added request
   body 128 KiB/15-second whole-stream limits, 24 active requests, throttled session
   and expensive task creation, two analysis slots and two preprocessing slots.
   Cloud output capped at 256 KiB with a 65-second overall deadline. Compressed
   model responses are refused before decompression. Model URLs require HTTPS,
   disallow credentials/query/fragment and local/private literal endpoints.
4. **Availability: hostile PDF/image expansion.** Reject images above 24 million
   pixels or 16000px side before decoding. PDF parsing uses disposable spawned
   processes, a 12-second deadline and 384 MiB Windows Job Object memory cap.
   Parent kills and joins timed-out/crashed workers. Extract only sampled pages
   and bounded text. Resource isolation is NOT a full OS security sandbox.
5. **Availability: malformed or huge journals.** Validate strict plan/item fields,
   immutable fields, plan digest and bounded event envelopes. Scalar JSON and
   corrupt metadata become fail-closed recovery entries, not uncaught 500s.
   Caps: 2 MiB/log, 1200 events/log, 50 items/plan, 500 history entries/root. New
   execution stops before crossing the history cap. Undo reserves recovery event
   capacity; duplicate acknowledgements do not consume extra records.
6. **Size race:** bounded source hashing/copying rechecks live handles, refuses
   >20 MiB growth and verifies stable size/time. Scan enumerates at most 2000 entries
   without first materializing the whole directory; content hashing budget is
   200 MiB per scan. Supported-name validation applies before generating plans.
7. **Request validation/access:** validate actual loopback peer in addition to
   Host/Origin/CSRF. Strict confirmation booleans refuse strings such as "yes".
   Require application/json mutations, reject content encoding, sanitize 422
   responses, reject non-ASCII CSRF strings safely. Startup disables forwarded
   proxy headers, sets server concurrency and keep-alive limits.
8. **Stale analysis consent:** jobs bind approved file snapshots at creation,
   so a later scan cannot silently substitute updated bytes for cloud analysis.
   Session expiry stops new work; partial results never trigger execution.

## Compatibility and private state

`<project>/.neatdrop-state/` stores private receipts containing paths, hashes and
created-file identities. It is excluded from Git and is not encrypted. Keep it
with the installation and include it in backups if future undo is needed.
The app refuses selecting this directory, its descendants, or ancestor directories
containing it. Choose a separate data folder. Network shares are unsupported.

Old directory journals remain readable but have **no automatic undo authority**.
The UI marks them read-only and omits the undo button. Original files and existing
copies are not migrated, renamed or removed. Missing/corrupt receipt => no undo;
never rebuild receipt trust from an untrusted journal. Reinstalling without private
state or changing the root identity can disable automatic undo of old operations.

## Verification

Tests use generated temporary files, fake HTTP model transports and controlled
workers. Coverage includes forged journals with recomputed valid hashes, same-byte
replacement, source growth, strict/streaming request limits, invalid request types,
deep JSON, non-ASCII CSRF, model response budgets/encoding, immutable snapshots,
expired owner cancellation, log capacity/idempotent ack, pixel bombs, actual PDF
timeout/recovery and oversized allocation denied in its Windows worker.

Both focused code reviews found and reproduced additional boundary issues, which
were converted to regression tests and repaired. Final counts/commands are recorded
in `docs/superpowers/plans/2026-11-03-backend-hardening.md` after final verification.

## Residual limitations

- Do not expose this single-user local service through a reverse proxy, tunnel,
  LAN listener, or public address. The browser session is not a multi-user login.
- A malicious process running as the same OS user can modify application code or
  private receipts. This is outside the protection boundary; no malware defense
  or authenticated signature across untrusted installations is claimed.
- PDF worker limits contain resource consumption, not arbitrary-code exploits.
  Native image/ONNX/OCR dependencies are trusted and are not all OS-sandboxed.
  Avoid intentionally hostile files; keep dependencies updated.
- Filesystem identity checks reduce replacement risk but do not prove safety
  under hardware failures, kernel compromise, arbitrary network filesystems or
  file-ID reuse across unusual storage lifecycles. No permanent deletion exists.
- Model endpoint configuration is a trusted local administrator setting. HTTPS
  and literal-address checks are not a full DNS-pinning SSRF gateway. No API
  allows untrusted users or files to choose that endpoint.
- Cloud semantic accuracy and provider data retention were not audited. Offline
  inference is local and does not automatically fall back to cloud.
