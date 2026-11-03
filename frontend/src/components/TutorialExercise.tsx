import { useState } from 'react'
import { Check, RotateCcw, ShieldCheck } from 'lucide-react'
import './tutorial.css'

export interface TutorialExerciseProps {
  completed: boolean
  onComplete: () => void
}

const sampleFiles = [
  { id: 'receipt', name: '演示收据.png', kind: '图片 · 练习样例' },
  { id: 'notes', name: '课程笔记.md', kind: '文本 · 练习样例' },
]

export function TutorialExercise({ completed, onComplete }: TutorialExerciseProps) {
  const [stage, setStage] = useState(0)
  const [viewed, setViewed] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [category, setCategory] = useState('票据凭证')
  const [reviewed, setReviewed] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [undone, setUndone] = useState(false)

  const restart = () => {
    setStage(0)
    setViewed(null)
    setSelected(new Set())
    setCategory('票据凭证')
    setReviewed(false)
    setConfirmed(false)
    setUndone(false)
  }

  return <section className="tutorial-exercise" aria-labelledby="exercise-title">
    <header className="tutorial-exercise-head">
      <div><span className="intro-label">不碰真实文件</span><h2 id="exercise-title">走一遍整理流程</h2></div>
      <span className="exercise-mode-badge">演练模式</span>
      {completed ? <span className="practice-badge"><Check size={14} />练习已完成</span> : null}
    </header>
    <p className="tutorial-exercise-intro">练习全程使用浏览器内存里的内置示例，不会读取本机文件，也不会访问 API 或文件系统。</p>
    {stage < 6 ? <div className="exercise-progress" aria-label={`任务 ${Math.min(stage + 1, 6)} / 6`}><span>任务 {Math.min(stage + 1, 6)} / 6</span><div aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i key={index} className={index < stage ? 'done' : ''} />)}</div></div> : null}

    {stage === 0 ? <div className="exercise-step">
      <span className="exercise-number">01</span><div><h3>先载入安全样例</h3><p>样例只存在于当前页面内存，刷新页面后会消失。</p></div>
      <button className="button primary" onClick={() => setStage(1)}>{completed ? '重新练习' : '载入内置样例'}</button>
    </div> : null}

    {stage === 1 ? <div className="exercise-step exercise-files">
      <span className="exercise-number">02</span><div><h3>查看文件，再决定是否选择</h3><p>点名称只查看；勾选框才加入整理批次。下一步练习分析针对演示收据，需先查看并选中它。</p></div>
      <div className="exercise-file-list">{sampleFiles.map(file => <div className="exercise-file" key={file.id}>
        <div><strong>{file.name}</strong><small>{file.kind}</small></div>
        <button className={`button ${viewed === file.id ? 'primary' : 'secondary'}`} onClick={() => setViewed(file.id)} aria-label={`查看 ${file.name}`}>{viewed === file.id ? '正在查看' : '查看'}</button>
        <label><input type="checkbox" aria-label={`选择 ${file.name}`} checked={selected.has(file.id)} onChange={event => setSelected(current => {
          const next = new Set(current)
          if (event.target.checked) next.add(file.id)
          else next.delete(file.id)
          return next
        })} />选择</label>
      </div>)}</div>
      <div className="exercise-state"><span>当前查看：{viewed ? sampleFiles.find(file => file.id === viewed)?.name : '尚未查看'}</span><span>已选择 {selected.size} 个示例</span></div>
      <button className="button primary" onClick={() => setStage(2)} disabled={viewed !== 'receipt' || !selected.has('receipt')}>继续：做一次本地分析</button>
    </div> : null}

    {stage === 2 ? <div className="exercise-step">
      <span className="exercise-number">03</span><div><h3>模拟本地分析</h3><p>分析使用固定文字结果，不会连接模型或发送内容。</p></div>
      <button className="button primary" onClick={() => setStage(3)}>模拟本地分析</button>
    </div> : null}

    {stage === 3 ? <div className="exercise-step exercise-review">
      <span className="exercise-number">04</span><div><h3>编辑建议并完成复核</h3><p>模拟建议：票据凭证 · 消费小票。现在试着修改分类并标记已复核。</p></div>
      <label className="exercise-field">练习分类<select value={category} onChange={event => setCategory(event.target.value)}>
        <option>票据凭证</option><option>生活服务</option><option>学习科研</option>
      </select></label>
      <label className="exercise-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />我已阅读模拟依据并标记复核</label>
      <button className="button primary" onClick={() => setStage(4)} disabled={!reviewed}>保存修改并复核</button>
      <p className="exercise-state">模拟分类已更新为 {category}</p>
    </div> : null}

    {stage === 4 ? <div className="exercise-step">
      <span className="exercise-number">05</span><div><h3>模拟确认归档</h3><p>模拟分类已更新为 {category}。真实整理前会再次展示计划并要求明确确认；本练习不会创建文件。</p></div>
      <label className="exercise-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已确认模拟归档</label>
      <button className="button primary" onClick={() => setStage(5)} disabled={!confirmed}>模拟确认并生成副本</button>
    </div> : null}

    {stage === 5 ? <div className="exercise-step exercise-result">
      <span className="exercise-number">06</span><div><h3>查看结果并练习撤回</h3><p>{undone ? '模拟已撤回，原件仍保留。' : '模拟结果：已生成归档副本'}</p></div>
      {!undone
        ? <button className="button secondary" onClick={() => { setUndone(true); setStage(6); onComplete() }}><RotateCcw size={15} />模拟撤回副本</button>
        : <span className="practice-badge"><ShieldCheck size={14} />原件保留</span>}
    </div> : null}

    {stage === 6 ? <div className="exercise-done" role="status"><span className="practice-badge"><Check size={14} />练习已完成</span><p>模拟已撤回，原件仍保留。你已体验查看、选择、分析、复核、确认和撤回；练习结果不写入磁盘。</p><button className="text-button" onClick={restart}>再练一次 <RotateCcw size={13} /></button></div> : null}
  </section>
}
