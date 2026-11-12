import snapshot from '../taxonomy.generated.json'
import type { Category, Config, Edit, ExecutionSnapshot, Job, LibraryItem, Plan, Preview, Transaction, Workspace } from '../types'
import type { GraphJob, GraphListing, GraphRelation } from '../graphTypes'
import { experienceFiles, EXPERIENCE_PATH, IMPORT_PATH, type ExperienceFile } from './dataset'
import { runTextTask } from './workerClient'
import { explain } from '../apiMessages'

type AnalysisTask = { state: Job; files: string[]; controller: AbortController; inFlight?: Promise<void> }
const clone = <T,>(value: T): T => structuredClone(value)
const fail = (code: string): never => { throw new Error(explain(code)) }
const identifier = () => crypto.randomUUID().replaceAll('-', '')
const utf8Size = (text: string) => new TextEncoder().encode(text).length
const categories = snapshot.taxonomy
function destination(category: Category, subcategory?: string | null) {
  const group = categories[category]
  if (!group || subcategory && !(subcategory in group.subcategories)) return fail('INVALID_CATEGORY')
  return `体验资料库/${group.label}${subcategory ? '/' + (group.subcategories as Record<string, string>)[subcategory] : ''}`
}

export function createExperienceEngine() {
  let source = clone(experienceFiles), workspace: Workspace | null = null
  let transactions: Transaction[] = [], entries: LibraryItem[] = [], manual: GraphRelation[] = [], automatic: GraphRelation[] = []
  let revision = 0, indexed = new Set<string>(), updated: string | null = null
  const plans = new Map<string, { plan: Plan; used: boolean; expires: number }>()
  const executions = new Map<string, ExecutionSnapshot>(), tasks = new Map<string, AnalysisTask>()
  const graphTasks = new Map<string, { state: GraphJob; ids: string[]; revision: number; controller: AbortController }>()
  const bodies = new Map<string, ExperienceFile>()
  const dismissed = new Set<string>()

  const getSource = (id: string) => source.find(file => file.id === id) ?? fail('WORKSPACE_NOT_FOUND')
  const getEntry = (id: string) => entries.find(item => item.id === id) ?? fail('GRAPH_ENTRY_NOT_FOUND')
  const listing = (): GraphListing => ({ items: clone(entries), relations: clone([...manual, ...automatic].filter(edge => entries.some(item => item.id === edge.source) && entries.some(item => item.id === edge.target))), truncated: false, index: { count: indexed.size, revision, updated, state: indexed.size ? 'ready' : 'empty', issues: [] } })
  const preview = (file: ExperienceFile): Preview => ({ text: file.text, image: file.image, sample: file.prerecorded ? '合成样例的真实本地 OCR 预录记录；网页不运行图片识别，也不证明模型准确率。' : '浏览器内存文本；不连接服务。' })
  function resetJobs() { tasks.forEach(task => task.controller.abort()); graphTasks.forEach(task => task.controller.abort()); tasks.clear(); graphTasks.clear(); plans.clear(); executions.clear() }
  function installFiles(files: ExperienceFile[]) { resetJobs(); source = clone(files); workspace = null; transactions = []; entries = []; manual = []; automatic = []; indexed = new Set(); updated = null; revision++; bodies.clear(); dismissed.clear() }
  function reset() { installFiles(experienceFiles) }
  const config = (): Config => ({
    model: { configured: false, text_model: '', vision_model: '', max_requests_per_batch: 0 },
    categories: Object.fromEntries(Object.entries(categories).map(([id, group]) => [id, group.label])) as Config['categories'],
    taxonomy: categories, content_forms: snapshot.content_forms, demo_path: EXPERIENCE_PATH,
    execution_supported: false, undo_supported: false, supported_extensions: ['.txt', '.md'],
    offline: { ocr: { available: false, name: '网页不运行 OCR' }, vision: { available: false, name: '网页不运行图像模型' }, network_required: false },
  })

  async function handle(path: string, body?: unknown, signal?: AbortSignal, method: 'GET' | 'POST' | 'DELETE' = body === undefined ? 'GET' : 'POST'): Promise<unknown> {
    signal?.throwIfAborted()
    try { path = path.split('/').map(part => decodeURIComponent(part)).join('/') } catch { return fail('INVALID_REQUEST') }
    const input = (body ?? {}) as Record<string, any>
    if (path === '/config' && method === 'GET') return clone(config())
    if (path === '/pick-directory') throw new Error('网页不能选择本机目录，请载入样例或主动选择文本文件。')
    if (path === '/workspaces' && method === 'POST') {
      if (input.path === EXPERIENCE_PATH) source = clone(experienceFiles)
      resetJobs()
      workspace = { id: identifier(), name: '学习资料 · 网页体验', path: EXPERIENCE_PATH, files: source.map(file => ({ id: file.id, name: file.name, extension: /\.[^.]+$/.exec(file.name)?.[0] ?? '.txt', size: utf8Size(file.text ?? ''), modified: 0, supported: !file.prerecorded, reason: file.prerecorded ? 'WEB_RECORDED_PREVIEW' : '', sha256: null })) }
      if (input.path === IMPORT_PATH) { workspace.path = IMPORT_PATH; workspace.name = '自选文本 · 网页体验' }
      transactions = []; entries = []; manual = []; automatic = []; indexed.clear(); bodies.clear(); dismissed.clear(); updated = null; revision++
      return clone(workspace)
    }
    if (path === '/analysis-jobs' && method === 'POST') {
      if (!workspace || input.workspace_id !== workspace.id) return fail('WORKSPACE_NOT_FOUND')
      if (input.mode !== 'local') throw new Error('网页体验只在浏览器分析文本，不调用云端。')
      const ids = input.file_ids as string[]
      if (!Array.isArray(ids) || !ids.length || ids.length > 50 || new Set(ids).size !== ids.length || ids.some(id => !workspace!.files.some(file => file.id === id && file.supported))) return fail('FILE_COUNT_LIMIT')
      if ([...tasks.values()].some(task => ['running', 'queued'].includes(task.state.status))) return fail('ANALYSIS_BUSY')
      plans.clear()
      const state: Job = { id: identifier(), status: 'queued', processed: 0, total: ids.length, mode: 'local', results: [], errors: [], current_file: null, phase: 'queued' }
      tasks.set(state.id, { state, files: [...ids], controller: new AbortController() })
      return clone(state)
    }
    const analysis = /^\/analysis-jobs\/([^/]+)(\/cancel)?$/.exec(path)
    if (analysis) {
      const task = tasks.get(analysis[1]); if (!task) return fail('JOB_NOT_FOUND')
      if (analysis[2] && method === 'POST') { task.controller.abort(); task.state.status = 'cancelled'; task.state.current_file = null; return clone(task.state) }
      if (method !== 'GET') throw new Error('网页体验版不支持此操作。')
      if (!task.inFlight && ['queued', 'running'].includes(task.state.status)) task.inFlight = (async () => {
        task.state.status = 'running'; task.state.phase = 'classifying'
        while (task.state.processed < task.files.length) {
        const file = getSource(task.files[task.state.processed]); task.state.current_file = file.name
        try {
          const value = await runTextTask('classify', { id: file.id, name: file.name, text: file.text ?? '' }, task.controller.signal)
          task.controller.signal.throwIfAborted()
          task.state.results.push(value); task.state.processed++
        } catch (error) {
          if (task.controller.signal.aborted) { task.state.status = 'cancelled'; task.state.current_file = null; return }
          task.state.errors.push({ file_id: file.id, code: 'BROWSER_ANALYSIS_FAILED' }); task.state.processed++
        }
        if (task.state.processed === task.files.length) { task.state.status = 'completed'; task.state.phase = 'completed'; task.state.current_file = null }
        }
      })().finally(() => { task.inFlight = undefined })
      await task.inFlight
      signal?.throwIfAborted()
      return clone(task.state)
    }
    const route = /^\/workspaces\/([^/]+)(.*)$/.exec(path)
    if (!route) throw new Error('网页体验版不支持此操作。')
    if (!workspace || route[1] !== workspace.id) return fail('WORKSPACE_NOT_FOUND')
    const suffix = route[2]
    if (suffix === '/files' && method === 'GET') return clone(workspace.files)
    const filePreview = /^\/files\/([^/]+)\/preview$/.exec(suffix)
    if (filePreview && method === 'GET') return preview(getSource(filePreview[1]))
    if (suffix === '/transactions' && method === 'GET') return clone(transactions)
    if (suffix === '/plans' && method === 'POST') {
      const edits = input.edits as Edit[]
      if (!Array.isArray(edits) || !edits.length || edits.length > 50 || new Set(edits.map(row => row.file_id)).size !== edits.length) return fail('INVALID_REQUEST')
      const used = new Set(entries.map(entry => entry.target.toLocaleLowerCase()))
      const items = edits.map(edit => {
        const file = getSource(edit.file_id), originalExtension = /\.[^.]+$/.exec(file.name)?.[0]
        if (file.prerecorded || !edit.name || edit.name.length > 150 || /[<>:"/\\|?*\x00-\x1f]/.test(edit.name) || /[. ]$/.test(edit.name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(edit.name) || /\.[^.]+$/.exec(edit.name)?.[0] !== originalExtension) return fail('INVALID_NAME')
        const folder = destination(edit.category, edit.subcategory)
        let name = edit.name, counter = 2
        while (used.has(`${folder}/${name}`.toLocaleLowerCase())) { name = `${edit.name.slice(0, -(originalExtension?.length ?? 0))} (${counter++})${originalExtension}` }
        const target = `${folder}/${name}`; used.add(target.toLocaleLowerCase())
        return { file_id: file.id, source: file.name, target, sha256: '', size: utf8Size(file.text ?? ''), stage: 'planned' }
      })
      const plan: Plan = { id: identifier(), digest: identifier(), created: new Date().toISOString(), mode: 'browser-memory', items }
      plans.clear(); plans.set(plan.id, { plan: clone(plan), used: false, expires: Date.now() + 900000 })
      return plan
    }
    if (suffix === '/execute' && method === 'POST') {
      const saved = plans.get(input.plan_id)
      if (!saved || saved.used || saved.expires < Date.now() || saved.plan.digest !== input.digest || input.confirmed !== true) return fail('PLAN_INVALID_OR_EXPIRED')
      signal?.throwIfAborted(); saved.used = true
      const transaction: Transaction = { id: saved.plan.id, created: saved.plan.created, mode: 'browser-memory', items: saved.plan.items.map(item => ({ ...item, stage: 'completed' })), status: 'completed', acknowledged: false, undo_verified: true }
      for (const item of transaction.items) {
        const file = getSource(item.file_id), id = `entry-${transaction.id}-${item.file_id}`
        const parts = item.target.split('/'), category = Object.entries(categories).find(([, group]) => group.label === parts[1])?.[0] as Category
        const subcategory = Object.entries(categories[category].subcategories).find(([, label]) => label === parts[2])?.[0] ?? null
        entries.push({ id, transaction_id: transaction.id, name: parts.at(-1)!, source: item.source, target: item.target, category, subcategory, created: transaction.created, size: item.size, availability: 'available' }); bodies.set(id, clone(file))
      }
      transactions.unshift(transaction)
      const result: ExecutionSnapshot = { plan_id: saved.plan.id, status: 'completed', processed: transaction.items.length, total: transaction.items.length, current_file: null, items: clone(transaction.items), transaction: clone(transaction) }
      executions.set(saved.plan.id, clone(result)); return result
    }
    const execution = /^\/executions\/([^/]+)$/.exec(suffix)
    if (execution && method === 'GET') return clone(executions.get(execution[1]) ?? fail('EXECUTION_STATUS_NOT_FOUND'))
    const history = /^\/transactions\/([^/]+)\/(undo|acknowledge)$/.exec(suffix)
    if (history && method === 'POST') {
      if (input.confirmed !== true) return fail('CONFIRMATION_REQUIRED')
      const transaction = transactions.find(item => item.id === history[1]); if (!transaction) return fail('UNTRUSTED_HISTORY')
      if (history[2] === 'undo') { transaction.status = 'undone'; transaction.items.forEach(item => { item.stage = 'undone' }); const removed = entries.filter(entry => entry.transaction_id === transaction.id).map(entry => entry.id); entries = entries.filter(entry => entry.transaction_id !== transaction.id); removed.forEach(id => { indexed.delete(id); bodies.delete(id) }); revision++ }
      else transaction.acknowledged = true
      return clone(transaction)
    }
    if (suffix === '/library' && method === 'GET') return { items: clone(entries), truncated: false }
    const entryPreview = /^\/library\/([^/]+)\/preview$/.exec(suffix)
    if (entryPreview && method === 'GET') { getEntry(entryPreview[1]); return preview(bodies.get(entryPreview[1])!) }
    if (suffix === '/graph' && method === 'GET') return listing()
    if (suffix === '/graph/jobs' && method === 'POST') {
      if (input.confirmed !== true || !Array.isArray(input.entry_ids) || !input.entry_ids.length || input.entry_ids.length > 50) return fail('GRAPH_CONFIRMATION_REQUIRED')
      input.entry_ids.forEach((id: string) => getEntry(id))
      if (new Set(input.entry_ids).size !== input.entry_ids.length) return fail('INVALID_REQUEST')
      if ([...graphTasks.values()].some(task => ['running', 'queued'].includes(task.state.status))) return fail('GRAPH_BUSY')
      const state: GraphJob = { id: identifier(), status: 'queued', processed: 0, total: input.entry_ids.length, current_file: null, errors: [] }
      graphTasks.set(state.id, { state, ids: [...input.entry_ids], revision, controller: new AbortController() }); return clone(state)
    }
    const graphJob = /^\/graph\/jobs\/([^/]+)(\/cancel)?$/.exec(suffix)
    if (graphJob) {
      const task = graphTasks.get(graphJob[1]); if (!task) return fail('GRAPH_JOB_NOT_FOUND')
      if (graphJob[2] && method === 'POST') { task.controller.abort(); task.state.status = 'cancelled'; return clone(task.state) }
      if (graphJob[2] || method !== 'GET') throw new Error('网页体验版不支持此操作。')
      if (task.state.status === 'queued') {
        task.state.status = 'running'
        const ids = [...new Set([...indexed, ...task.ids])].filter(id => entries.some(entry => entry.id === id))
        let relations: GraphRelation[]
        try {
          relations = await runTextTask('relations', ids.map(id => ({ id, text: bodies.get(id)?.text ?? '' })), task.controller.signal)
          task.controller.signal.throwIfAborted()
        } catch (error) {
          task.state.status = task.controller.signal.aborted ? 'cancelled' : 'failed'
          task.state.error = task.controller.signal.aborted ? null : 'BROWSER_ANALYSIS_FAILED'
          signal?.throwIfAborted()
          return clone(task.state)
        }
        if (task.revision !== revision) { task.state.status = 'failed'; task.state.error = 'GRAPH_REVISION_CONFLICT'; return clone(task.state) }
        indexed = new Set(ids); automatic = relations.filter(edge => !dismissed.has(edge.id) && !manual.some(link => [link.source, link.target].includes(edge.source) && [link.source, link.target].includes(edge.target))); updated = new Date().toISOString(); revision++
        task.state.status = 'completed'; task.state.processed = task.ids.length
      }
      signal?.throwIfAborted()
      return clone(task.state)
    }
    const evidence = /^\/graph\/relations\/([^/]+)\/evidence$/.exec(suffix)
    if (evidence && method === 'GET') {
      const relation = listing().relations.find(edge => edge.id === evidence[1]); if (!relation) return fail('GRAPH_RELATION_NOT_FOUND')
      return { relation, explanation: relation.origin === 'manual' ? '人工确认的关系；不代表自动推断引用。' : relation.kind === 'duplicate' ? '当前浏览器内的完整文本完全相同；不代表磁盘文件的 SHA-256 校验。' : '根据浏览器内实际正文词项匹配生成的候选，不代表引用或版本事实。', files: [relation.source, relation.target].map(id => { const entry = getEntry(id), text = bodies.get(id)?.text ?? ''; return { id, name: entry.name, excerpts: [text.slice(0, 240)], summary: '当前浏览器内存文本；没有读取磁盘。' } }) }
    }
    if (suffix === '/graph/relations' && method === 'POST') {
      if (input.revision !== revision) return fail('GRAPH_REVISION_CONFLICT')
      getEntry(input.source); getEntry(input.target)
      if (input.source === input.target || !['related', 'reference', 'attachment', 'version'].includes(input.kind)) return fail('GRAPH_SELF_LINK')
      if (input.candidate_id && !automatic.some(edge => edge.id === input.candidate_id && [edge.source, edge.target].includes(input.source) && [edge.source, edge.target].includes(input.target))) return fail('GRAPH_CANDIDATE_INVALID')
      manual.push({ id: identifier(), source: input.source, target: input.target, kind: input.kind, origin: 'manual', status: 'confirmed', created: new Date().toISOString() })
      automatic = automatic.filter(edge => edge.id !== input.candidate_id); revision++; return listing()
    }
    const relationAction = /^\/graph\/relations\/([^/]+)(\/dismiss)?$/.exec(suffix)
    if (relationAction && (method === 'DELETE' || method === 'POST' && relationAction[2])) {
      if (input.revision !== revision) return fail('GRAPH_REVISION_CONFLICT')
      if (relationAction[2]) {
        if (!automatic.some(edge => edge.id === relationAction[1] && edge.status === 'suggested')) return fail('GRAPH_RELATION_NOT_FOUND')
        dismissed.add(relationAction[1]); automatic = automatic.filter(edge => edge.id !== relationAction[1])
      } else {
        if (!manual.some(edge => edge.id === relationAction[1])) return fail('GRAPH_RELATION_NOT_FOUND')
        manual = manual.filter(edge => edge.id !== relationAction[1])
      }
      revision++; return listing()
    }
    if (suffix === '/graph/index' && method === 'DELETE') { if (input.revision !== revision) return fail('GRAPH_REVISION_CONFLICT'); indexed.clear(); automatic = []; updated = null; revision++; return listing() }
    throw new Error('网页体验版不支持此操作。')
  }
  return { handle, reset, installFiles }
}

export const experienceEngine = /* @__PURE__ */ createExperienceEngine()
