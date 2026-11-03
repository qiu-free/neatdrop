# Task 2 semantic delivery report — 2026-11-03

Implemented `backend/neatdrop/semantic.py`, `backend/neatdrop/classification_profiles.json`, `scripts/prepare_semantic.py`, and `backend/tests/test_semantic.py`. No dependency versions changed. The semantic engine only emits review candidates. Its usefulness has not been validated on a representative independent corpus; the root integration keeps it behind the explicit experimental `NEATDROP_SEMANTIC_CANDIDATES=1` gate.

## Interfaces and failure behavior

- `classify_semantic(text: str, cancelled=None) -> dict` and `SemanticEngine(model_dir=...).classify(...)` return `candidates` (at most three `{category, subcategory, score, evidence, chunk_scores}`), `warnings`, `version`, and `truncated`. Successful inference additionally returns `token_sampling` with selected token spans, total tokens, six-chunk limit, 384-token limit including special tokens, and 48-token maximum overlap. Spans refer to the bounded semantic text, not original PDF pages or character positions. `chunk_support` retains up to three candidates per sampled section and a disagreement flag; different supported top labels produce `semantic_chunk_conflict`.
- `semantic_status()` and `SemanticEngine.status(cancelled=None)` return `available`, `name`, `state`, `version`, `integrity_check`, `quality='candidate_only'`, and `network_required=False`. `ready` / `available=True` / `integrity_check='verified'` require trusted manifest comparison, byte sizes and SHA256 verification, tokenizer validation, actual CPU ONNX execution, finite normalized 512-dimensional output, and the network-guard selftest. File existence alone never reports ready. Valid states are `missing`, `checking` (during synchronous validation), `ready`, `self_test_failed`, and `budget_limited`.
- Missing/unreadable/corrupt/unknown packages return empty candidates and explicit warnings; filesystem permission errors degrade instead of escaping into the API. Stat/size/ctime/mtime changes invalidate previously cached status. The child rechecks byte hashes on every inference. No document embeddings or contents are cached to disk.
- Cancellation is checked while waiting for the one-worker lock and every 100 ms during native work; timeout/cancellation kills and reaps the owned worker process. A cancelled request returns `semantic_cancelled`. Native timeouts return `semantic_budget_exhausted`. The 12-second call deadline starts before lock acquisition and is shared across first-use status/selftest and inference. Standalone status has its own 12-second deadline. Lock contention cannot enqueue indefinitely.

## Model and preparation provenance

The installed optional package is `models/bge-small-zh-v1.5`; installation was explicitly invoked with:

```powershell
.\.venv\Scripts\python.exe scripts/prepare_semantic.py --mirror --accept-license
```

