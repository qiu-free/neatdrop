import type { WorkflowStage } from '../workflow'

export const onboardingSteps: Record<WorkflowStage, { image: string; task: string; result: string }> = {
  choose: { image: 'folder', task: '先查看示例内容，再勾选要整理的文件。', result: '查看和选择是两件事；只有勾选的文件才会进入本批整理。' },
  analyze: { image: 'analyze', task: '分析已选文件，了解系统为什么给出这个分类。', result: '分析只生成建议，不会移动、改名或复制原件。' },
  review: { image: 'review', task: '对照内容依据，确认当前分类与名称。', result: '候选需要你判断；修改后必须重新审核。' },
  copy: { image: 'copy', task: '检查原件与副本位置，再单独勾选确认。', result: '审核不等于执行。这里确认后才会生成副本，原件保留。' },
  library: { image: 'library', task: '打开归档副本，确认以后在哪里找到它。', result: '资料库展示副本，原件仍在原目录；副本也会占用空间。' },
  history: { image: 'history', task: '可选：查看记录，再练习一次副本撤回。', result: '撤回把副本移入撤回区，不改动原件，也不释放磁盘空间。' },
}

export function OnboardingStage({ stage, title, showCaption = true }: { stage: WorkflowStage; title: string; showCaption?: boolean }) {
  return <figure className="onboarding-stage-art"><img src={`/help/${onboardingSteps[stage].image}.svg`} alt={`${title}阶段示意图`} />{showCaption ? <figcaption>{onboardingSteps[stage].result}</figcaption> : null}</figure>
}
