# Task 6 backend report

Date: 2026-11-11 (Asia/Shanghai)

Implemented the local authorized multi-root catalog backend and committed child-directory opening support shared with Task 8. The catalog is an explicit, current-session view over archive copies that already have trusted receipts; registration never indexes or authorizes arbitrary paths by itself. Existing per-workspace graph routes, limits and executor behavior remain unchanged.

## API contract

All routes remain behind the existing loopback peer, Host/Origin, session-cookie and CSRF middleware. Mutations require JSON and CSRF.

- `GET /api/v1/catalog` returns `{version, revision, updated, relations_revision, roots}`. Root records expose `{id, alias, status, manual_relation_count, relations_revision}` and include `workspace_id` only while authorized in this session. Stored paths are never returned. Status is `authorized`, `pending_reauthorization`, `offline`, `permission_denied`, or `identity_changed`.
- `POST /api/v1/catalog/roots` accepts `{workspace_id, alias, confirmed, root_id?}`. It only uses a workspace already authorized in this Session. Reauthorization requires the existing `root_id` and matching root identity. A locator matching an existing but ungranted root requires that explicit ID.
- `POST /api/v1/catalog/roots/{root_id}/revoke` accepts `{confirmed:true}`. It revokes catalog access, cancels that root's graph jobs, clears session-derived projections and preserves the ordinary workspace/workbench grant.
- `DELETE /api/v1/catalog/roots/{root_id}` accepts `{revision, relations_revision, confirmed:true, remove_relations:true}`. Both revisions are checked. It clears manual catalog relations touching that root, removes the locator and revokes the grant.
- `GET /api/v1/catalog/graph?offset=0&limit=1000` returns `{items, related_items, relations, total, offset, limit, effective_limit, next_offset, truncated, relations_truncated, verification, roots, root_revisions, root_indexes, index}`. `limit` is 1–1000. `items` is the primary page; `related_items` contains at most 200 adjacent endpoints on other pages, and the combined entry count stays at most 1000. The primary page may shrink due to related capacity or the verification byte budget; clients must follow `next_offset` rather than calculate a fixed page width. Entries expose `id` (SHA-256 of `root_id:entry_id`), `original_entry_id`, `root_id`, `source_alias`, and session-only `workspace_id`. Only currently granted roots are considered. Existing per-root graph jobs create features; aggregation reuses currently valid features and the existing sparse matcher.
- `GET /api/v1/catalog/library/{composite_id}/preview` returns the normal preview payload after fresh descriptor, content and session-generation checks.
- `GET /api/v1/catalog/graph/relations/{relation_id}/evidence` freshly reads and verifies both endpoints and rechecks grants before returning excerpts.
- `POST /api/v1/catalog/graph/relations` accepts `{source,target,kind,revision,candidate_id?}`. Kinds match existing manual graph kinds. Catalog relations have their own atomic installation-local store and optimistic revision; accepting an automatic candidate dismisses it at the same revision.
- `POST /api/v1/catalog/graph/relations/{id}/dismiss` accepts `{revision}` for current automatic suggestions. `DELETE /api/v1/catalog/graph/relations/{id}` accepts `{revision}` for manual relations.
- Integration addition: `POST /api/v1/workspaces/{workspace_id}/children/{file_id}/open` accepts `{confirmed:true}`. It opens only a scanned direct directory child, pins and compares identity around workspace creation/scanning, registers a separate workspace, and returns it without changing the current workbench.
- `GET /api/v1/config` now reports `offline.scanned_pdf` from `pdf_ocr_status()` without enabling the opt-in feature.

## Security and invalidation

The installation-local registry stores only a locator and `(device,inode)` identity and is never used to open a root. A grant is a separate Session object tied to the exact authorized `Workspace` instance and matching root identity. A new session sees locators only as pending. A replaced root remains `identity_changed`; adding the replacement requires removing the old registration first. Catalog access requires its own grant even while an ordinary workspace grant exists.

