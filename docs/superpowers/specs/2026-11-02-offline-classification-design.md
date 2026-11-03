# Offline classification and selection clarity

User approved OCR + lightweight local vision + hierarchical rules on 2026-11-02,
and requested stronger selected-file marking and synchronized details.

## Classification

Keep existing six category IDs and directories for old transaction compatibility.
Add office, life and photos. A fixed server-owned taxonomy defines subcategory IDs
and two-level destination folders. No model-provided paths. Old flat destinations
remain valid for undo. Content form is independent: text_document,
document_image, screenshot, natural_photo, artwork, unknown. Tags allow secondary
meaning but only one primary destination. Missing/conflicting evidence is review.

Use bounded local text samples (up to 12000 characters), Unicode normalization,
weighted title/body/name evidence and field combinations. Negation, quoted or
incidental financial vocabulary must not make lecture notes or reimbursement
instructions into invoices. Filename-only and close competing scores need review.

Images: local Chinese/English RapidOCR ONNX plus quantized CLIP vision/text
encoders with fixed English prompt templates. All files and model tensors stay
local. Initialize from project-local model assets only; inference never downloads.
Model preparation is a separate explicit CLI with HTTPS allowlist and manifest
hash verification. Report missing/error model capabilities honestly, never fall
back to cloud. CLIP similarity is not accuracy. Keep thresholds conservative and
record text/OCR/visual evidence and review reasons. No face identity recognition.
Exclude GPS and EXIF identity from requests. Preview and cloud sampling remain
unchanged; local OCR/text/metadata never leak into the cloud adapter payload.

## UI

Preserve the current sage/forest design, improve text size and contrast. Separate
currently inspected file (dark left rail, stronger background, '正在查看') from
checked batch items (checkbox + pale background + count). Clicking any non-control
part of a row opens details without changing batch membership. Checking a file
also opens its details. Keyboard Enter/Space opens the row. Arrow navigation is
available in the detail header. Do not disable row viewing during analysis.

One shared visible-file filter governs rows and the active detail. If search/filter
hides active file, show the first visible file or an empty detail, never an invisible
stale file. Detail preview requests are abortable and identity-keyed; old results
cannot show under a new name. Detail shows form, category/subcategory, evidence,
review reason and local engine status. Editing updates that file only.
Use a bounded vertically scrolling file panel, sticky desktop detail, readable
full filename tooltips; mobile stacks detail and offers a jump-to-detail link.

## Verification

Red/green tests for taxonomy consistency, competing rules, weak filename evidence,
OCR engine output, visual ambiguity, no-network inference, new nested path safety
and old undo compatibility. UI tests for row activation, checkbox activation,
rapid preview switching and filter/active reconciliation. Run real local OCR and
vision on synthetic and authorized public fixtures with network access disabled.
Report fixture scope, not a claimed production accuracy. Browser desktop/mobile
flow includes row clicks, checkbox, search, rapid switching, keyboard and copy/undo.
