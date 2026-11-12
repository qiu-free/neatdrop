import { useEffect, useRef, useState } from 'react'
import { CircleAlert, LoaderCircle, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { api } from '../api'
import type { PersonalRuleDraft, PersonalRulePreview, PersonalRulesListing } from '../personalRuleTypes'
import './personal-rules.css'

type Seed = { fileId: string; category: string; subcategory: string | null }
type Props = {
  workspaceId: string
  jobId?: string | null
  categories: Record<string, string>
  subcategories: Record<string, Record<string, string>>
  extensions?: string[]
  seed?: Seed | null
  onClose: () => void
  onSettings: () => void
  onHelp: (topic: string) => void
}

const blankDraft: PersonalRuleDraft = { name: '', keywords: [], extensions: [], category: '', subcategory: null }
export const personalRuleErrorMessages: Record<string, string> = {
  PERSONAL_RULE_INVALID_NAME: '规则名称需为 1–60 个字符。',
  PERSONAL_RULE_INVALID_KEYWORDS: '请输入 2–5 个不同关键词；每个 2–40 字符，关键词不能相互包含。',
  PERSONAL_RULE_INVALID_EXTENSIONS: '请选择至少一个支持的文件扩展名。',
  PERSONAL_RULE_INVALID_CATEGORY: '请选择有效的目标主类。',
  PERSONAL_RULE_INVALID_SUBCATEGORY: '所选子类不属于当前主类。',
  PERSONAL_RULE_LIMIT: '规则数量或本机规则状态已达到上限，请先删除不再需要的规则。',
  PERSONAL_RULE_STORE_UNAVAILABLE: '规则状态暂时不可用，现有状态已保留。请检查本机权限后重新载入。',
  PERSONAL_RULE_STALE_REVISION: '规则列表已被其他操作更新，请刷新列表后重新预览。',
  PERSONAL_RULE_PREVIEW_UNAVAILABLE: '本次分析结果无法用于规则预览，请重新分析当前目录后再试。',
  PERSONAL_RULE_PREVIEW_LIMIT: '暂时无法建立新的预览，请稍后重试。',
  PERSONAL_RULE_PREVIEW_REQUIRED: '预览凭据已失效，请重新预览后再保存。',
  PERSONAL_RULE_PREVIEW_INVALID: '目录、规则或版本已变化，请刷新规则列表并重新预览。',
  PERSONAL_RULE_ZERO_MATCH: '本次预览没有命中项目，不能启用规则。',
  PERSONAL_RULE_NOT_FOUND: '这条规则已不存在，请刷新规则列表。',
  CONFIRMATION_REQUIRED: '请明确确认后再执行此操作。',
}

function splitValues(value: string) {
  return value.split(/[\n,，]/).map(item => item.trim()).filter(Boolean)
}

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const code = Object.keys(personalRuleErrorMessages).find(value => message.includes(value))
  if (code) return code
  if (message.includes('分析任务无法预览')) return 'PERSONAL_RULE_PREVIEW_UNAVAILABLE'
  if (message.includes('规则预览凭据')) return 'PERSONAL_RULE_PREVIEW_REQUIRED'
  if (message.includes('规则列表已被其他操作更新')) return 'PERSONAL_RULE_STALE_REVISION'
  if (message.includes('本机规则状态暂时不可用')) return 'PERSONAL_RULE_STORE_UNAVAILABLE'
  if (message.includes('没有命中项目')) return 'PERSONAL_RULE_ZERO_MATCH'
  return undefined
}

