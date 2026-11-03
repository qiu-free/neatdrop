# Final integration review — 2026-11-03

Scope: read-only review of root `classifier.py`, `decision.py`, `analysis.py`, evaluation implementation/CLI, frontend `Inspector`/`SettingsDialog`/workspace approval flow, user documentation, and the approved offline-v3 spec. Semantic implementation was reviewed separately by the extraction owner; extraction loader/PDF process fixes were actively owned by that agent during this pass and are not duplicated here. This reviewer changed only this review document.

## Verdict

No remaining critical defect was found in the reviewed root/UI scope after the fixes described below. The implementation is suitable as a bounded local-classification improvement with semantic inference explicitly experimental and disabled by default. This verdict does **not** establish production classification accuracy, fulfill the representative frozen-corpus release gate, or certify OS-level outbound-network isolation.

Final full-backend/frontend checks, actual browser workflow and extraction-owner verification remain the root delivery gate. A targeted review run is not a substitute for those checks.

## Findings resolved during this pass

1. **Paper tutorials and subjective-purpose tutorials could become ordinary suggestions.** Read-only probes reproduced `study/paper`, `ordinary`, empty review reasons for Chinese paper-writing help, an English “How to write a research paper” text, and reference-format instructions containing abstract/keywords/references/methods. A wallpaper-settings tutorial likewise became an ordinary wallpaper suggestion. The root added example-context review gates for paper writing/reference formatting and wallpaper/work-note/temporary-code/queue tutorials, after observing the new regression failures. The reviewed implementation now retains `example_context`; no development label or similarity floor was tuned.

2. **Incidental OCR on a natural photo could rename it.** A synthetic local payload with landscape `.42`, object `.20`, OCR `禁止吸烟`, and original `IMG_1234.jpg` produced `禁止吸烟.jpg`. The root now excludes `natural_photo` from automatic first-line title use. The regression confirms original name preservation while retaining the photo category.

3. **Semantic section conflict required integration into review metadata.** The latest decision code maps `semantic_chunk_conflict` to `conflicting_evidence` and retains `semantic_details.token_sampling` / `semantic_details.chunk_support`. Existing candidate rows retain bounded `chunk_scores`. A matching strong rule cannot erase the conflict. Frontend already explains `conflicting_evidence` in Chinese; raw similarity values are not displayed as accuracy.

4. **Local PDF cancellation adapter mismatch.** Initially `analysis._prepare_input` passed `cancelled=` while `parse_pdf` did not accept it; this would make a normal local PDF analysis job fail with `TypeError`. The extraction owner added the callback and bounded polling; the root added a real local PDF job regression. The targeted run below passes that regression. Remaining native PID/loader verification is documented in the extraction owner's report.

## Explicit ruling checked

Optional experimental semantic failure does not invalidate an independently strong existing rule. For example, a clear resume with `semantic_engine_failed` remains ordinary while retaining the degradation in `engine_warnings`. This behavior was raised and explicitly accepted by the root; a named regression now protects both the ordinary decision and warning. Insufficient rules plus empty/failed semantics still abstain. Required image/OCR failures, semantic conflict and partial sampling continue to require review. This is a deliberate distinction between optional enrichment and evidence on which a decision depends.

## Verified integration properties

