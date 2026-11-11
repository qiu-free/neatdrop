import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, Check, RotateCcw } from 'lucide-react'
import { workflow, type WorkflowStage } from '../workflow'
import { WorkflowOverview } from './WorkflowOverview'
import { OnboardingStage, onboardingSteps } from './OnboardingStage'
import snapshot from '../taxonomy.generated.json'
import './tutorial.css'

export interface TutorialExerciseProps { completed: boolean; onComplete: () => void; onStart?: () => void }

const sampleFiles = [
  { id: 'receipt', name: '演示收据.png', kind: '图片 · 练习样例', text: '便民商店\n消费收据\n牛奶 2 盒\n合计：28.00 元', category: 'finance', subcategory: '消费小票', evidence: '“消费收据”和“合计：28.00 元”支持消费小票用途。', decision: '待复核候选：票据凭证 · 消费小票' },
  { id: 'notes', name: '课程笔记.md', kind: '文本 · 练习样例', text: '线性代数课程笔记\n矩阵与向量\n课堂例题与定义', category: 'study', subcategory: '课程笔记', evidence: '“课程笔记”“矩阵与向量”和“课堂例题与定义”支持课程笔记用途。', decision: '待复核候选：学习科研 · 课程笔记' },
] as const
type SampleId = typeof sampleFiles[number]['id']
const practiceCategories = ['finance', 'study', 'life'] as const
type PracticeCategory = typeof practiceCategories[number]
const defaults: Record<SampleId, PracticeCategory> = { receipt: 'finance', notes: 'study' }
const sourceRoot = 'C:/安全练习'
type PracticeCopy = { id: SampleId; name: string; text: string; source: string; target: string }

