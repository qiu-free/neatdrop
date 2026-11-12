import { ArrowLeft, ArrowRight, Eye, LoaderCircle, Sparkles } from 'lucide-react'

export function WorkbenchActions({ stage, selected, visible, hiddenSelected, reviewed, approvalCount, selectionReady, analysisReady, canCreatePlan, working, activeAnalysis, planning, hint, onBack, onAnalyze, onReview, onInspect, onApprove, onPlan, onNext }: {
  stage: 'choose' | 'analyze' | 'review'; selected: number; visible: number; hiddenSelected: number; reviewed: number; approvalCount: number
  selectionReady: boolean; analysisReady: boolean; canCreatePlan: boolean; working: boolean; activeAnalysis: boolean; planning: boolean
  hint: string; onBack: () => void; onAnalyze: () => void; onReview: () => void; onInspect: () => void; onApprove: () => void; onPlan: () => void; onNext: () => void
}) {
  return <section className="workbench-actions" aria-label="本步操作">
    <div className="workbench-actions-heading"><h2>{stage === 'choose' ? '选择本批文件' : stage === 'analyze' ? analysisReady ? '分析完成，准备复核' : '分析已选文件' : canCreatePlan ? '核对完成，准备生成计划' : '核对内容、分类与名称'}</h2>
      <span id="workbench-batch-scope">已选 {selected} 项 · 当前可见 {visible} 项{hiddenSelected ? ` · 筛选外已选 ${hiddenSelected} 项` : ''}</span></div>
    <p id="workbench-action-hint" className="workbench-action-hint" aria-live="polite">{hint}</p>
    <div className="workbench-actions-controls">
      <span className="workbench-review-count">{stage === 'review' ? `已确认 ${reviewed} 项 · 剩余待确认 ${selected - reviewed} 项` : '查看文件不会自动勾选；勾选才加入本批。'}</span>
      <div className="workbench-action-buttons">
        {stage !== 'choose' ? <button type="button" className="button secondary" disabled={working || activeAnalysis} onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />{stage === 'analyze' ? '返回选择' : '返回分析'}</button> : null}
        {stage === 'choose' ? <button type="button" className="button primary" disabled={!selectionReady || working} aria-describedby="workbench-action-hint" onClick={onNext}>下一步：分析 <ArrowRight size={16} aria-hidden="true" /></button> : null}
        {stage === 'analyze' ? <><button type="button" className={`button ${analysisReady ? 'secondary' : 'primary'}`} disabled={!selectionReady || working || activeAnalysis} onClick={onAnalyze}><Sparkles size={16} aria-hidden="true" />{analysisReady ? '重新分析所选' : '分析选中文件'}</button><button type="button" className={`button ${analysisReady ? 'primary' : 'secondary'}`} disabled={!analysisReady || working} aria-describedby="workbench-action-hint" onClick={onReview}>查看建议 <ArrowRight size={16} aria-hidden="true" /></button></> : null}
        {stage === 'review' ? <><button type="button" className="button secondary" disabled={working || activeAnalysis || !approvalCount} onClick={onInspect}><Eye size={16} aria-hidden="true" />逐项核对</button><button type="button" className={`button ${canCreatePlan ? 'secondary' : 'primary'}`} disabled={working || activeAnalysis || !approvalCount} aria-describedby="workbench-action-hint workbench-batch-scope" onClick={onApprove}>一键审核已选项（{approvalCount}）</button><button type="button" className={`button ${canCreatePlan ? 'primary' : 'secondary'}`} disabled={!canCreatePlan} aria-describedby="workbench-action-hint" onClick={onPlan}>{planning ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}生成整理计划</button></> : null}
      </div>
    </div>
  </section>
}
