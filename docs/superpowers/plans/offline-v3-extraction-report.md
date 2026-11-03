# Offline v3 extraction delivery report

Date: 2026-11-03. Ownership: `backend/neatdrop/extraction.py`, `parsing.py`, `offline.py`, `backend/tests/test_extraction.py`, `test_offline.py`, and this report. No Git initialization or commits. No other agent-owned source files edited.

## Stable interfaces

```python
sample_text(text: str, limit: int = 12000) -> dict
image_regions(size: tuple[int, int]) -> list[tuple[int, int, int, int]]
parse_pdf(data, limit=1500, timeout=12, cancelled=None) -> dict
OfflineEngine.analyze(image, use_ocr=True, use_vision=True) -> dict
analyze_image_bounded(image, timeout=25, use_ocr=True, use_vision=True,
                      cancelled=None) -> dict
offline_status() -> dict
```

`sample_text` returns `text`, `sample`, `truncated`, and `sampling`. Short text is read once; long text gets nonoverlapping head/middle/tail quotas (3999, 3999, 4000 at the default budget), reserving two newline boundaries. `sampling.segments` has zero-based, end-exclusive `start/end` offsets into the original string and `sampling.separator` is `"\n"`. The hard local maximum including separators remains 12000 characters. Newlines prevent distant fragments from synthesizing a word or anchor across the seam. Tiny custom budgets retain fewer separated nonempty segments.

`parse_pdf` treats `limit > 1500` as the local path used by analysis. It reads only pages 1, 2, `(page_count - 1) // 2 + 1`, and the final page, deduplicated and sorted. Text extraction is performed only on these pages. Character quotas reserve newline separators, so early pages cannot consume later pages' quota. Local segments contain one-based `page`, zero-based page-text `start/end`, and per-page `truncated`. `sampling.truncated` and `budget_exhausted` are true for omitted pages or quota truncation. The `limit=1500` cloud path retains its existing first-two-and-last-page behavior and response shape, with no local sampling/layout added. Existing Windows Job Object 384 MiB isolation and 12-second default timeout remain.

`image_regions` produces original-pixel `(left, top, right, bottom)` boxes: full image first, then at most five local views of at most 1600×1600. Narrow images use strips from the beginning to the end, distributed through the middle; large two-dimensional images use corners and centre. When five views cannot cover fine detail, sampling explicitly marks partial coverage and budget exhaustion.

OCR retains the existing `text`, `ocr_lines`, `visual`, and `warnings` fields and adds `sample`, `truncated`, and `sampling`. Each retained line has:

```json
{"text":"...", "score":0.95,
 "box":[[20.0,40.0],[200.0,40.0],[200.0,80.0],[20.0,80.0]],
 "region":0, "source":"ocr", "order":0}
```

OCR `box` is a quadrilateral mapped from the resized view to the input image's original pixels. Analysis supplies its EXIF-normalized image, so coordinates refer to that normalized image. Repeated normalized text is deduplicated only when spatial overlap covers at least 60% of the smaller box; identical text at other positions survives. Results are read top-to-bottom then left-to-right. At most 150 lines per view are examined, at most 150 lines retained, at most 300 characters per recognized line before final quotas, and final joined text is at most 12000 characters. Excess lines are sampled from beginning/middle/end. Truncation is visible in sampling.

CLIP now receives a full-image 224×224 letterbox with mean-color padding, preserving both edges. Images with aspect ratio above 2 also receive one limited local view. Full-view candidates remain in `visual`; supplementary scores are in `visual_local` and are not silently substituted for full-view scores. Existing warnings are retained.

All sampling objects follow the shared contract:

```json
{"kind":"text|pdf|image", "truncated":true, "budget_exhausted":true,
 "segments":[], "summary":"中文读取范围说明"}
```

Image `sampling.segments` contains original-pixel rectangular `box`, numeric `view`, and `kind` (`full` or `tile`). These represent completed OCR views. A failure can have no completed segments.

## Bounded inference and capabilities

`analyze_image_bounded` uses disposable spawned workers, maximum two simultaneous jobs, 25-second maximum native-inference deadline, and 1536 MiB per-process memory. Windows uses the existing Job Object helper with an explicit image budget; PDF's default stays 384 MiB. POSIX uses `RLIMIT_AS`. The image is limited to existing 24 million pixels and 16000px longest edge before worker serialization. Workers wait for the parent to attach resource limits before image construction or ONNX loading. Timeout/cancellation always terminates, joins, and if needed kills the child, then releases the slot.

`cancelled` is an optional parent-process callable; the parent checks it before starting and every <=0.1 seconds while waiting. The callable is not pickled into the child. It terminates native work rather than merely waiting for the next OCR tile.

The same optional callback now exists on `parse_pdf`; its parent polls in <=0.1-second slices, kills/reaps the actual child and raises `SafetyError('PDF_PARSE_CANCELLED')`. Existing positional/default calls remain compatible. Timeout remains capped at 12 seconds. Native-PID cancellation and subsequent slot recovery are regression tested.

Root-visible worker warnings:

- `inference_timeout`
- `inference_failed`
- `inference_budget_exceeded`
- `inference_cancelled`

Legacy image warnings remain `ocr_unavailable`, `vision_models_missing`, `vision_engine_failed`, and `image_low_information`. Failures return empty OCR/visual results with partial/budget-exhausted sampling; no fallback network call occurs.

Inside the spawned child, Python socket connect/connect_ex, create_connection, hostname resolution, and UDP sendto are denied before model initialization. This protection persists across Windows spawn and does not depend on the parent's monkeypatch. It is Python-level network denial, not an OS firewall claim; all model sources are explicit local paths.