export function TutorialExercise({ completed, onComplete, onStart }: TutorialExerciseProps) {
  const [stage, setStage] = useState<WorkflowStage>('choose')
  const [loaded, setLoaded] = useState(false)
  const [viewed, setViewed] = useState<SampleId | null>(null)
  const [viewedFiles, setViewedFiles] = useState<Set<SampleId>>(() => new Set())
  const [selected, setSelected] = useState<Set<SampleId>>(() => new Set())
  const [categories, setCategories] = useState({ ...defaults })
  const [reviewed, setReviewed] = useState<Set<SampleId>>(() => new Set())
  const [confirmed, setConfirmed] = useState(false)
  const [plan, setPlan] = useState<PracticeCopy[]>([])
  const [copies, setCopies] = useState<PracticeCopy[]>([])
  const [copyViewed, setCopyViewed] = useState<Set<SampleId>>(() => new Set())
  const [activeCopy, setActiveCopy] = useState<SampleId | null>(null)
  const [coreCompleted, setCoreCompleted] = useState(false)
  const [undone, setUndone] = useState(false)
  const doneRef = useRef(false)
  const stagePanel = useRef<HTMLDivElement>(null)
  const previousStage = useRef(stage)
  const stepIndex = workflow.findIndex(item => item.id === stage)
  const step = workflow[stepIndex]
  const active = sampleFiles.find(file => file.id === viewed)
  const chosen = sampleFiles.filter(file => selected.has(file.id))
  const unread = chosen.filter(file => !viewedFiles.has(file.id))
  const pending = chosen.filter(file => !reviewed.has(file.id)).length
  const canAnalyze = chosen.length > 0 && !unread.length
  const canPlan = chosen.length > 0 && !pending
  const copiesViewed = copies.length > 0 && copies.every(file => copyViewed.has(file.id))
  const preview = copies.find(file => file.id === activeCopy)
  const destination = (file: typeof sampleFiles[number]) => {
    const group = snapshot.taxonomy[categories[file.id]]
    return `${sourceRoot}/${group.directory}${categories[file.id] === file.category ? `/${file.subcategory}` : ''}/${file.name}`
  }

  useLayoutEffect(() => {
    if (previousStage.current !== stage) {
      const scroller = stagePanel.current?.closest('.modal-scroll-region')
      if (scroller) scroller.scrollTop = 0
      stagePanel.current?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true })
    }
    previousStage.current = stage
  }, [stage])

  function restart() {
    setStage('choose'); setLoaded(false); setViewed(null); setViewedFiles(new Set()); setSelected(new Set())
    setCategories({ ...defaults }); setReviewed(new Set()); setConfirmed(false); setPlan([]); setCopies([])
    setCopyViewed(new Set()); setActiveCopy(null); setCoreCompleted(false); setUndone(false); doneRef.current = false
  }
  function previous() {
    setConfirmed(false)
    if (stage === 'copy') { setPlan([]); setStage('review') }
    else if (stage === 'review') setStage('analyze')
    else if (stage === 'analyze') setStage('choose')
    else if (stage === 'history') setStage('library')
  }
  function finishCore() {
    if (!copiesViewed || undone) return
    setCoreCompleted(true)
    if (!doneRef.current) { doneRef.current = true; onComplete() }
  }
  function openCopy(id: SampleId) {
    if (undone || !copies.some(file => file.id === id)) return
    setActiveCopy(id); setCopyViewed(current => new Set(current).add(id))
  }

  return <section className="tutorial-exercise" aria-labelledby="exercise-title">
    <header className="tutorial-exercise-head"><h2 id="exercise-title">用样例完成第一次整理</h2><span className="exercise-mode-badge">演练模式</span>{completed ? <span className="practice-badge"><Check size={14} />练习已完成</span> : null}</header>
    <p className="tutorial-exercise-intro">不会读取本机文件，也不会访问 API 或文件系统。分类结果为预置教学示例，不代表实时识别；完成核心练习后即可开始整理，撤回可稍后再练。</p>
    <WorkflowOverview current={stage} label="练习工作流" />
    <div className="exercise-progress" aria-label="练习进度"><span>第 {stepIndex + 1} 步，共 {workflow.length} 步{stage === 'history' ? ' · 可选练习' : ''}</span><progress max={workflow.length} value={stepIndex + 1} aria-label="当前练习步骤" /></div>
    <div key={stage} ref={stagePanel} className="exercise-stage stage-transition">
      <div className="exercise-task"><h3 tabIndex={-1}>{step.title}</h3><p className="exercise-stage-copy">{onboardingSteps[stage].task}</p></div>
      <OnboardingStage stage={stage} title={step.title} />
      {stage === 'choose' ? <>
        {!loaded ? <><p>先用一份收据或课程笔记练习，内容都已内置。</p><button className="button primary" onClick={() => setLoaded(true)}>{completed ? '重新练习' : '载入内置样例'}</button></> : <>
          <p className="exercise-source">练习目录：{sourceRoot}（虚拟目录）</p>
          <div className="exercise-file-list">{sampleFiles.map(file => <div className="exercise-file" key={file.id}>
            <div><strong>{file.name}</strong><small>{file.kind}{viewedFiles.has(file.id) ? ' · 已查看' : ''}</small></div>
            <button className="button secondary" aria-label={`查看 ${file.name}`} onClick={() => { setViewed(file.id); setViewedFiles(current => new Set(current).add(file.id)) }}>{viewed === file.id ? '正在查看' : '查看'}</button>
            <label><input type="checkbox" aria-label={`选择 ${file.name}`} checked={selected.has(file.id)} onChange={event => {
              const checked = event.target.checked
              setSelected(current => { const next = new Set(current); if (checked) next.add(file.id); else next.delete(file.id); return next })
              setReviewed(new Set()); setConfirmed(false); setPlan([])
            }} />选择</label>
          </div>)}</div>
          <div className="exercise-state"><span>当前查看：{active?.name ?? '尚未查看'}</span><span>已选择 {selected.size} 个示例</span></div>
          {active ? <aside className="exercise-preview" aria-label="练习文件详情"><strong>{active.name}</strong><pre>{active.text}</pre><p>查看不会自动选中，请勾选要练习的文件。</p></aside> : null}
          <p className="exercise-next-hint" aria-live="polite">{!chosen.length ? '下一步：先查看并勾选至少一个示例。' : unread.length ? `还需查看：${unread.map(file => file.name).join('、')}。` : '已选示例均已查看，可以进入分析。'}</p>
          <button className="button primary" disabled={!canAnalyze} onClick={() => { if (canAnalyze) setStage('analyze') }}>继续：做一次本地分析<ArrowRight size={16} /></button>
        </>}
      </> : null}
      {stage === 'analyze' ? <><div className="exercise-preview"><strong>将分析 {chosen.length} 个已选示例</strong><p>{chosen.map(file => file.name).join('、')}</p><p>下一步展示预置的文字依据和候选，尚未生成副本。</p></div><button className="button primary" disabled={!canAnalyze} onClick={() => { if (canAnalyze) { setReviewed(new Set()); setConfirmed(false); setPlan([]); setStage('review') } }}>模拟本地分析</button></> : null}
      {stage === 'review' ? <>
        <div className="exercise-review-files">{chosen.map(file => <article className="exercise-review-file" key={file.id}>
          <strong>{file.name}</strong><p>{file.decision}</p><blockquote>{file.evidence}</blockquote>
          <label className="exercise-field">练习分类<select aria-label={`${file.name} 的练习分类`} value={categories[file.id]} onChange={event => {
            const value = event.target.value as PracticeCategory
            if (!practiceCategories.includes(value)) return
            setCategories(current => ({ ...current, [file.id]: value })); setReviewed(current => { const next = new Set(current); next.delete(file.id); return next }); setConfirmed(false); setPlan([])
          }}>{practiceCategories.map(id => <option value={id} key={id}>{snapshot.taxonomy[id].label}</option>)}</select></label>
          <p className="exercise-source">副本位置：{destination(file)}</p>
        </article>)}</div>
        <p className="exercise-stage-copy">一键审核会确认全部已选项，包括待复核候选。改分类后要重新审核，生成副本还需单独确认。</p>
        <div className="exercise-actions"><button className="button secondary" disabled={!pending} onClick={() => setReviewed(new Set(selected))}>一键审核已选项（{pending}）</button><button className="button primary" disabled={!canPlan} onClick={() => { if (canPlan) { setPlan(chosen.map(file => ({ id: file.id, name: file.name, text: file.text, source: `${sourceRoot}/${file.name}`, target: destination(file) }))); setConfirmed(false); setStage('copy') } }}>生成整理计划</button></div>
        <p className="exercise-state" aria-live="polite">已审核 {chosen.length - pending} / {chosen.length} 项；尚未生成副本。</p>
      </> : null}
      {stage === 'copy' ? <>
        <div className="exercise-plan">{plan.map(file => <article key={file.id}><strong>{file.name}</strong><dl><dt>原件位置（保留）</dt><dd aria-label={file.id === 'receipt' ? '练习原件位置' : undefined}>{file.source}</dd><dt>副本位置（待生成）</dt><dd aria-label={file.id === 'receipt' ? '练习副本位置' : undefined}>{file.target}</dd></dl></article>)}</div>
        <label className="exercise-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已核对计划，确认生成模拟副本并保留原件</label>
        <button className="button primary" disabled={!confirmed || !canPlan || !plan.length} onClick={() => { if (confirmed && canPlan && plan.length) { setCopies(plan.map(file => ({ ...file }))); setCopyViewed(new Set()); setActiveCopy(null); setStage('library') } }}>模拟确认并生成副本</button>
      </> : null}
      {stage === 'library' ? <>
        <p className="exercise-state">{undone ? '归档副本已撤回，资料库不再列出。' : `模拟结果：已生成 ${copies.length} 个归档副本，原件保留。`}</p>
        {!undone ? <><div className="exercise-copy-list">{copies.map(file => <div key={file.id}><div><strong>{file.name}</strong><p>{file.target}</p></div><button className="button secondary" aria-label={copies.length === 1 ? '查看归档副本' : `查看归档副本：${file.name}`} onClick={() => openCopy(file.id)}>{copyViewed.has(file.id) ? '再次查看副本' : '查看归档副本'}</button></div>)}</div>{preview ? <aside className="exercise-preview" aria-label="练习副本详情"><strong>{preview.name}</strong><pre>{preview.text}</pre><p>实际副本位置：{preview.target}</p><p>原件仍在：{preview.source}</p></aside> : null}
          {coreCompleted ? <div className="exercise-core-done" role="status"><Check size={18} /><p>已掌握核心流程：选择、分析、核对、确认和查看副本。可以开始整理自己的文件了。</p></div> : <p className="exercise-next-hint">{copiesViewed ? '已看过本次副本，可以完成核心练习；也可继续了解记录与撤回。' : '打开本次归档副本，看清保存位置后即可完成核心练习。'}</p>}
          <div className="exercise-actions"><button className="button primary" disabled={!copiesViewed || coreCompleted} onClick={finishCore}>完成核心练习</button>{coreCompleted && onStart ? <button className="button primary" onClick={onStart}>开始整理我的文件<ArrowRight size={16} /></button> : null}</div>
        </> : null}
        <button className="button secondary" disabled={!copiesViewed && !undone} onClick={() => setStage('history')}>查看操作记录</button>
      </> : null}
      {stage === 'history' && !undone ? <><div className="exercise-preview"><strong>可选练习：撤回归档副本</strong><p>这一步不影响核心练习的完成。模拟撤回后，{copies.length} 个副本进入 {sourceRoot}/.neatdrop/withdrawn，原件仍在原位置。</p></div><button className="button secondary" onClick={() => {
        setUndone(true); setCoreCompleted(true); setActiveCopy(null)
        if (!doneRef.current) { doneRef.current = true; onComplete() }
      }}><RotateCcw size={15} />模拟撤回副本</button></> : null}
      {stage === 'history' && undone ? <div className="exercise-done" role="status"><span className="practice-badge"><Check size={14} />本次练习完成</span><p>模拟已撤回，原件仍保留。副本移入虚拟目录 .neatdrop/withdrawn，不再显示在资料库；练习没有向磁盘写入文件。</p>{onStart ? <button className="button primary" onClick={onStart}>开始整理我的文件</button> : null}</div> : null}
    </div>
    <footer className="exercise-navigation">{['analyze', 'review', 'copy', 'history'].includes(stage) ? <button className="text-button exercise-back" onClick={previous}>返回上一步</button> : <span />}{loaded ? <button className="text-button" onClick={restart}>重新开始练习<RotateCcw size={14} /></button> : null}</footer>
  </section>
}
