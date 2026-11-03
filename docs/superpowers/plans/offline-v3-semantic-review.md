# Independent semantic-domain review

Reviewed 2026-11-03 against the approved v3 design §5.3–5.8 and plan Task 2. Scope: `semantic.py`, `classification_profiles.json`, `prepare_semantic.py`, and semantic tests. Read-only implementation review; no source edits or subagents.

## Final scoped re-review after fixes

The four findings below describe the initial review snapshot and are **resolved in the current implementation for the candidate-only scope**. Fresh verification completed **40 passed in 13.35s**:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_semantic.py -q -p no:cacheprovider --basetemp .tmp-semantic-rereview-final
```

- P1 model-path replacement: `read_verified_package` rejects root/ancestor links before canonicalization, pins directories, reads through no-follow deny-write/delete handles, and returns immutable checked bytes. ONNX and tokenizer consume those bytes rather than reopening filenames. Local import now copies the same verified bytes. A real-model coordinated post-hash replacement regression continues to infer from the original checked package.
- P2 chunk conflict: candidates carry bounded `chunk_scores`; `chunk_support` preserves each sampled chunk's top candidates and sets a conflict flag. Conflicts emit `semantic_chunk_conflict`. The regression explicitly distinguishes invoice support in one section from receipt support in another.
- P2 purpose requirements: `profile_eligible` now suppresses tutorials/negated use and requires explicit subject/purpose structures for sensitive/personal-use categories including invoice, medical, identity, wallpaper, photos, board, work notes, code and queue. All three reproduced problematic probes, plus identity/photo/code counterexamples and positive evidence cases, are covered. This is a conservative eligibility guard, not a comprehensive implementation of every profile's natural-language necessary conditions or a claim of calibrated recall.
- P2 lock budget: the deadline is created before `_execution_slot`; lock waiting, status self-test and native work share the remaining deadline. A short lock-contention regression returns within the total requested bound. The suite also now verifies a real allocation exceeding the native cap fails with `MemoryError`.

The corrected native-interpreter PID test, self-test result validation, real CPU model tests and local package import tests also pass. No remaining P1/P2 blocker was found in this scoped re-review. Semantic stays off by default and requires review when explicitly enabled; the quality verdict below is unchanged because no representative accuracy validation or measured gain has been established.

## Verdict

The selected BGE model, normalized CLS pooling, CPU provider, real-token chunk budget, explicit preparation, pinned package digests, negative examples, fallback exclusion, cancellation, and disposable native workers are substantially implemented. The independent targeted run completed **27 passed in 11.16s** with actual local inference and import self-test; no model-dependent test skipped.

The domain is suitable as an explicitly enabled, review-required experiment. It does not establish classification-quality improvement. The development report at initial review showed semantic Top-1 and Top-3 unchanged at 31/35 versus new rules, with fewer abstentions (7 to 3), so retaining `NEATDROP_SEMANTIC_CANDIDATES` off by default is justified. Representative production calibration remains absent. The initial findings below are retained as review history; their final dispositions are in the re-review section above.

## Actionable findings

### P1 — Pin verified model files through native loading

**Files:** `backend/neatdrop/semantic.py:79`, `semantic.py:84`, `semantic.py:214` (session creation), `semantic.py:294`; analogous check/copy boundary in `scripts/prepare_semantic.py:115` and `:134`.

`verify_package` checks paths with `is_symlink`/junction/resolve and hashes them through ordinary open handles, then closes those handles. `_infer_local` subsequently opens the ONNX/tokenizer by filename. A process able to replace files in the model directory can swap the verified file or an ancestor after hashing and before ONNX opens it; the native loader can then consume bytes that never matched the trusted digest. The parent also calls `Path(model_dir).resolve()` before sending it to the child, removing evidence of a symlink/junction supplied as the root. Static path rejection is useful, but it is not the same guarantee as the existing locked document-reader path.

Use a directory pin and no-follow/read handles held through native loading, or hash while reading immutable in-memory bytes and supply precisely those bytes to ONNX/tokenizers. Preserve and validate the original root path before canonicalization. Add a coordinated replacement regression between successful hash verification and session initialization. The importer's post-copy hash prevents publishing an untrusted package, but the source files should likewise be opened without following late links if the claim includes not reading beyond the explicit import source.

### P2 — Preserve chunk-level support and conflict

**Files:** `backend/neatdrop/semantic.py:149`, `semantic.py:266`, `semantic.py:276`.

All chunk scores collapse to a per-category mean in `select_candidates`; the response retains token spans but no chunk scores, top labels, spread, or conflict flag. Two incompatible chunks can therefore produce the same result as two moderately supportive chunks, and the decision layer has no evidence to distinguish them. Design §5.4 explicitly requires retaining score distribution and conflict across chunks. The current test that means beat an isolated maximum verifies aggregation, but cannot verify the missing conflict contract.

Return bounded per-chunk top-label/support summaries or candidate per-chunk scores, add an explicit conflict warning when sampled sections disagree, and ensure the decision layer carries that reason to review. Retain the current mean-based guard against a single example dominating.

### P2 — Treat necessary structure as a real candidate gate

**Files:** `backend/neatdrop/semantic.py:102`, `semantic.py:260`, `semantic.py:270`; `backend/neatdrop/classification_profiles.json:25`, `:35`.

Profiles document necessary structure and explicit personal-use constraints, but inference encodes only definitions and positive/negative examples. `necessary_structure` is schema-checked and then unused. Real local probes reproduced:

- `这是一份壁纸设计教程，介绍如何选择手机屏幕背景，并非准备归档的壁纸。` → first candidate `social/wallpaper`, score `0.796141`.
- `患者检验报告示例用于医学课程教学，不是真实就诊资料。白细胞结果5.3，单位和参考范围。` → first candidate `life/medical`, score `0.747478`.
- `手机锁屏壁纸图片下载教程：背景设置与分辨率调整。` → `social/wallpaper`, score `0.759869`.

These remain review-only, so they do not authorize file operations, but the proposed purpose can contradict explicit input. A stronger generic similarity score is not a substitute for required-use evidence. Add bounded structural/exclusion predicates for sensitive or personal-purpose classes, or mark those profiles unsupported for semantic candidate selection until an independent predicate can establish their requirements. Add the negated tutorial/teaching probes as regressions. Do not tune a floor on these probes and describe that as general calibration.

### P2 — Bound model-lock waiting as well as the child process

**Files:** `backend/neatdrop/semantic.py:164`, `semantic.py:283`, `semantic.py:295`, `semantic.py:334`.

The worker deadline starts after acquiring `_LOCK`. `_execution_slot` retries forever when no cancellation callback is supplied. A concurrent status call plus inference can therefore exceed the documented 12-second call budget; enough concurrent status requests can queue request threads indefinitely. A controlled probe held the lock 0.6 seconds and requested `timeout=.1`; the call did not time out until 0.719 seconds. Child lifetime remains bounded after launch, but total call wait does not.

Create the deadline before lock acquisition and pass the remaining budget into both the slot wait and child communicate loop, or return an explicit busy/budget status when acquisition cannot succeed promptly. Test two concurrent native requests plus status under a short total budget. Keep cancellation checks while waiting.

## Resolved during the review

- The first test run was **1 failed, 25 passed in 10.82s** because `SemanticEngine.status()` discarded the self-test result and accepted `{}` as ready. The owner added exact self-test result validation; the fresh 27-test run passes.
- On Windows, the venv Python launcher can create the actual interpreter as a grandchild. Direct `subprocess.Popen(sys.executable)` then kills the launcher, leaving native inference alive. The owner switched to `sys._base_executable -I -S` and an explicit installed dependency path and added a PID regression. The final tests exercise the corrected implementation. This distinction is critical for the native timeout claim.

## Verified strengths and scope limits

- Pooling matches the pinned upstream `pooling_config.json`: CLS enabled, mean/max disabled; L2 normalization is correct. No E5 instruction/pooling assumptions are mixed into the BGE path.
- Each document chunk contains at most 382 content tokens plus CLS/SEP, at most six chunks, adjacent overlap at most 48, deterministic head/tail selection, with uncovered input flagged. Input is bounded before child request serialization through the public engine.
- The fixed file sizes and trusted SHA-256 values are compiled into code; a local manifest cannot redefine trust or select an unknown revision. The preparation CLI enforces license acknowledgement, HTTPS allowed hosts, bounded redirects, byte caps, per-file hashes, atomic sibling-stage publication, and self-test before publication.
- Runtime uses explicit local ONNX/tokenizer paths, filtered worker environment, CPU-only provider, offline flags and Python audit rejection of sockets/DNS/subprocesses. The real self-test checks network guard behavior. This is not a claim of OS-firewall confinement against arbitrary native code, which is excluded by model-package trust.
- Taxonomy coverage is 35 profiles, with 33 candidate profiles and two excluded fallback labels. Semantic outputs remain candidate-only; no ordinary status is justified by these scores.
- Request timeout and cancellation kill/reap the actual worker after the launcher correction. A 1536 MiB native process cap is installed before model loading. The semantic-specific suite does not yet include an actual deliberate memory-allocation-over-cap test analogous to the PDF/image tests; add one when strengthening resource-bound evidence.
- The candidate floor `.53` and negative margin `.02` are engineering guards based on 12 development probes, not calibrated classification thresholds. The source comment states this correctly.

## Reproduction

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_semantic.py -q -p no:cacheprovider --basetemp .tmp-semantic-review-final
```

Final output: `27 passed in 11.16s`. Tests ran outside the restricted process sandbox to permit worker creation. This review neither prepared additional models nor changed semantic source, profiles, evaluation labels, or thresholds.
