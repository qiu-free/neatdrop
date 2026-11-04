import { useCallback, useEffect, useRef, useState } from 'react'
import { api, initSession } from './api'
import type {
  Config, Edit, ExecutionSnapshot, FileRecord, Job, ModelBinding, Plan, Suggestion,
  Transaction, Workspace,
} from './types'

const MAX_SELECTED_FILES = 50
const MAX_SELECTED_BYTES = 200 * 1024 ** 2
const POLL_INTERVAL_MS = 600
let initialConfigRequest: Promise<Config> | null = null

function loadInitialConfig() {
  if (!initialConfigRequest) {
    const request = Promise.resolve()
      .then(() => initSession())
      .then(() => api<Config>('/config'))
      .finally(() => {
        if (initialConfigRequest === request) initialConfigRequest = null
      })
    initialConfigRequest = request
  }
  return initialConfigRequest
}

function isExecutionSnapshot(value: ExecutionSnapshot | Transaction): value is ExecutionSnapshot {
  return 'plan_id' in value && typeof value.processed === 'number' && typeof value.total === 'number'
}

function isStillRunning(status: string) {
  return status === 'planned' || status === 'queued' || status === 'running'
}

export function useWorkspace() {
  const [config, setConfig] = useState<Config | null>(null)
  const [online, setOnline] = useState(false)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [selected, setSelectedState] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({})
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [reviewed, setReviewed] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [job, setJob] = useState<Job | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [execution, setExecution] = useState<ExecutionSnapshot | null>(null)
  const [history, setHistory] = useState<Transaction[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const mounted = useRef(true)
  const selectedRef = useRef<Set<string>>(new Set())
  const filesRef = useRef<FileRecord[]>([])
  const actionLock = useRef('')
  const analysisTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const executionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const analysisGeneration = useRef(0)
  const analysisJobId = useRef<string | null>(null)
  const executionTarget = useRef<string | null>(null)
  const executeSubmittedFor = useRef<string | null>(null)
  const executePostPendingFor = useRef<string | null>(null)
  const executionFinalFor = useRef<string | null>(null)
  const executionCheckInFlight = useRef<string | null>(null)
  const cancelRequestedFor = useRef<string | null>(null)
  const configEpoch = useRef(0)

  const setSelected = useCallback((next: Set<string> | ((current: Set<string>) => Set<string>)) => {
    const requested = typeof next === 'function' ? next(new Set(selectedRef.current)) : next
    const eligible = filesRef.current.filter(file => file.supported && requested.has(file.id))
    if (eligible.length > MAX_SELECTED_FILES) {
      setError('单批最多选择 50 个文件。')
      return
    }
    if (eligible.reduce((total, file) => total + file.size, 0) > MAX_SELECTED_BYTES) {
      setError('单批文件总大小不能超过 200 MiB。')
      return
    }
    const bounded = new Set(eligible.map(file => file.id))
    const current = selectedRef.current
    if (current.size !== bounded.size || [...current].some(id => !bounded.has(id))) setPlan(null)
    selectedRef.current = bounded
    setSelectedState(bounded)
  }, [])

  useEffect(() => {
    mounted.current = true
    const epoch = ++configEpoch.current
    loadInitialConfig()
      .then(data => {
        if (mounted.current && configEpoch.current === epoch) {
          setConfig(data)
          setOnline(true)
        }
      })
      .catch(err => {
        if (mounted.current) setError(err instanceof Error ? err.message : '无法连接本地服务。')
      })
    return () => {
      mounted.current = false
      if (analysisTimer.current) clearTimeout(analysisTimer.current)
      if (executionTimer.current) clearTimeout(executionTimer.current)
    }
  }, [])

  const refreshConfig = useCallback(async () => {
    const epoch = ++configEpoch.current
    try {
      const data = await api<Config>('/config')
      if (mounted.current && configEpoch.current === epoch) {
        setConfig(data)
        setOnline(true)
      }
      return data
    } catch (err) {
      if (mounted.current && configEpoch.current === epoch) {
        setError(err instanceof Error ? err.message : '无法读取模型配置。')
      }
      throw err
    }
  }, [])

  async function guard<T>(label: string, action: () => Promise<T>): Promise<T | undefined> {
    if (actionLock.current) return undefined
    actionLock.current = label
    setBusy(label)
    setError('')
    setMessage('')
    try {
      return await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作未完成，请重试。')
    } finally {
      if (actionLock.current === label) {
        actionLock.current = ''
        setBusy('')
      }
    }
  }

  async function refreshHistory(id: string) {
    const records = await api<Transaction[]>(`/workspaces/${id}/transactions`)
    if (mounted.current && workspace?.id === id) setHistory(records)
    return records
  }

  function resetFiles(files: FileRecord[]) {
    if (analysisTimer.current) clearTimeout(analysisTimer.current)
    if (executionTimer.current) clearTimeout(executionTimer.current)
    analysisGeneration.current += 1
    analysisJobId.current = null
    executionTarget.current = null
    executeSubmittedFor.current = null
    executePostPendingFor.current = null
    executionFinalFor.current = null
    executionCheckInFlight.current = null
    filesRef.current = files
    selectedRef.current = new Set()
    setSelectedState(new Set())
    setActiveId(files.find(file => file.supported)?.id ?? files[0]?.id ?? null)
    setSuggestions({})
    setEdits({})
    setReviewed(new Set())
    setErrors({})
    setJob(null)
    setPlan(null)
    setExecution(null)
  }

  const scan = async (path: string) => guard('scan', async () => {
    const next = await api<Workspace>('/workspaces', { path })
    setWorkspace(next)
    resetFiles(next.files)
    const records = await api<Transaction[]>(`/workspaces/${next.id}/transactions`)
    if (mounted.current) setHistory(records)
    setMessage(`已扫描 ${next.files.length} 项，内容未发送至云端。`)
  })

  async function rescan() {
    if (!workspace) return
    await guard('scan', async () => {
      const files = await api<FileRecord[]>(`/workspaces/${workspace.id}/files`)
      const updated = { ...workspace, files }
      setWorkspace(updated)
      resetFiles(files)
      const records = await api<Transaction[]>(`/workspaces/${workspace.id}/transactions`)
      if (mounted.current) setHistory(records)
      setMessage('已重新扫描。旧建议和计划已清除。')
    })
  }

  function toggle(id: string) {
    const file = filesRef.current.find(item => item.id === id)
    if (!file?.supported) return
    setPlan(null)
    const current = selectedRef.current
    if (current.has(id)) {
      const next = new Set(current)
      next.delete(id)
      setSelected(next)
      return
    }
    setSelected(new Set([...current, id]))
  }

  const edit = useCallback((value: Edit) => {
    setEdits(current => ({ ...current, [value.file_id]: value }))
    setReviewed(current => {
      const next = new Set(current)
      next.delete(value.file_id)
      return next
    })
    setPlan(null)
  }, [])

  const approve = useCallback((id: string) => {
    if (actionLock.current) return
    const file = filesRef.current.find(item => item.id === id)
    if (!file?.supported) { setError('此文件暂不支持整理。'); return }
    if (errors[id]) { setError('此项存在未处理的分析错误，请先重新分析。'); return }
    if (!suggestions[id] && !edits[id]) { setError('请先分析或编辑此项的分类与名称，再确认。'); return }
    setReviewed(current => new Set(current).add(id))
    setPlan(null)
  }, [suggestions, edits, errors])

  const approveSelected = useCallback(() => {
    if (actionLock.current) return 0
    const eligible = filesRef.current.filter(file => selectedRef.current.has(file.id) && file.supported &&
      !errors[file.id] && (suggestions[file.id] || edits[file.id]))
    const pending = eligible.filter(file => !reviewed.has(file.id))
    setReviewed(current => new Set([...current, ...pending.map(file => file.id)]))
    setPlan(null)
    const skipped = selectedRef.current.size - eligible.length
    setMessage(`已确认 ${pending.length} 项当前分类与名称。${skipped ? `${skipped} 项尚未分析或存在未处理错误，请先分析或编辑。` : '生成副本前仍需核对整理计划并独立勾选确认。'}`)
    return pending.length
  }, [suggestions, edits, errors, reviewed])

  const approveOrdinary = useCallback((ids?: string[]) => {
    const candidates = ids ?? filesRef.current.map(file => file.id)
    const eligible = candidates.filter(id => filesRef.current.some(file => file.id === id && file.supported) && !errors[id] && Boolean(suggestions[id]) && !suggestions[id].review_required && !edits[id])
    setReviewed(current => new Set([...current, ...eligible]))
    setPlan(null)
    return eligible.length
  }, [suggestions, edits, errors])

  function mergeJob(state: Job) {
    const results = state.results ?? []
    const failures = state.errors ?? []
    const merged = Object.fromEntries(results.map(item => [item.file_id, item]))
    setSuggestions(current => ({ ...current, ...merged }))
    if (results.length) {
      const completedIds = new Set(results.map(item => item.file_id))
      setEdits(current => Object.fromEntries(Object.entries(current).filter(([id]) => !completedIds.has(id))))
    }
    setErrors(current => {
      const next = { ...current }
      for (const item of results) delete next[item.file_id]
      for (const item of failures) next[item.file_id] = item.code
      return next
    })
    const failedIds = failures.map(item => item.file_id)
    const excludedIds = new Set(failedIds)
    if (excludedIds.size) {
      const next = new Set(selectedRef.current)
      for (const id of excludedIds) next.delete(id)
      selectedRef.current = next
      setSelectedState(next)
    }
    setJob(state)
  }

  function finishAnalysis(state: Job, generation: number) {
    if (generation !== analysisGeneration.current) return
    actionLock.current = ''
    setBusy('')
    const cancelled = state.status === 'cancelled' || state.status === 'canceled'
    setMessage(cancelled
      ? '分析已取消。已完成建议保留，未应用任何文件操作。'
      : `分析完成：${state.results?.length ?? 0} 项建议，${state.errors?.length ?? 0} 项失败。`)
  }

  async function poll(identifier: string, generation: number) {
    if (generation !== analysisGeneration.current || !mounted.current) return
    try {
      const state = await api<Job>(`/analysis-jobs/${identifier}`)
      if (!mounted.current || generation !== analysisGeneration.current || identifier !== analysisJobId.current) return
      mergeJob(state)
      if (isStillRunning(state.status)) {
        analysisTimer.current = setTimeout(() => void poll(identifier, generation), POLL_INTERVAL_MS)
      } else {
        finishAnalysis(state, generation)
      }
    } catch (err) {
      if (mounted.current && generation === analysisGeneration.current) {
        actionLock.current = ''
        setBusy('')
        setError(err instanceof Error ? err.message : '进度连接失败。已完成的建议仍然保留；可只重试失败项。')
      }
    }
  }

  async function analyze(mode: 'local' | 'cloud', consent: boolean, fileIds = [...selected], binding?: ModelBinding) {
    if (actionLock.current || job && ['queued', 'running'].includes(job.status) || !workspace || !fileIds.length) return
    actionLock.current = 'analysis'
    const generation = ++analysisGeneration.current
    analysisJobId.current = null
    setBusy('analysis')
    setError('')
    setMessage('')
    setPlan(null)
    setReviewed(current => new Set([...current].filter(id => !fileIds.includes(id))))
    setSuggestions(current => Object.fromEntries(Object.entries(current).filter(([id]) => !fileIds.includes(id))))
    setErrors(current => Object.fromEntries(Object.entries(current).filter(([id]) => !fileIds.includes(id))))
    if (analysisTimer.current) clearTimeout(analysisTimer.current)
    try {
      const cloudBinding = mode === 'cloud' ? {
        endpoint: binding?.endpoint ?? config?.model.endpoint,
        config_version: binding?.config_version ?? config?.model.config_version,
      } : {}
      const state = await api<Job>('/analysis-jobs', {
        workspace_id: workspace.id,
        file_ids: [...fileIds],
        mode,
        cloud_consent: consent,
        ...cloudBinding,
      })
      if (!mounted.current || generation !== analysisGeneration.current) return
      analysisJobId.current = state.id
      mergeJob(state)
      await poll(state.id, generation)
    } catch (err) {
      if (mounted.current && generation === analysisGeneration.current) {
        actionLock.current = ''
        setBusy('')
        setError(err instanceof Error ? err.message : '无法开始分析。')
      }
    }
  }

  async function cancel() {
    if (!job || cancelRequestedFor.current === job.id || !isStillRunning(job.status)) return
    cancelRequestedFor.current = job.id
    try {
      await api(`/analysis-jobs/${job.id}/cancel`, {})
      setMessage('已请求取消；已经发送的模型请求可能仍计费。已完成的建议会保留。')
    } catch (err) {
      cancelRequestedFor.current = null
      setError(err instanceof Error ? err.message : '取消请求失败。')
    }
  }

  async function resumeAnalysis() {
    if (!job || !analysisJobId.current || !isStillRunning(job.status) || actionLock.current) return
    actionLock.current = 'analysis'
    setBusy('analysis')
    setError('')
    await poll(analysisJobId.current, analysisGeneration.current)
  }

  async function createPlan() {
    if (!workspace || actionLock.current) return
    if (!selected.size) {
      setError('请先选择要整理的文件。')
      return
    }
    const notApproved = [...selected].filter(id => !reviewed.has(id) || errors[id] || !suggestions[id] && !edits[id])
    if (notApproved.length) {
      setError(`还有 ${notApproved.length} 个所选文件未逐项确认或通过一键审核，请先处理错误并确认当前分类与名称。`)
      return
    }
    await guard('plan', async () => {
      const changes = workspace.files.filter(file => selected.has(file.id)).map(file => edits[file.id] ?? {
        file_id: file.id,
        name: suggestions[file.id]?.name ?? file.name,
        category: suggestions[file.id]?.category ?? 'other',
        subcategory: suggestions[file.id]?.subcategory ?? null,
      })
      const result = await api<Plan>(`/workspaces/${workspace.id}/plans`, { edits: changes })
      executionTarget.current = result.id
      executeSubmittedFor.current = null
      executePostPendingFor.current = null
      executionFinalFor.current = null
      setExecution(null)
      setPlan(result)
    })
  }

  function scheduleExecutionPoll(planId: string) {
    if (executionTimer.current) clearTimeout(executionTimer.current)
    executionTimer.current = setTimeout(() => void fetchExecution(planId), POLL_INTERVAL_MS)
  }

  function finishExecution(snapshot: ExecutionSnapshot) {
    if (executionFinalFor.current === snapshot.plan_id) return
    if (executionTimer.current) {
      clearTimeout(executionTimer.current)
      executionTimer.current = null
    }
    setExecution(snapshot)
    if (snapshot.status === 'planned') {
      if (executePostPendingFor.current === snapshot.plan_id) {
        setBusy('execute')
        scheduleExecutionPoll(snapshot.plan_id)
        return
      }
      if (actionLock.current === 'execute') actionLock.current = ''
      setBusy('')
      return
    }
    if (isStillRunning(snapshot.status)) {
      setBusy('execute')
      scheduleExecutionPoll(snapshot.plan_id)
      return
    }
    executionFinalFor.current = snapshot.plan_id
    executePostPendingFor.current = null
    if (actionLock.current === 'execute') actionLock.current = ''
    setBusy('')
    setError('')
    setPlan(null)
    if (snapshot.transaction && workspace) void refreshHistory(workspace.id).catch(() => undefined)
    const completed = snapshot.items.filter(item => item.stage === 'completed').length
    const failed = snapshot.items.filter(item => item.stage === 'failed').length
    const pending = snapshot.items.filter(item => item.stage === 'planned').length
    if (snapshot.status === 'completed') {
      setMessage(`整理完成：${completed} 项成功，${failed} 项失败。原件全部保留。`)
    } else if (snapshot.status === 'partial') {
      setMessage(`整理部分完成：${completed} 项成功，${failed} 项失败，${pending} 项未开始。请检查操作记录。`)
    } else {
      setMessage(`本次整理状态为“${snapshot.status}”：${completed} 项成功，${failed} 项失败，${pending} 项未开始。请在操作记录中恢复核对。`)
    }
  }

  async function fetchExecution(planId: string): Promise<ExecutionSnapshot | undefined> {
    if (!workspace || !planId || executionCheckInFlight.current === planId) return
    executionCheckInFlight.current = planId
    try {
      const snapshot = await api<ExecutionSnapshot>(`/workspaces/${workspace.id}/executions/${planId}`)
      if (!mounted.current || executionTarget.current !== planId) return
      if (executionFinalFor.current === planId) return snapshot
      finishExecution(snapshot)
      return snapshot
    } catch (err) {
      if (mounted.current && executionTarget.current === planId) {
        if (executePostPendingFor.current === planId) {
          setError(`无法读取本次整理进度，仍在等待执行请求；会继续查询同一计划。${err instanceof Error ? ` ${err.message}` : ''}`)
          scheduleExecutionPoll(planId)
          return
        }
        if (actionLock.current === 'execute') actionLock.current = ''
        setBusy('')
        setError(`无法确认本次整理状态。请重新查询或检查操作记录；不会自动再次提交执行。${err instanceof Error ? ` ${err.message}` : ''}`)
      }
    } finally {
      if (executionCheckInFlight.current === planId) executionCheckInFlight.current = null
    }
  }

  async function checkExecution() {
    const planId = execution?.plan_id ?? plan?.id ?? executionTarget.current
    if (!planId) return
    setError('')
    return fetchExecution(planId)
  }

  async function execute() {
    if (!workspace || !plan) return
    const currentPlan = plan
    if (executeSubmittedFor.current === currentPlan.id) {
      await checkExecution()
      return
    }
    if (actionLock.current) return
    executeSubmittedFor.current = currentPlan.id
    executionTarget.current = currentPlan.id
    actionLock.current = 'execute'
    executePostPendingFor.current = currentPlan.id
    executionFinalFor.current = null
    setBusy('execute')
    setError('')
    setMessage('')
    setExecution({
      plan_id: currentPlan.id,
      status: 'planned',
      processed: 0,
      total: currentPlan.items.length,
      current_file: null,
      items: currentPlan.items,
      error: null,
    })
    setPlan(null)
    scheduleExecutionPoll(currentPlan.id)
    try {
      const response = await api<ExecutionSnapshot | Transaction>(`/workspaces/${workspace.id}/execute`, {
        plan_id: currentPlan.id,
        digest: currentPlan.digest,
        confirmed: true,
      })
      if (!mounted.current || executionTarget.current !== currentPlan.id) return
      executePostPendingFor.current = null
      if (executionFinalFor.current === currentPlan.id) return
      if (isExecutionSnapshot(response)) {
        finishExecution(response)
      } else {
        const done = response.items.filter(item => item.stage === 'completed' || item.stage === 'failed').length
        finishExecution({
          plan_id: currentPlan.id,
          status: response.status,
          processed: done,
          total: response.items.length,
          current_file: null,
          items: response.items,
          error: null,
          transaction: response,
        })
      }
    } catch (err) {
      if (mounted.current && executionTarget.current === currentPlan.id) {
        if (executionFinalFor.current === currentPlan.id) return
        executePostPendingFor.current = null
        if (executionTimer.current) {
          clearTimeout(executionTimer.current)
          executionTimer.current = null
        }
        setError('执行请求连接中断，正在查询本次计划状态；不会再次提交执行。')
        const snapshot = await fetchExecution(currentPlan.id)
        if (!snapshot && actionLock.current === 'execute') {
          actionLock.current = ''
          setBusy('')
        }
        if (!snapshot && mounted.current) setError(current => current || (err instanceof Error ? err.message : '请检查操作记录。'))
      }
    }
  }

  async function historyAction(transactionId: string, action: 'undo' | 'acknowledge') {
    if (!workspace) return
    await guard('history', async () => {
      await api(`/workspaces/${workspace.id}/transactions/${transactionId}/${action}`, { confirmed: true })
      await refreshHistory(workspace.id)
      setMessage(action === 'undo'
        ? '撤回检查完成。成功项移入 .neatdrop/withdrawn，未删除文件。冲突项保持原状。'
        : '已记录人工检查确认，保留所有现有文件。')
    })
  }

  return {
    config, online, refreshConfig, workspace, selected, setSelected, activeId, setActiveId, suggestions, edits,
    errors, job, plan, setPlan, execution, history, busy, error, setError, message, setMessage,
    scan, rescan, toggle, edit, reviewed, approve, approveSelected, approveOrdinary, analyze, cancel,
    createPlan, execute, checkExecution, resumeAnalysis, historyAction, refreshHistory,
  }
}
