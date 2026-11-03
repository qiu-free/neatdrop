# Backend Security Hardening

User requested a backend vulnerability check and fixes. Work in place; no Git
repository exists. Reproduce issues using generated temporary files only.

## Trust boundary

This is a local single-user utility, not a network service or sandbox against
malware running as the same OS user. Selected directories, filenames, content,
model responses and transaction journals are untrusted. Original files may never
be removed. Undo may withdraw only a verified copy created by this installation.

## Tasks

- [x] API/security: red tests for non-loopback peers, oversized/streamed bodies,
  strict confirmation booleans, malformed JSON, allowed content types and JSON
  error contracts. Implement bounded body handling and request concurrency,
  sensitive-endpoint throttles, atomic session/workspace updates and safe headers.
- [x] Model/analysis: red tests for insecure model URL, oversized model response,
  invalid budgets, stale job snapshots, expiry and global admission caps.
  Enforce HTTPS URL constraints, bounded response streams, immutable file snapshots,
  global limits and expiry cleanup; no changes to offline/cloud consent separation.
- [x] Files/logs: reproduce forged journal, same-byte replacement, malformed JSON
  and stale scan-size bugs. Add a project-private trust ledger outside selected
  roots. Bind authenticated receipts to immutable plan fields, root identity and
  created target identity. Fail closed on missing/corrupt ledger or old history.
  Limit journal bytes/events/items and transaction count; check strict schema.
  Bounded directory enumeration, scan-byte budgets and same-handle bounded hashes.
- [x] Parsing: pixel limit before image decode, isolated PDF parsing with hard
  timeout/memory limits and bounded extracted content. Test slow/failing worker
  leaves main process responsive. No network or file-operation privileges for
  parser inputs (bytes only, outputs structured sampled text).
- [x] Verify: full backend and frontend regression, real local browser scan,
  analyze, confirmed copy and trusted undo, original SHA-256 unchanged. Review
  hardening changes and dependencies. Update README with repaired vulnerabilities,
  legacy read-only logs and residual risks; restart only the known app service.

## Initial reproduced findings

- Forged unkeyed journals can authorize withdrawal of a pre-existing taxonomy file.
- Same-byte target replacement is indistinguishable from the created archive copy.
- JSON scalar journal records raise AttributeError rather than fail-closed recovery.
- Pre-hash size can become stale; hashing/copy reads beyond per-file size limits.
- Request bodies, model responses, journal sizes and aggregate parsing lack bounds.
- Host checks alone do not enforce loopback clients if service is mis-bound/proxied.

Security goals are limited and testable; no claim of zero vulnerabilities or
general hostile-input sandboxing. Filesystem writes remain Windows-only.

## Final verification (2026-11-03)

- Backend: 110 tests passed, including actual Windows PDF timeout/memory process
  limits and all forged-history/replacement/malformed-input reproductions.
- Frontend: 12 tests passed, including legacy read-only vs trusted undo controls.
- TypeScript and production build passed. npm audit: 0; Python 3.12 pip-audit
  against pinned transitive requirements with --no-deps: no known vulnerabilities.
- Two focused read-only reviews found filesystem trust and streaming deadline/
  decompression issues; all actionable findings reproduced and fixed, no unresolved
  important finding identified within review scope.
- Isolated headless Chrome/Playwright E2E passed at 1440x1100 and 390x844. Flow:
  scan generated samples -> local OCR/CLIP -> edit/selection -> nested confirmed
  copy -> trusted withdrawal -> same-name external update/rescan. Six source hashes
  unchanged after copy/undo, zero console errors and external browser requests.
- Final server restarted with --no-proxy-headers --limit-concurrency32 and
  keep-alive5, health ok at http://127.0.0.1:8765. Windows startup script syntax valid.
- No original user files used in probes. Application-local private receipts are
  new state under .neatdrop-state; previous journals were not retroactively trusted.