export function PersonalRulesPanel({ workspaceId, jobId, categories, subcategories, extensions = [], seed, onClose, onSettings, onHelp }: Props) {
  const [listing, setListing] = useState<PersonalRulesListing | null>(null)
  const [draft, setDraft] = useState<PersonalRuleDraft>(blankDraft)
  const [keywordText, setKeywordText] = useState('')
  const [extensionText, setExtensionText] = useState('')
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const writeLock = useRef(false)
  const [preview, setPreview] = useState<PersonalRulePreview | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [validation, setValidation] = useState<string[]>([])
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const errorSummary = useRef<HTMLDivElement>(null)
  const generation = useRef(0)
  const previewJob = useRef<string | null>(null)
  const lastJobId = useRef(jobId)
  const base = `/workspaces/${workspaceId}/classification-rules`
  const available = listing?.available === true && listing.revision !== null
  const subcategoryOptions = draft.category ? subcategories[draft.category] ?? {} : {}
  const matchingJob = !!jobId && preview !== null && previewJob.current === jobId

  useEffect(() => {
    let active = true
    generation.current += 1
    setPreview(null); setConsent(false); setError(''); setNotice('')
    setDraft(seed ? { ...blankDraft, category: seed.category, subcategory: seed.subcategory } : blankDraft)
    setKeywordText(''); setExtensionText(''); setEditingRuleId(null)
    api<PersonalRulesListing>(base).then(value => { if (active) setListing(value) }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '规则列表载入失败。') })
    return () => { active = false; generation.current += 1 }
  }, [base, seed?.fileId, seed?.category, seed?.subcategory])

  useEffect(() => {
    if (lastJobId.current === jobId) return
    lastJobId.current = jobId
    generation.current += 1
    setPreview(null); setConsent(false); setNotice('本次分析任务已变化，请重新预览。')
  }, [jobId])

  const updateDraft = (patch: Partial<PersonalRuleDraft>) => {
    generation.current += 1
    setDraft(current => ({ ...current, ...patch }))
    setPreview(null); setConsent(false); setError(''); setNotice(''); setBusy(false)
  }

  const reload = async () => {
    setBusy(true); setError(''); setPreview(null); setConsent(false); generation.current += 1
    try { setListing(await api<PersonalRulesListing>(base)); setNotice('已刷新本目录规则列表。') }
    catch (reason) { setError(reason instanceof Error ? reason.message : '规则列表载入失败。') }
    finally { setBusy(false) }
  }

  const validate = () => {
    const invalid: string[] = []
    if (!draft.name.trim() || draft.name.trim().length > 60) invalid.push('规则名称需为 1–60 个字符。')
    if (draft.keywords.length < 2 || draft.keywords.length > 5 || draft.keywords.some(word => word.length < 2 || word.length > 40) || new Set(draft.keywords.map(word => word.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim())).size !== draft.keywords.length || draft.keywords.some((word, index) => draft.keywords.some((other, otherIndex) => index !== otherIndex && word.includes(other)))) invalid.push('关键词需为 2–5 个不同词语，每个 2–40 字符，且彼此不能包含。')
    if (!draft.extensions.length) invalid.push('请选择至少一个文件扩展名。')
    if (!draft.category || !Object.hasOwn(categories, draft.category)) invalid.push('请选择有效的目标主类。')
    if (draft.subcategory && !Object.hasOwn(subcategoryOptions, draft.subcategory)) invalid.push('请选择当前主类下的有效子类。')
    return invalid
  }

  const showErrors = (messages: string[]) => {
    setValidation(messages)
    setError(messages.join(' '))
    requestAnimationFrame(() => {
      errorSummary.current?.focus()
      const target = messages[0]?.includes('规则名称') ? 'personal-rule-name' : messages[0]?.includes('关键词') ? 'personal-rule-keywords' : messages[0]?.includes('扩展名') ? 'personal-rule-extensions' : messages[0]?.includes('主类') ? 'personal-rule-category' : 'personal-rule-name'
      document.getElementById(target)?.focus()
    })
  }

  const runPreview = async () => {
    if (!available) return
    if (!jobId) { showErrors(['请先完成当前目录的一次本地离线分析，再预览规则。']); return }
    const invalid = validate()
    if (invalid.length) { showErrors(invalid); return }
    const request = ++generation.current
    setBusy(true); setError(''); setNotice(''); setValidation([]); setPreview(null); setConsent(false)
    previewJob.current = jobId
    try {
      const value = await api<PersonalRulePreview>(`${base}/preview`, {
        job_id: jobId, name: draft.name.trim(), keywords: draft.keywords, extensions: draft.extensions,
        category: draft.category, subcategory: draft.subcategory, ...(editingRuleId ? { rule_id: editingRuleId } : {}),
      })
      if (request !== generation.current) return
      setPreview(value)
      if (!value.matched.length) setNotice('本次预览没有命中项目，规则不能保存或启用。')
    } catch (reason) {
      if (request !== generation.current) return
      const code = errorCode(reason)
      const message = reason instanceof Error ? reason.message : '本机服务没有返回结果'
      setError(code ? personalRuleErrorMessages[code] : `预览暂时未完成：${message} 请确认状态后再主动重试。`)
    } finally { setBusy(false) }
  }

  const commit = async () => {
    if (writeLock.current || busy || !available || !preview || !preview.matched.length || !consent || !matchingJob) return
    writeLock.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      await api(editingRuleId ? `${base}/${editingRuleId}/enable` : base, { preview_token: preview.token, confirmed: true })
      setPreview(null); setConsent(false); setDraft(blankDraft)
      setNotice('规则已保存并启用，下次离线分析生效。')
      setListing(await api<PersonalRulesListing>(base))
    } catch (reason) {
      const code = errorCode(reason)
      setError(code ? personalRuleErrorMessages[code] : `保存结果暂时无法确认：${reason instanceof Error ? reason.message : '本机服务未返回结果'}。请先刷新规则列表核对状态，再决定是否重试。`)
      try { setListing(await api<PersonalRulesListing>(base)) } catch { /* Preserve the first useful recovery message. */ }
      setPreview(null); setConsent(false)
    } finally { writeLock.current = false; setBusy(false) }
  }

  const disable = async (ruleId: string) => {
    if (!available || listing?.revision === null || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await api(`${base}/${ruleId}/disable`, { revision: listing.revision })
      setListing(await api<PersonalRulesListing>(base)); setNotice('规则已停用。')
    } catch (reason) {
      setError(`${errorCode(reason) ? personalRuleErrorMessages[errorCode(reason)!] : `停用结果暂时无法确认：${reason instanceof Error ? reason.message : '本机服务未返回结果'}`} 请刷新列表核对状态。`)
      try { setListing(await api<PersonalRulesListing>(base)) } catch { /* Keep the recovery action visible. */ }
    } finally { setBusy(false) }
  }

  const reenable = async (rule: NonNullable<PersonalRulesListing['rules'][number]>) => {
    updateDraft({ name: rule.name, keywords: [...rule.keywords], extensions: [...rule.extensions], category: rule.category, subcategory: rule.subcategory })
    setKeywordText(rule.keywords.join('\n')); setExtensionText(rule.extensions.join(', ')); setEditingRuleId(rule.id)
    setNotice(`已载入“${rule.name}”的条件；请预览并重新确认后启用。`)
  }

  const remove = async (ruleId: string) => {
    if (!available || listing?.revision === null || writeLock.current || busy) return
    writeLock.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      await api(`${base}/${ruleId}`, { revision: listing.revision, confirmed: true }, undefined, 'DELETE')
      setListing(await api<PersonalRulesListing>(base)); setNotice('规则已删除。'); setDeleteId(null); setDeleting(false)
    } catch (reason) {
      setError(`${errorCode(reason) ? personalRuleErrorMessages[errorCode(reason)!] : `删除结果暂时无法确认：${reason instanceof Error ? reason.message : '本机服务未返回结果'}`} 请刷新列表核对状态。`)
      try { setListing(await api<PersonalRulesListing>(base)) } catch { /* Keep the recovery action visible. */ }
    } finally { writeLock.current = false; setBusy(false) }
  }

  return <section className="personal-rules-panel" aria-labelledby="personal-rules-heading">
    <header className="personal-rules-heading"><div><ShieldCheck size={18} aria-hidden="true" /><h2 id="personal-rules-heading" ref={heading} tabIndex={-1}>当前目录规则</h2></div><button type="button" className="icon-button" aria-label="关闭目录规则" onClick={onClose}>×</button></header>
    <p className="personal-rules-summary">规则只保存在本机，仅供下次本地离线分析产生待复核候选；不会修改当前建议或文件。</p>
    {error ? <div className="personal-rule-error" role="alert" tabIndex={-1} ref={errorSummary}><CircleAlert size={16} /><p>{error}</p></div> : null}
    {notice ? <p className="personal-rule-notice" role="status">{notice}</p> : null}
    {listing && !listing.available ? <div className="personal-rule-unavailable"><p>规则状态暂时不可用。现有状态已保留，当前目录规则以只读方式显示，不能覆盖或修改。</p><button className="button secondary" type="button" onClick={() => void reload()} disabled={busy}><RefreshCw size={15} />重新读取状态</button></div> : null}
    {listing?.available && listing.rules.length ? <ul className="personal-rule-list" aria-label="已保存规则">{listing.rules.map(rule => <li key={rule.id}>
      <div><strong>{rule.name}</strong><span>{categories[rule.category] ?? rule.category}{rule.subcategory ? ` / ${subcategories[rule.category]?.[rule.subcategory] ?? rule.subcategory}` : ''} · {rule.extensions.join('、')}</span><small>全部关键词：{rule.keywords.join('、')}</small></div>
      <span className={`personal-rule-state ${rule.enabled ? 'enabled' : ''}`}>{rule.enabled ? '已启用' : '已停用'}</span>
      <div className="personal-rule-actions">{rule.enabled ? <button className="button secondary" type="button" disabled={busy} onClick={() => void disable(rule.id)}>停用</button> : <button className="button secondary" type="button" disabled={busy || !jobId} onClick={() => void reenable(rule)}>重新预览并启用</button>}<button className="icon-button" type="button" disabled={busy} aria-label={`删除规则：${rule.name}`} onClick={() => { setDeleteId(rule.id); setDeleting(false) }}><Trash2 size={16} /></button></div>
      {deleteId === rule.id ? <div className="personal-rule-confirm" role="group" aria-label={`确认删除规则：${rule.name}`}><p>删除“{rule.name}”？此操作会更新本机规则列表。</p>{deleting ? <span role="status">正在删除…</span> : <><button className="button secondary" type="button" onClick={() => setDeleteId(null)}>取消</button><button className="button danger" type="button" onClick={() => { setDeleting(true); void remove(rule.id) }}>确认删除</button></>}</div> : null}
    </li>)}</ul> : listing?.available ? <p className="personal-rule-empty">这个目录还没有个人分类规则。</p> : null}
    <form className="personal-rule-form" onSubmit={event => { event.preventDefault(); void runPreview() }}>
      <h3>{seed ? '为类似文件建立规则' : '建立个人分类规则'}</h3>
      <label>规则名称<input id="personal-rule-name" aria-label="规则名称" maxLength={60} value={draft.name} disabled={!available || busy} aria-invalid={validation.some(message => message.includes('规则名称')) || undefined} aria-describedby={validation.some(message => message.includes('规则名称')) ? 'personal-rule-name-error' : undefined} onChange={event => updateDraft({ name: event.target.value })} />{validation.some(message => message.includes('规则名称')) ? <span id="personal-rule-name-error" className="personal-field-error">{validation.find(message => message.includes('规则名称'))}</span> : null}</label>
      <label>匹配关键词 <small>每行一个，需同时出现在正文中</small><textarea id="personal-rule-keywords" aria-label="匹配关键词" rows={3} value={keywordText} disabled={!available || busy} aria-invalid={validation.some(message => message.includes('关键词')) || undefined} aria-describedby={validation.some(message => message.includes('关键词')) ? 'personal-rule-keywords-error' : 'personal-rule-keywords-hint'} onChange={event => { setKeywordText(event.target.value); updateDraft({ keywords: splitValues(event.target.value) }) }} />{validation.some(message => message.includes('关键词')) ? <span id="personal-rule-keywords-error" className="personal-field-error">{validation.find(message => message.includes('关键词'))}</span> : <span id="personal-rule-keywords-hint">输入 2–5 个关键词；每个 2–40 字符。关键词按普通文字匹配。</span>}</label>
      <label>文件扩展名 <small>多项以逗号分隔</small><input id="personal-rule-extensions" aria-label="文件扩展名" value={extensionText} disabled={!available || busy} placeholder=".pdf, .docx" aria-invalid={validation.some(message => message.includes('扩展名')) || undefined} aria-describedby={validation.some(message => message.includes('扩展名')) ? 'personal-rule-extensions-error' : undefined} onChange={event => { setExtensionText(event.target.value); updateDraft({ extensions: [...new Set(splitValues(event.target.value).map(value => value.startsWith('.') ? value.toLocaleLowerCase() : `.${value.toLocaleLowerCase()}`))] }) }} />{validation.some(message => message.includes('扩展名')) ? <span id="personal-rule-extensions-error" className="personal-field-error">{validation.find(message => message.includes('扩展名'))}</span> : null}</label>
      <div className="personal-rule-taxonomy"><label>目标主类<select id="personal-rule-category" aria-label="目标主类" value={draft.category} disabled={!available || busy} aria-invalid={validation.some(message => message.includes('主类')) || undefined} onChange={event => updateDraft({ category: event.target.value, subcategory: null })}><option value="">请选择主类</option>{Object.entries(categories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>目标子类<select aria-label="目标子类" value={draft.subcategory ?? ''} disabled={!available || busy || !draft.category} onChange={event => updateDraft({ subcategory: event.target.value || null })}><option value="">仅按主类归档</option>{Object.entries(subcategoryOptions).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
      {seed ? <small>来源：你已人工修正并审核的文件。规则仍需预览和独立确认。</small> : null}
      <button className="button secondary" type="submit" disabled={!available || busy || !jobId}>{busy ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={15} />}预览本次离线分析</button>
    </form>
    {preview ? <section className="personal-rule-preview" aria-label="规则匹配预览"><h3>本次离线分析快照</h3><p>抽样快照仅说明本次已分析文件，不代表整个目录或规则准确率。</p><p>已评估 {preview.evaluated} 项 · 因读取质量或内容不可用排除 {preview.excluded} 项 · 本次范围 {preview.total} 项</p>{preview.matched.length ? <ul>{preview.matched.map(item => <li key={item.file_id}><strong>{item.name}</strong><span>命中：{item.keywords.join('、')}</span></li>)}</ul> : <p className="personal-rule-empty">零命中，不能启用此规则。</p>}</section> : null}
    <label className="personal-rule-consent"><input type="checkbox" checked={consent} disabled={!available || !preview || !preview.matched.length || busy || !matchingJob} onChange={event => setConsent(event.target.checked)} />我同意将这些关键词、扩展名和分类规则持久保存在本机，供之后的离线分析使用。</label>
    <button className="button primary" type="button" disabled={!available || busy || !preview || !preview.matched.length || !consent || !matchingJob} onClick={() => void commit()}>{busy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}启用并保存规则</button>
    <p className="personal-rule-recovery">{jobId ? '当前使用已完成的本地分析任务，不会重新读取文件。' : '完成一次本地离线分析后，才能预览规则。'} <button className="text-button" type="button" onClick={() => { onClose(); onHelp('personal-rules') }}>了解规则预览要求</button>{extensions.length ? <span className="sr-only"> 支持扩展名：{extensions.join(', ')}</span> : null}</p>
    <div className="personal-rule-links"><button className="text-button" type="button" onClick={() => { onClose(); onSettings() }}>查看离线设置</button><button className="text-button" type="button" onClick={() => { onClose(); onHelp('offline-cloud-analysis') }}>查看离线说明</button></div>
  </section>
}
