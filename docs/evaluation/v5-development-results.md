# v5 deterministic development regression — 2026-11-04

This checklist is synthetic development regression, not an independent accuracy benchmark or calibration. Eight purpose groups generate related variants; the 88 variants are not 88 independent examples. No user files, cloud services, new models, model downloads, or native model inference were used by this command.

```powershell
.\.venv\Scripts\python.exe scripts/evaluation/check_quality_v5.py
```

The command runs the actual `analyze_local` path with experimental semantics disabled. The comparison loads frozen classifier, decision and analysis modules from local Git baseline `3336fe5`, while sharing unchanged extraction/safety dependencies. Source and manifest SHA-256 fingerprints are recorded in `v5-development-results.json`; the separate manifest is `v5-development.json`. The old 40-scenario `development.json` is unchanged.

| Scope | Observed count / behavior |
|---|---|
| Eight purpose groups × eleven related variants | 88 checks satisfied |
| Positive text and simulated retained-OCR cases | 16 matching reviewed candidates; baseline had no matching purpose |
| Ordinary suggestions selecting a new purpose | 0 |
| Filename-only, title-only, one group, negated anchor/fields, empty fields | 48 cases did not select the new purpose |
| Tutorials/templates | 16 cases require review and expose example context |
| Legacy contract mixed with new purpose | 8 cases require review and expose competing evidence |
| Quality fixtures | 9 checks satisfied |
| Existing 40 text scenarios | 0 label, decision-level or original-name-policy changes; 22 ordinary, 11 candidate, 7 abstain |
| Saved v4 image payload replay | 12 records, 0 label/form changes; quality acceptable for all 12 |

The quality cases show garbled notes and a low-score retained-OCR invoice changing from ordinary to candidate and preserving the original filename. Short anchored notes also become candidate. A partial text sample remains candidate and now preserves its original filename. A photo with no OCR remains ordinary; a chart with no OCR remains a reviewed chart candidate. A blank image and empty text remain abstentions. A photo with four incidental OCR characters remains a photo, but quality becomes limited and the suggestion requires review.

The 12 saved image records contain previously recorded OCR text, top-three visual scores and warnings. This run replays those payloads; it does not rerun OCR/CLIP or reconstruct missing line scores/coverage. No OCR confidence metric is invented. These records cannot demonstrate new extraction quality or measured image accuracy.

The rules require an explicit content anchor and two distinct nonempty field groups on the same lines as their values. Repeated synonyms count once. Blank/only-punctuation/missing/negated values do not support a purpose. Eight new purposes always require review, including when the decision layer receives a lost upstream review bit. Worded fields, nonstandard layouts, context-sensitive negation and document truth remain outside what these lexical development checks establish.

Quality checks inspect existing bounded extraction only: at most 12,000 characters and 150 OCR lines. A readable character is a Unicode letter/number; fewer than eight triggers text limitation. Replacement/private-use/control/unassigned character density, or a damaged first nonempty line, triggers garbling. Any valid retained OCR score below 0.8 requires review, while the mean is a diagnostic value rather than classification correctness. Existing OCR already filters scores below 0.65, so discarded lines cannot be diagnosed here. Partial sampling stays a separate existing field. All limited/unavailable quality states preserve the original name.
