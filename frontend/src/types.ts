import snapshot from './taxonomy.generated.json'
export type Category = keyof typeof snapshot.taxonomy
export interface TaxonomyGroup { label: string; directory: string; subcategories: Record<string, string>; descriptions?: Record<string, string> }
export type Taxonomy = Partial<Record<Category, TaxonomyGroup>>
export const categories = Object.fromEntries(Object.entries(snapshot.taxonomy).map(([id, group]) => [id, group.label])) as Record<Category, string>
export const subcategories = Object.fromEntries(Object.entries(snapshot.taxonomy).map(([id, group]) => [id, group.subcategories])) as unknown as Record<Category, Record<string, string>>
export const contentForms: Record<string, string> = snapshot.content_forms
export const reviewReasons: Record<string, string> = {
  insufficient_evidence: '内容证据不足', weak_evidence: '证据较弱', filename_only: '仅有文件名线索',
  competing_categories: '存在相互接近的分类', example_context: '可能是教程或引用示例，不是真实票据',
  visual_ambiguous: '图像场景候选接近', vision_unavailable: '缺少可用视觉证据',
  competing_subcategories: '二级分类候选接近', main_category_only: '主分类已有依据，二级分类待确认',
  sampling_incomplete: '文件未完整读取', sampling_truncated: '文件仅作局部抽样', budget_exhausted: '已达到本地处理预算',
  semantic_uncalibrated: '语义线索尚未完成分类质量校准', semantic_unavailable: '本地语义能力不可用',
  structure_uncalibrated: '结构线索需要人工复核', conflicting_evidence: '用途证据存在冲突',
  subtype_ambiguous: '二级分类候选接近', engine_disagreement: '各引擎的用途线索不一致',
  partial_content: '文件未完整读取', semantic_partial: '语义分析仅覆盖部分内容',
  engine_incomplete: '部分识别能力未完成', unsafe_title: '标题不宜自动用于命名',
  visual_type_uncalibrated: '图表或结构类型尚未校准，请核对',
  visual_purpose_uncalibrated: '内容类型已有线索，归档用途需要你确认',
  visual_type_ambiguous: '多个图表类型相近，请确认具体类型',
  content_quality_limited: '提取内容质量受限，请结合原文件核对',
  ocr_quality_limited: '部分图片文字识别不够可靠',
  purpose_uncalibrated: '此用途为新增识别候选，需要人工确认',
  title_only: '目前仅有标题线索，正文缺少独立支持',
  required_fields_missing: '缺少可核对的关键字段，请结合原文件确认',
}
export type Page = 'workbench' | 'library' | 'graph' | 'history' | 'help'
export type Filter = 'all' | 'unreviewed' | 'review' | 'failed' | 'selected'
export interface FileRecord {
  id: string; name: string; size: number; modified: number; extension: string
  supported: boolean; reason: string; sha256: string | null
}
export interface Workspace { id: string; name: string; path: string; files: FileRecord[] }
export type DecisionLevel = 'ordinary' | 'candidate' | 'abstain'
export interface ClassificationCandidate {
  category: Category; subcategory: string | null; score?: number; evidence?: string
}
export interface EvidenceLocation {
  page?: number; start?: number; end?: number; box?: number[] | number[][]
  slide?: number; sheet?: string; cell?: string; row?: number; paragraph?: number; table?: number
}
export interface EvidenceItem extends EvidenceLocation {
  source: string; text: string; location?: EvidenceLocation
}
export interface Sampling {
  kind: string; truncated: boolean; budget_exhausted: boolean
  segments: (EvidenceLocation & Record<string, unknown>)[]; summary: string
}
export interface ContentQualityReport {
  state: 'acceptable' | 'limited' | 'unavailable'
  issues: string[]
  summary: string
  metrics: { text_chars?: number; readable_chars?: number; replacement_chars?: number; ocr_lines?: number; ocr_mean_confidence?: number }
}
export interface Suggestion {
  file_id: string; name: string; category: Category; evidence: string
  review_required: boolean; provider: string; sample: string
  subcategory?: string | null; content_form?: string; tags?: string[]; review_reasons?: string[]
  evidence_items?: EvidenceItem[]; engine_warnings?: string[]
  decision_level?: DecisionLevel; candidates?: ClassificationCandidate[]; sampling?: Sampling
  engine_versions?: Record<string, string | number | null>
  quality?: ContentQualityReport
  personal_rule_matches?: { id: string; name: string; keywords: string[] }[]
  personal_rule_evidence?: string
}
export interface Edit { file_id: string; name: string; category: Category; subcategory?: string | null }
export interface PlanItem {
  file_id: string; source: string; target: string; sha256: string
  size: number; stage: string; error?: string | null
}
export interface Plan { id: string; digest: string; created: string; mode: string; items: PlanItem[] }
export interface Transaction {
  id: string; created: string; mode: string; items: PlanItem[]; status: string; acknowledged: boolean
  undo_verified?: boolean; legacy_read_only?: boolean
}
export interface Job {
  id: string; status: string; processed: number; total: number; mode: string
  results: Suggestion[]; errors: { file_id: string; code: string }[]
  current_file?: string | null; phase?: string | null
  endpoint?: string; config_version?: string | number
}
export interface ExecutionSnapshot {
  plan_id: string; status: string; processed: number; total: number; current_file: string | null
  items: PlanItem[]; error?: string | null; transaction?: Transaction | null
}
export interface ModelBinding { endpoint?: string; config_version?: string | number }
export interface SemanticCapability {
  available: boolean; name: string; state: string; version: string | null; integrity_check: string; enabled?: boolean
}
export interface Config {
  model: { configured: boolean; text_model: string; vision_model: string; max_requests_per_batch: number; endpoint?: string; config_version?: string | number }
  categories: Record<Category, string>; undo_supported: boolean; execution_supported: boolean; demo_path: string
  taxonomy?: Taxonomy; content_forms?: Record<string, string>
  supported_extensions?: string[]
  offline?: { ocr: { available: boolean; name: string }; vision: { available: boolean; name: string }; semantic?: SemanticCapability; scanned_pdf?: { available: boolean; enabled: boolean; name: string }; network_required: boolean }
}
export interface Preview { text?: string; image?: string; sample: string; truncated?: boolean; sampling?: Sampling }
export interface LibraryItem {
  root_id?: string; source_alias?: string; original_entry_id?: string; workspace_id?: string
  id: string; transaction_id: string; name: string; source: string; target: string
  category: Category; subcategory: string | null; created: string; size: number
  availability: 'available' | 'missing' | 'changed' | 'unverified'
}
export interface LibraryListing { items: LibraryItem[]; truncated: boolean }