`runtime` contains no document text: `network_disabled`, worker `elapsed_ms`, `memory_budget_mib`, and `peak_working_set_mib`. On Windows peak working set comes from `GetProcessMemoryInfo`; it is measured resident memory, distinct from the Job Object's commit-memory ceiling.

`offline_status` hashes actual local CLIP model files against the existing trusted expected digests and checks manifest agreement. OCR checks pinned local model digests from installed `rapidocr-onnxruntime==1.4.4`. Capability `available` is true only after digest verification, with `state=verified` and `integrity_check=passed`. Missing/corrupt packages produce `missing` or `integrity_failed`, with `available=false`. The state does not claim a runtime self-test or calibrated accuracy. Runtime model loading repeats integrity validation.

Following review, CLIP receives immutable verified ONNX bytes and `Tokenizer.from_str`, so replacing model files after checking cannot change what the native sessions load. File reads reject symlink/junction ancestors and use directory pins and no-follow deny-write/delete handles. RapidOCR requires filenames; all three exact model paths are provided explicitly and all model-file plus ancestor-directory handles remain pinned from hash verification through native initialization. Coordinated replacement tests demonstrate that CLIP consumes original verified bytes after filenames change and that Windows OCR model writes and ancestor renames are denied inside the constructor. Unsafe OCR ancestor state degrades capability status rather than raising. Status reports rule version 3.

## TDD and verification evidence

New extraction tests initially failed on the missing module. New offline tests then produced six expected failures: missing box/region metadata, only one long-image OCR call, centre crop losing edges, corrupted model falsely available, and missing worker entry. Cancellation and runtime metrics were added after their tests failed. Self-review regressions first failed for the PDF Pipe-startup semaphore leak and for omitted pages not marking budget exhaustion; both now pass.

Fresh combined command (executed outside the restricted process sandbox because Windows multiprocessing named pipes are denied inside it):

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_offline.py backend/tests/test_extraction.py backend/tests/test_parsing_security.py backend/tests/test_analysis.py backend/tests/test_hardening.py -q -s -p no:cacheprovider --basetemp .tmp-extraction-verify-8
```

Exact final result:

```text
74 passed in 27.83s
```

The malformed-PDF regression intentionally emits `invalid pdf header` / `EOF marker not found` under `-s`; no test failure or unexpected runtime warning occurred. Existing cloud sample, source protection, PDF timeout/384 MiB memory, and integration regressions passed.

The real OCR and CLIP tests actually ran (no optional-model skip). The real spawned worker used a hand-authored 900×500 Chinese invoice with title, invoice number, buyer, and amount; it returned the expected invoice/amount text, OCR boxes, ten finite CLIP scene scores, and no warnings. Measured result:

```json
{"network_disabled":true,"elapsed_ms":4594,"memory_budget_mib":1536,"peak_working_set_mib":344.9}
```

A deliberate 1800 MiB child allocation is rejected under the 1536 MiB Job Object; timeout and cancellation children are terminated and the next job succeeds. The tests also exercise OCR/CLIP directly with parent socket connections denied.

Follow-up native PID proof (after semantic review identified the separate subprocess/venv-launcher issue): CPython's Windows multiprocessing spawn implementation explicitly bypasses the venv redirect executable with `sys._base_executable`. Added image and PDF regressions record `os.getpid()` inside the executing child, assert equality with the PID tracked by the parent process handle/Job Object, and assert the actual PID is no longer running after timeout. Command:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_offline.py backend/tests/test_extraction.py -q -k 'actual_image_interpreter_pid or actual_pdf_interpreter_pid' -p no:cacheprovider --basetemp .tmp-extraction-native-pid-proof
```

Result: `2 passed, 25 deselected in 3.37s`. The checks validate actual interpreter death, not merely the Python `Process` wrapper's return status. No production-code change was necessary for multiprocessing.

After PDF cancellation, seam separators and model-loading race fixes, fresh combined regression:

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_extraction.py backend/tests/test_offline.py backend/tests/test_parsing_security.py backend/tests/test_analysis.py backend/tests/test_analysis_v3.py backend/tests/test_hardening.py -q -p no:cacheprovider --basetemp .tmp-extraction-final-followup
```

Result: **`100 passed in 31.05s`**. The new tests were observed failing before implementation (missing PDF cancellation keyword, absent separators, filename reopening, unpinned OCR writes, and unsafe-path status exception), then passed with the fixes. The suite includes real OCR/CLIP with child networking denied and actual PID termination on timeout and PDF cancellation.

## Self-review and practical limits

- Root owns `analysis.py` integration; its current code calls `sample_text` and `analyze_image_bounded`, passing cancellation. No full suite claim is made beyond the command above.
- Four sampled PDF pages and six OCR views are fixed budgets. Unseen content remains possible; coverage flags must keep review mandatory. Scanned PDF OCR remains unsupported.
- OCR reading order is a deterministic spatial order, not a multi-column layout reconstruction algorithm. Deduplication uses text equality and overlapping bounding rectangles, so different OCR transcriptions of the same word may remain.
- Letterbox and supplementary local CLIP views improve visibility but the ten existing scene prompts are not validated purpose classifiers. `visual_local` is evidence only.
- The 344.9 MiB measurement describes one synthetic invoice and is not a worst-case bound or a processing-speed promise. The hard worker cap and timeout handle expensive inputs; these failures provide no partial native result.
- Status digest checks do local disk I/O on each call. They validate installation integrity without loading the models and do not access the network.
- Source originals and content/vector persistence behavior are unchanged. Runtime images, OCR text, and scores remain in process memory; no evaluation collection was introduced.
