import { useLayoutEffect, useRef, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { workflow, type WorkflowStage } from '../workflow'
import { WorkflowOverview } from './WorkflowOverview'
import snapshot from '../taxonomy.generated.json'
import './tutorial.css'

export interface TutorialExerciseProps { completed: boolean; onComplete: () => void }

const sampleFiles = [
  { id: 'receipt', name: '演示收据.png', kind: '图片 · 练习样例', text: '便民商店\n消费收据\n牛奶 2 盒\n合计：28.00 元', category: '票据凭证' },
  { id: 'notes', name: '课程笔记.md', kind: '文本 · 练习样例', text: '线性代数课程笔记\n矩阵与向量\n课堂例题与定义', category: '学习科研' },
]
const practiceCategories = ['finance', 'study', 'life'] as const
const directories = Object.fromEntries(practiceCategories.map(id => [snapshot.taxonomy[id].label, snapshot.taxonomy[id].directory]))
const sourceRoot = 'C:/安全练习'

export function TutorialExercise({ completed, onComplete }: TutorialExerciseProps) {
  const [stage, setStage] = useState<WorkflowStage>('choose')
  const [loaded, setLoaded] = useState(false)
  const [viewed, setViewed] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [category, setCategory] = useState('票据凭证')
  const [reviewed, setReviewed] = useState<Set<string>>(() => new Set())
  const [confirmed, setConfirmed] = useState(false)
  const [copyViewed, setCopyViewed] = useState(false)
  const [undone, setUndone] = useState(false)
  const doneRef = useRef(false)
  const stagePanel = useRef<HTMLDivElement>(null)
  const previousStage = useRef(stage)
  const step = workflow.find(item => item.id === stage)!
  const active = sampleFiles.find(file => file.id === viewed)
  const chosen = sampleFiles.filter(file => selected.has(file.id))
  const pending = chosen.filter(file => !reviewed.has(file.id)).length
  const canPlan = chosen.length > 0 && !pending
  const destination = (file: typeof sampleFiles[number]) => `${sourceRoot}/${directories[file.id === 'receipt' ? category : file.category]}/${file.name}`

  useLayoutEffect(() => {
    if (previousStage.current !== stage) stagePanel.current?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true })
    previousStage.current = stage
  }, [stage])

  function restart() {
    setStage('choose'); setLoaded(false); setViewed(null); setSelected(new Set())
    setCategory('票据凭证'); setReviewed(new Set()); setConfirmed(false); setCopyViewed(false); setUndone(false)
    doneRef.current = false
  }
  function previous() {
    setConfirmed(false)
    if (stage === 'copy') setStage('review')
    else if (stage === 'review') setStage('analyze')
    else if (stage === 'analyze') setStage('choose')
    else if (stage === 'history') setStage('library')
  }

  return <section className="tutorial-exercise" aria-labelledby="exercise-title">
    <header className="tutorial-exercise-head"><div><span className="intro-label">不碰真实文件</span><h2 id="exercise-title">走一遍整理流程</h2></div><span className="exercise-mode-badge">演练模式</span>{completed ? <span className="practice-badge"><Check size={14} />练习已完成</span> : null}</header>
    <p className="tutorial-exercise-intro">练习全程使用浏览器内存里的内置示例，不会读取本机文件，也不会访问 API 或文件系统。</p>
    <WorkflowOverview current={stage} label="练习工作流" />
    <div key={stage} ref={stagePanel} className="exercise-stage stage-transition">
      <h3 tabIndex={-1}>{step.title}</h3><p className="exercise-stage-copy">{step.text}</p>
      {stage === 'choose' ? <>
        {!loaded ? <button className="button primary" onClick={() => setLoaded(true)}>{completed ? '重新练习' : '载入内置样例'}</button> : <>
          <p className="exercise-source">练习目录：{sourceRoot}（虚拟目录）</p>
          <div className="exercise-file-list">{sampleFiles.map(file => <div className="exercise-file" key={file.id}>
            <div><strong>{file.name}</strong><small>{file.kind}</small></div>
            <button className="button secondary" aria-label={`查看 ${file.name}`} onClick={() => setViewed(file.id)}>{viewed === file.id ? '正在查看' : '查看'}</button>
            <label><input type="checkbox" aria-label={`选择 ${file.name}`} checked={selected.has(file.id)} onChange={event => {
              const checked = event.target.checked
              setSelected(current => { const next = new Set(current); if (checked) next.add(file.id); else next.delete(file.id); return next })
              setReviewed(new Set()); setConfirmed(false)
            }} />选择</label>
          </div>)}</div>
          <div className="exercise-state"><span>当前查看：{active?.name ?? '尚未查看'}</span><span>已选择 {selected.size} 个示例</span></div>
          {active ? <aside className="exercise-preview" aria-label="练习文件详情"><strong>{active.name}</strong><pre>{active.text}</pre><p>查看内容不会把文件加入批次，请使用文件旁的选择框。</p></aside> : null}
          <button className="button primary" disabled={viewed !== 'receipt' || !selected.has('receipt')} onClick={() => setStage('analyze')}>继续：做一次本地分析</button>
        </>}
      </> : null}
      {stage === 'analyze' ? <><div className="exercise-preview"><strong>将分析 {chosen.length} 个已选示例</strong><p>点击后立即展示预设的内容依据与分类，未生成副本。</p></div><button className="button primary" onClick={() => { setReviewed(new Set()); setConfirmed(false); setStage('review') }}>模拟本地分析</button></> : null}
      {stage === 'review' ? <>
        <div className="exercise-preview"><strong>待复核候选：票据凭证 · 消费小票</strong><p>依据：“消费收据”“合计：28.00 元”。请对照来源内容与下方副本位置。练习分类可自由更改，系统不会替你确定用途。</p></div>
        <label className="exercise-field">练习分类<select value={category} onChange={event => {
          setCategory(event.target.value); setReviewed(current => { const next = new Set(current); next.delete('receipt'); return next }); setConfirmed(false)
        }}>{practiceCategories.map(id => <option key={id}>{snapshot.taxonomy[id].label}</option>)}</select></label>
        <p className="exercise-source">副本位置：{destination(sampleFiles[0])}</p>
        <p className="exercise-stage-copy">一键审核会确认全部已选项的当前分类与名称，包括待复核候选；审核后改类需重新审核，复制还需独立确认。</p>
        <div className="exercise-actions"><button className="button secondary" disabled={!pending} onClick={() => setReviewed(new Set(selected))}>一键审核已选项（{pending}）</button><button className="button primary" disabled={!canPlan} onClick={() => { if (canPlan) { setConfirmed(false); setStage('copy') } }}>生成整理计划</button></div>
        <p className="exercise-state">已审核 {chosen.length - pending} / {chosen.length} 项；尚未生成副本。</p>
      </> : null}
      {stage === 'copy' ? <>
        <div className="exercise-plan">{chosen.map(file => <article key={file.id}><strong>{file.name}</strong><dl><dt>原件位置（保留）</dt><dd aria-label={file.id === 'receipt' ? '练习原件位置' : undefined}>{sourceRoot}/{file.name}</dd><dt>副本位置（待生成）</dt><dd aria-label={file.id === 'receipt' ? '练习副本位置' : undefined}>{destination(file)}</dd></dl></article>)}</div>
        <label className="exercise-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已核对计划，确认生成模拟副本并保留原件</label>
        <button className="button primary" disabled={!confirmed || !canPlan} onClick={() => { if (confirmed && canPlan) { setCopyViewed(false); setStage('library') } }}>模拟确认并生成副本</button>
      </> : null}
      {stage === 'library' ? <>
        <p className="exercise-state">{undone ? '归档副本已撤回，资料库不再列出。' : `模拟结果：已生成 ${chosen.length} 个归档副本，原件保留。`}</p>
        {!undone ? <><div className="exercise-plan">{chosen.map(file => <p key={file.id}>{destination(file)}</p>)}</div><button className="button secondary" onClick={() => setCopyViewed(true)}>查看归档副本</button>{copyViewed ? <aside className="exercise-preview" aria-label="练习副本详情"><strong>{sampleFiles[0].name}</strong><pre>{sampleFiles[0].text}</pre><p>实际副本位置：{destination(sampleFiles[0])}</p><p>原件仍在：{sourceRoot}/{sampleFiles[0].name}</p></aside> : null}</> : null}
        <button className="button primary" disabled={!copyViewed && !undone} onClick={() => setStage('history')}>查看操作记录</button>
      </> : null}
      {stage === 'history' && !undone ? <><div className="exercise-preview"><strong>本次记录：已生成归档副本</strong><p>原件保留。撤回将副本移入 {sourceRoot}/.neatdrop/withdrawn，仍占用空间。</p></div><button className="button secondary" onClick={() => {
        if (doneRef.current) return
        doneRef.current = true; setUndone(true); onComplete()
      }}><RotateCcw size={15} />模拟撤回副本</button></> : null}
      {stage === 'history' && undone ? <div className="exercise-done" role="status"><span className="practice-badge"><Check size={14} />本次练习完成</span><p>模拟已撤回，原件仍保留。副本移入虚拟目录 .neatdrop/withdrawn，不再显示在资料库；练习没有向磁盘写入文件。</p><button className="text-button" onClick={restart}>再练一次 <RotateCcw size={13} /></button></div> : null}
    </div>
    {['analyze', 'review', 'copy'].includes(stage) || stage === 'history' && !undone ? <button className="text-button exercise-back" onClick={previous}>返回上一步</button> : null}
  </section>
}