- Rule, semantic and visual score scales are not summed. Candidate IDs are validated against the fixed taxonomy; fallback concepts do not enter semantic competition. Semantic-only and new structural outputs remain review-required. Close same-parent semantic candidates produce main-only suggestions; divergent engines preserve uncertainty.
- Candidate selection is an edit, not confirmation. The real `useWorkspace` integration clears previous approval and existing plan; generating another plan before confirmation is blocked. Busy analysis disables edits, candidate controls and approval. Ordinary batch approval excludes edits and review-required items.
- Sampling metadata is passed into decisions and explanations. Text/PDF evidence is mapped to original character/page coordinates; OCR evidence receives available original-image boxes. Truncation cannot silently become ordinary. Natural photos preserve original names, and abstention keeps the original name.
- Cloud processing remains a separate consent/config-snapshot branch. Local semantic/OCR vectors, profile scores and layout are not appended to its payload. Text stays capped at 1,500 characters; image input is a 1,024-pixel thumbnail with EXIF removed. Runtime content, previews, edits, sampling and vectors remain in memory. Browser persistence is restricted to validated UI/tutorial preferences.
- Job cancellation is forwarded into bounded workers. An asyncio wrapper cancellation sets the shared cancellation flag, rather than assuming cancelling `to_thread` stops native work. Public error results avoid arbitrary parser/model exception text.
- Evaluation requires an explicit authorized manifest; checks group/split overlap, ID/label validity and source/authorization; includes failed/abstained labeled cases in denominators; counts `must_review` ordinary outputs as ordinary errors; counts out-of-scope false positives in precision; reports Wilson uncertainty and engine degradations; omits filenames and document text from report records. Sample hashes, source/engine fingerprints, dependency versions and model manifest fingerprints are included.
- `subcategory: null` in evaluation is an exact main-only acceptable label rather than a wildcard for every child. The ambiguous fixture explicitly lists contract, resume and main-only alternatives, matching that behavior.
- Settings distinguishes installed/self-tested readiness from experimental enablement. No inference-time model download action exists in the UI. Candidate score percentages are not shown.

## Remaining disclosed limits and final handoff

- **Evaluation artifact freshness:** at the review snapshot, the checked-in development JSON's `classifier.py`, `extraction.py`, and `offline.py` fingerprints differed from current source after the final fixes. Root must regenerate the checked-in report after active extraction changes finish; otherwise its numbers cannot be attributed to final source. The semantic/decision/profile fingerprints matched at that snapshot. This is a final regeneration task, not a reason to tune on the development fixtures.
- **Metadata consistency:** `offline_status()` still showed `rule_version='2'` during the snapshot while root results report version 3; the active extraction owner was asked to update it near the owned changes. Verify the delivered status matches the actual rule version.
- **Real quality evidence remains limited:** the 40 hand-authored CC0 development cases are useful regression probes, not 300–500 independent representative samples or a frozen production test. The observed semantic stage did not improve Top-1/Top-3 over enhanced rules. Default-off semantic deployment, no accuracy percentage, and explicit calibration limitations are appropriate. Future representative evaluation remains required before ordinary semantic decisions or release-level accuracy claims.
- **Network evidence is application-level:** real inference runs with worker Python socket/DNS denial and fixed local CPU ONNX packages. No OS firewall rule or packet capture was performed. README and semantic/extraction reports disclose this; do not label it OS-level disconnected validation.
- **Baseline extraction scope is limited:** inline text freezes v2 first-12,000 sampling, but explicit file-path stages share current extraction and therefore compare classifiers rather than old/new extraction. The evaluator and Markdown output disclose this distinction.
- **Metrics are estimates:** local measured worker latency/memory does not establish representative production P95 or entire application process-tree peaks. Zero ordinary errors on this small development set does not satisfy the Wilson-upper-bound release gate.

## Verification evidence

Targeted latest root regression command:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_decision.py backend/tests/test_evaluation.py backend/tests/test_analysis_v3.py backend/tests/test_classification.py -q -p no:cacheprovider --basetemp .cache/final-review-root-3
```

**69 passed in 1.81 seconds.** This includes the tutorial gates, natural-photo name guard, actual local PDF job, semantic chunk-conflict propagation and explicit optional-engine-failure ruling.

Earlier targeted analysis/decision/evaluation run: **43 passed in 7.24 seconds**. Targeted frontend verification:

```powershell
npm.cmd test -- --run src/components/Inspector.test.tsx src/components/SettingsDialog.test.tsx src/useWorkspace.test.ts
```

**3 files, 52 tests passed; 2.81 seconds.** Initial sandbox Vite helper spawn returned `EPERM`; the required escalated rerun passed without changing the test configuration. Backend test execution likewise required existing Windows temporary-directory/process access outside the restricted sandbox. No independent full-build or browser claim is made by this review.