Selected source: [Xenova/bge-small-zh-v1.5](https://huggingface.co/Xenova/bge-small-zh-v1.5/tree/75c43b069aac4d136ba6bc1122f995fedcfd2781), fixed revision `75c43b069aac4d136ba6bc1122f995fedcfd2781`. Original model: [BAAI/bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5/tree/7999e1d3359715c523056ef9478215996d62a620), fixed revision `7999e1d3359715c523056ef9478215996d62a620`. License is MIT, explicitly declared in the pinned upstream model card included as `UPSTREAM_README.md`. The pinned upstream `1_Pooling/config.json` is included as `pooling_config.json`; it declares CLS true and mean false. The model card uses `model_output[0][:, 0]` and L2 normalization. Inputs use symmetric similarity, without the short-query retrieval instruction. No E5 model or mismatched pooling is used.

Hub `?blobs=true` metadata supplied the ONNX LFS SHA256 and Git blob identities for small files. Small-file SHA256 values below were computed only after their contents matched those metadata Git blob identities (stored beside trusted hashes in code). HTTPS Hugging Face access timed out both normally and after required escalation; the explicit HTTPS mirror succeeded. The mirror cannot select alternative bytes because every expected hash and fixed revision is embedded in the runtime trust table.

| File | Bytes | SHA256 |
| --- | ---: | --- |
| `onnx/model_quantized.onnx` | 24,010,842 | `15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc` |
| `tokenizer.json` | 439,125 | `48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26` |
| `tokenizer_config.json` | 367 | `e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a` |
| `special_tokens_map.json` | 125 | `b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3` |
| `config.json` | 716 | `d4193ead3a810fd694fa8a31d7fc72fbaebc0668b603e398734bf2f6538ff42f` |
| `README.md` | 1,057 | `cb22054df1a98f7ee9d5b281d023e67c27cc316e1733baf03fc994d95c3048ab` |
| `UPSTREAM_README.md` | 27,670 | `c48a4eeea77f6b1d38b48ec1c5b8d4f86d5550cc43fa345a0db1b2ca1d082369` |
| `pooling_config.json` | 190 | `aaa8861589f80c961a03cc86c7eeaef7605c1676b9ab55329d33a304738769c6` |

Package total including the 1,122-byte exact manifest is **24,481,214 bytes (23.35 MiB)**. Runtime version is `bge-small-zh-v1.5-int8-75c43b0/profiles-1`. Classification profile SHA256 is `9fd0b7d745a07563ef6c5bc62effe404d98a268eee18e08d7566afa01300da5a`.

Preparation/import validates safe relative paths, excludes symlinks/junctions, uses only trusted filenames, permits HTTPS on a fixed host allowlist, checks each redirect (maximum five), caps each decoded file to its exact expected size and the whole package to 32 MiB, acknowledges the license, stages beside the destination, verifies hashes and a real CPU selftest, then publishes by rename. Existing installations are verified and retained; a damaged existing directory is never silently replaced. Local import requires the exact known manifest, never uses its values to redefine trust, and does not unpack archives. It reads trusted files through pinned directories and no-follow locked handles, copies the resulting verified bytes, and creates the exact trusted manifest. Successful real local import and failure-without-publish paths were exercised.

After independent review, model loading was hardened against concurrent path replacement: all Windows ancestors/package directories stay pinned while no-follow deny-write/delete file handles produce bounded immutable byte buffers. Hashes are checked on those bytes. ONNX Runtime receives model bytes and the tokenizer receives the verified UTF-8 string; neither reopens a checked filename. The original supplied model root is retained until link checks complete. A coordinated regression swaps ONNX and tokenizer files after the verified read and proves native inference still consumes the trusted bytes.

## Runtime budgets, privacy and network evidence

The parent bounds input to 12,000 characters using head/middle/tail before sending it through an anonymous pipe. The real tokenizer supplies token windows. At most six windows, each at most 384 tokens including `[CLS]` and `[SEP]`, cover head/middle/tail; adjacent overlap never exceeds 48 tokens and omitted token gaps set `truncated=True`.

ONNX uses only `CPUExecutionProvider`, two intra-op threads, one inter-op thread, sequential execution and a single model per disposable worker. A Windows Job Object imposes a **1.5 GiB per-process committed-memory limit** (POSIX uses `RLIMIT_AS`). Failure to establish the hard limit fails the worker. No retry loop relaxes the deadline. Windows virtual-environment `python.exe` proved to be a launcher creating another process; the implementation therefore invokes `sys._base_executable` with `-I -S` and the current environment's explicit dependency directory. A real regression proves the owned process PID equals the actual ONNX worker PID, so termination targets native inference.

The child environment is minimized and excludes credentials, disables HF/Transformers online mode, and installs a Python audit hook that rejects all socket/DNS operations and subprocess creation. The selftest actually attempts socket creation, requires its denial, then runs the real ONNX model. All recorded real inference ran with this guard active. Runtime imports no HTTP client/downloader and never reads URLs from document content.

**Evidence limitation:** this is an application-level socket prohibition with verified fixed CPU ONNX code. No OS firewall rule or packet capture was installed; this report does not claim that arbitrary native-library outbound traffic was independently monitored or that an OS-level air-gap acceptance test was completed. The root final validation should retain that distinction.

The ordinary runtime stores no document text, tokens or vectors on disk. Only the public model package and class definitions persist. Parent-child request and result are bounded in-memory pipes; worker diagnostics never include the request text.

## Profiles, candidate guards and measured quality limits

All 35 authoritative taxonomy IDs have definitions, positive/negative examples, necessary structure, confusing labels, and support status. The 33 meaningful subcategories are `candidate_only`; `other/unclassified` and `photos/unsorted_photo` are explicitly excluded fallback entries. Taxonomy mismatches or malformed support metadata are rejected. A necessary-purpose eligibility gate now suppresses non-study tutorial/negation text and requires explicit evidence for invoice, medical, identity, wallpaper, photos, board, work notes, temporary code and queue candidates. These are conservative exclusions, not independently calibrated proof or a promise to detect every paraphrase. Real reviewer probes about wallpaper tutorials and a medical teaching example returned no candidates after this change.

Ranking compares positive profile embeddings and negative-example embeddings against every sampled document window. It uses the mean across windows, not the strongest window. Engineering guards require mean positive cosine at least **0.53** and positive-minus-negative mean at least **0.02**. These constants were selected on 12 hand-authored development probes; they are not calibrated thresholds or evidence of accuracy. Score is an embedding metric, never a probability.

Before guards, random text, a short story, a greeting and a Python snippet produced best scores 0.407, 0.384, 0.373 and 0.512; the guards made all four abstain. A Chinese mathematical note yielded 0.557, an English research abstract 0.661, a medical report 0.706, a contract 0.738, an activity notice 0.810 and an invoice 0.823. These probes establish mechanical feasibility only. Before the reviewed purpose gates, the invoice tutorial's invoice candidate was filtered but incorrect order/travel candidates remained; reimbursement instructions still produced a reimbursement candidate. Later purpose exclusions address explicit tutorial/negation forms without changing the similarity floor. No threshold tuning was made against the 40-fixture evaluation.

The root evaluation `docs/evaluation/2026-11-03-development-report.json` has 40 synthetic development fixtures and 35 explicitly labeled cases. Enhanced rules and semantic fusion both achieved 31/35 Top-1 and 31/35 Top-3, versus baseline 29/35. Semantic fusion reduced abstentions from seven to three while adding wrong candidates, without increasing hits. Reported ordinary count/error stayed 23/0 because semantic suggestions remain review-only. This provides **no measured semantic gain**, so the prepared model remains an explicitly enabled experiment. It does not validate all 33 candidate profiles, production accuracy, quantization equivalence, or an independent frozen set.

## CPU measurements and verification

Machine: Windows 11 build 26300, AMD64 Family 25 Model 97 Stepping 2, 32 logical processors. Python 3.12.14; existing ONNX Runtime 1.31.1, tokenizers 0.23.3 and NumPy 2.5.4 retained.

After direct worker ownership and verified-byte loading were fixed, initial package integrity plus real selftest took **0.916 s**. Five sequential fresh-worker invoice calls, including model loading, document encoding and all positive/negative class encodings, took **1.114, 1.123, 1.143, 1.121, 1.136 s** (median **1.123 s**, observed max **1.143 s**). A 12,000-character sampled six-window input took **1.487 s**. Small sample counts do not establish a stable production P95.

Local Windows process counters sampled every 10 ms measured worker peak working set **212,750,336 bytes (202.89 MiB)** and peak committed memory **237,568,000 bytes (226.56 MiB)** for the six-window input. Short calls peaked around 141 MiB working set / 155 MiB committed. These are observed worker peaks, not parent-plus-process-tree peak measurements. A real subprocess deliberately allocating beyond the 1.5 GiB limit received `MemoryError`. Category embeddings are recomputed per request; measured cost fits the initial short-text target, so this version avoids a persistent vector cache.

Final semantic verification command (Windows ACLs require escalation for pytest temporary directories and installed package reads):

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests/test_semantic.py -q -p no:cacheprovider --basetemp .cache/semantic-test-14
```

**Result: 40 passed in 13.32 s.** Coverage includes taxonomy/profile consistency, fallback exclusion, unknown/missing/corrupt/unreadable packages, status invalidation, incomplete selftest denial, actual tokenizer chunk bounds and tail coverage, CLS pooling, negative/floor abstention, mean-not-max aggregation, hard timeout and cancellation process termination, total lock-wait deadline, safe download paths/redirects/size bounds, failed and successful local import, real CPU invoice classification, real out-of-scope abstention, real six-window truncation, native worker process ownership, verified-byte loading despite coordinated path replacement, section disagreement, necessary-purpose exclusions, and an actual over-cap allocation denial. Earlier red runs demonstrated the missing implementation, abstention/cancellation failures, incomplete-selftest acceptance, unbounded lock wait and absent purpose gates before their fixes.
