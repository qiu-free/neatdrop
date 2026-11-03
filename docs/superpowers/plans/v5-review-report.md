# Offline quality v5 review

Reviewed `feat/offline-quality-v5` against `3336fe5`, including untracked implementation, tests, manifest and evaluation runner. Scope: the design spec and plan Tasks 1–2, plus the validity of the development comparison. Review date: 2026-11-04.

**Spec verdict: pass.** The two previously reported input boundaries were fixed and independently rechecked against the current implementation.

**Quality verdict: approved.** No remaining P1/P2 found within the reviewed scope. Both original P2 findings below are closed. Implementation files were not modified by this review.

## Closed P2 findings

1. **Exclude directly negated anchors and missing field values from purpose evidence — resolved.** `backend/neatdrop/classifier.py:79–107` (`negated_at` and `purpose_fields`). The original purpose negation list handled `没有真实` but missed the ordinary direct prefix `没有`; the value filter handled `无`/`没有`/`未知` but missed `暂无` and `不存在`. Real `analyze_local` calls initially produced these results:

   ```text
   input: 没有保修说明\n产品型号：A100\n保修期限：两年
   actual: life/warranty, candidate, review_reasons=[purpose_uncalibrated]

   input: 产品保修说明\n产品型号：不存在\n保修期限：暂无
   actual: life/warranty, candidate, review_reasons=[purpose_uncalibrated]
   ```

   The fix adds direct `没有` anchor negation and `不存在`/`暂无` missing-value filtering, with focused end-to-end regressions. Independent follow-up probes of both original inputs now return `other/unclassified`, `abstain`, and retain `original.txt`. Separate all-`不存在` and all-`暂无` inputs also abstain. An additional input with a negated anchor on one line and an independent positive anchor on another still produces the intended reviewed warranty candidate.

2. **Validate the proposed first-line title independently of whole-document readability — resolved.** `backend/neatdrop/content_quality.py:38–44` and `backend/neatdrop/analysis.py:127–141`. Originally, `readable < 8` applied to the whole document, while the first-line check only rejected replacement/control/private-use characters. A punctuation-only first line therefore inherited an acceptable quality state from the body and became the archive name:

   ```text
   input: ---\n课程笔记\n本节学习矩阵与特征值
   actual: study/notes, ordinary
           quality.state=acceptable, quality.issues=[]
           name=---.txt (original was original.txt)
   ```

   The final naming gate now requires `any(char.isalnum() for char in title)` independently of whole-document quality. Independent follow-up probes confirmed `---`, `***`, `...`, `###`, `#   `, `# ---`, and `---\ntitle: ignored\n---` all retain `original.txt` while preserving `study/notes`, `ordinary`, and `quality=acceptable`. Normal `课程笔记`, `# 课程笔记`, and `### 课程笔记` headings still rename to `课程笔记.txt`.

## Follow-up verification

- Re-read the current implementation diff and the added targeted regressions. Ran 15 independent, assertion-backed real `analyze_local` probes covering both original failures, extra missing-value cases, independent positive evidence, seven unusable title variants, and three valid heading variants. All 15 passed, without mutating their input payloads.
- Rechecked the saved development report fingerprints after the fixes: all four engine hashes (`content_quality.py`, `analysis.py`, `classifier.py`, `decision.py`) match the current workspace.
- The parent task reported 155 v5 tests and 472 full backend tests passing. Those suite counts are parent-provided verification; this reviewer did not rerun either suite or modify implementation code.

## Verified behavior and limits

- Quality is attached before `decide`, and its review reasons survive semantic fallback, so limited/unavailable extraction cannot become ordinary. Low-information image handling clears rule/visual evidence and blocks optional semantic promotion.
- Natural photos and charts with no OCR text remain valid inputs. The current workspace uses `min(scores) < .8`, including retained support fields, rather than only an OCR mean/title check. Invalid/nonfinite scores are filtered, and a minimal mixed valid/NaN score probe serialized successfully with `json.dumps(..., allow_nan=False)`.
- Text diagnostics are capped at 12,000 characters; OCR inspection is capped at 150 retained entries. Input objects are copied at quality application. A 1,000-repeated-label adversarial line completed in approximately 0.12 seconds locally; no material new budget violation found.
- New purposes require an anchor and two different support groups, remain candidate at both classifier and decision layers, preserve generic-image OCR evidence, and disclose template/mixed-purpose review reasons. Empty labels on the following line and same-line recognized-label borrowing have focused protection. Both reported negation boundaries are now covered by implementation and focused regressions.
- Frontend `ContentQuality` safely handles absent/null quality at runtime, unknown state, non-array issues and missing/null/invalid numeric metrics. It renders only safe nonnegative integer counts, keeps them collapsed, and does not expose OCR scores as classification percentages. Inspector changes are limited to the new panel; preview identity, confirmation callbacks and navigation logic are unchanged.
- `check_quality_v5.py` invokes real `analyze_local`, loads classifier/decision/analysis source from `git show 3336fe5`, disables experimental semantic inference in its command entry point, separates legacy/new-purpose/saved-image records, and records source fingerprints. Stored engine hashes matched all four current workspace engine files at review time. Its 88 purpose variants share eight synthetic groups, and its output/documentation correctly avoid presenting them as independent accuracy evidence.
- Review used targeted in-process probes, source/diff inspection and the existing test/evaluation artifacts. The full suites were not rerun by this reviewer; the parent task owns full backend/frontend/build verification.