Catalog projection first reads the bounded metadata and determines the page. It then checks file identity and SHA-256 for the primary page and a bounded adjacent-endpoint set, under a cumulative 200 MiB / 5 second verification budget. Unverified entries are marked `unverified`, produce `CATALOG_VERIFY_BUDGET`, and cannot supply visible relations or ready features. `verification` reports `{bytes,max_bytes,max_seconds,limited}`. `relations_truncated` and `CATALOG_RELATED_LIMIT` explain omitted adjacency when capacity or byte budgets apply. Preview and evidence verify only their requested endpoint(s), rather than hashing the entire catalog. Same-size byte changes hide nodes from relations and evidence. Evidence rereads both endpoints and rechecks catalog grant generations at the response boundary. Catalog operations are serialized by the session catalog lock. Cross-session membership/revision checks and the paired removal writes use a short shared metadata transaction; relation commits recheck root membership/identity inside that same shared metadata lock. Global installation locks are never held across file hashing or graph-job cancellation. Manual relation storage is separate from transaction journals. Page relations touch at least one primary-page entry; cross-page endpoint metadata is returned in `related_items`.

## TDD and verification

The first new API tests ran red against missing catalog routes (4 expected failures). Added implementation and observed green. Expanded cases exercised cross-root identity, session isolation, catalog revoke, tamper resistance, same-size content changes, revisions, root-removal impact and count, per-root graph indexing, candidate confirmation/dismissal, deterministic paging, limits, security middleware, child-open confirmation/identity and PDF capability status.

Final fresh command:

```powershell
.venv/Scripts/python.exe -m pytest backend/tests/test_catalog_api.py backend/tests/test_catalog_directory_api.py backend/tests/test_graph_api_v9.py backend/tests/test_graph_v9.py backend/tests/test_api.py backend/tests/test_parsing_security.py -q --tb=short --basetemp=./catalog-round2-complete
```

Result: **50 passed, 1 skipped** in 31.30 seconds. The skip is the existing platform-gated symlink test. Windows sandbox temporary-directory cleanup was denied by the sandbox on an initial run; rerunning the same test command with approved execution outside the sandbox produced the reported result. Final review added separately observed red regressions for per-root dismissed suggestions, replaced-file graph cancellation, unrelated preview I/O, missing verification budgets, the catalog/global-lock inversion, and concurrent child rescan/replacement. Round 2 observed both cross-session remove/register and remove/add interleavings fail red before adding the short shared metadata transaction; their green checks also retain the deadlock regression. The fixes preserve current Session grants and endpoint identity checks. The covering run verifies byte-budget cursor progress and explicit deadline-limited responses.

## Limitations

- Catalog aggregation consumes per-root persisted index features; it does not start hidden extraction jobs. The existing single-root graph job remains the user-confirmed indexing action.
- Automatic sparse candidates currently arise from freshly verified indexed features. Cross-root exact-digest duplicates are derived directly from trusted archive records. No classification-based or synthetic links are added.
- Registry and manual relations share the installation-local trusted metadata boundary; corruption fails closed. They are bounded to 10 roots, 5000 manual relations, and 2 MiB metadata.
- The root graph response `index.revision` is the catalog manual-relation revision. `root_revisions` and `root_indexes` expose per-root index revisions/count/state separately.
- Duplicate facts use a deterministic chain per digest, preventing quadratic duplicate cliques. Derived relations are bounded to 5000; the existing graph canvas remains limited to 200 visible nodes in the frontend.
- Child-directory endpoint coverage here depends on the adjacent Task 8 `Workspace.child_directory()` implementation; root has a separate unit suite for that primitive.
- Verification budgets apply to file-byte hashing/endpoint reads; bounded archive metadata projection and matching are still recomputed per read. No catalog performance claim is made. Budget-limited adjacency is explicit; preview/evidence can verify one chosen relation independently.
- No synthetic accuracy, public deployment, Qoder authorship or product performance claim is made.
