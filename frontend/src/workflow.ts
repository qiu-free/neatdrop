/** Shared user journey. Practice uses these same stages with memory-only data. */
export const workflow = [
  { id: 'choose', label: '选择', title: '选择目录和文件', text: '选择一个本机目录，只扫描当前层。点文件名查看内容，勾选框才加入本批整理；查看不会自动选中。' },
  { id: 'analyze', label: '分析', title: '离线分析', text: '分析已选文件的内容，生成名称和分类建议。离线分析无需网络；分析不会复制或移动文件。云端分析需另行授权。' },
  { id: 'review', label: '复核', title: '核对依据并审核', text: '查看内容依据和副本位置，可修改分类与名称。一键审核确认所有已选项的当前建议，也包括待复核候选；修改后要重新审核。' },
  { id: 'copy', label: '计划与复制', title: '核对计划并确认复制', text: '先生成整理计划，核对原件与目标路径，再独立勾选确认并生成副本。审核不是执行；原件保留在所选目录，副本位于同一目录下的分类子目录。' },
  { id: 'library', label: '资料库', title: '资料库查看副本', text: '复制成功后，在资料库按分类查找和预览归档副本，并查看来源与实际位置。资料库展示已生成的副本，原件仍在原目录。' },
  { id: 'history', label: '记录与撤回', title: '操作记录与撤回', text: '在操作记录核对逐项结果。符合条件的副本可撤回到原目录的 .neatdrop/withdrawn，仍占空间，原件保持不动。' },
] as const

export type WorkflowStage = typeof workflow[number]['id']
