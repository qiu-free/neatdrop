import { ArrowRight, BookOpen, FolderOpen, ShieldCheck } from 'lucide-react'
import { isWebExperience } from '../runtimeCapabilities'
import { workflow, type WorkflowStage } from '../workflow'
import { OnboardingStage } from './OnboardingStage'
import './product.css'

const browserSteps: Record<WorkflowStage, { title: string; text: string }> = {
  choose: { title: '载入学习资料', text: '载入学习样例，或主动选择有限的TXT/Markdown。查看内容后勾选要整理的文本；不会读取本机目录。' },
  analyze: { title: '浏览器分析', text: 'Worker根据实际正文生成学习用途候选与依据，所有建议均需复核；不调用本地服务或云端模型。' },
  review: { title: '核对分类与名称', text: '对照正文与候选，逐项或批量确认。修改分类或名称后，重新审核。' },
  copy: { title: '确认加入内存资料库', text: '核对计划后独立勾选确认，只加入本页内存资料库，不创建磁盘副本。' },
  library: { title: '查找与关联', text: '在本页资料库查找结果、导出元数据清单，或对文本做实际词项匹配。刷新会清空结果。' },
  history: { title: '查看与移除结果', text: '在本页记录核对操作，移除内存结果。网页移除不等于磁盘撤回。' },
}

export function ProductPage({ onPractice, onWorkbench, onHelp }: { onPractice: () => void; onWorkbench: () => void; onHelp: () => void }) {
  return <>
    <section className="page-intro product-intro"><div><h1>认识 NeatDrop</h1><p>把文件与图片整理成有依据、可复核、以后找得到的资料。</p></div></section>
    <section className="product-start" aria-label="开始了解产品"><div><h2>先看懂，再放心整理</h2><p>适合课程笔记、论文、课件、票据和日常文档混在一起的场景。系统先给分类与名称建议，你核对后再确认；整理完可以从资料库找文件、从知识图谱探索关系。</p><p>{isWebExperience ? '当前为网页体验：有限文本在浏览器计算，结果只在内存。' : '当前为本地完整版：只处理你主动选择的目录，生成副本并保留原件。'}</p></div><div className="product-start-actions"><button className="button primary" onClick={onPractice}><BookOpen size={17} />开始安全练习</button><button className="button secondary" onClick={onWorkbench}><FolderOpen size={17} />进入整理工作台</button></div></section>
    <section className="product-workflow" aria-labelledby="product-workflow-title"><h2 id="product-workflow-title">一次整理，按顺序完成</h2><p>每一步完成后再进入下一步。查看不会自动勾选，审核不会自动执行。</p><ol>{workflow.map((step, index) => <li key={step.id}><OnboardingStage stage={step.id} title={isWebExperience ? browserSteps[step.id].title : step.title} showCaption={!isWebExperience} /><div><span className="product-step-number">{index + 1}</span><h3>{isWebExperience ? browserSteps[step.id].title : step.title}</h3><p>{isWebExperience ? browserSteps[step.id].text : step.text}</p></div></li>)}</ol></section>
    <section className="product-explainer" aria-labelledby="product-storage-title"><h2 id="product-storage-title">文件会保存在哪里</h2>{isWebExperience ? <><p>本页中的分类、建议和整理结果仅保存在浏览器内存。没有复制你的磁盘文件，刷新或清空体验后结果消失。</p><p>可以在资料库导出 JSON / CSV 元数据清单；清单不包含正文，也不能代替文件备份。</p></> : <><p>原文件始终保留在你选择的文件夹。独立确认后，副本创建在同一文件夹内的分类子目录；执行前的计划会列出每个目标位置。</p><p>资料库按分类展示这些副本，并提供来源和预览。重启后重新选择原目录即可读取已有记录；不是把文件上传到网站。</p><p>撤回只把符合条件的副本移入原目录的 <code>.neatdrop/withdrawn</code>，仍占用空间；原件不动。</p></>}</section>
    <section className="product-explainer" aria-labelledby="product-modes-title"><h2 id="product-modes-title">离线分析与在线分析</h2>{isWebExperience ? <><p>当前网页使用浏览器 Worker 运行有限的学习文本规则，所有建议都需人工复核。支持主动选择 UTF-8 TXT / Markdown，最多10份、每份512 KiB、合计2 MiB。</p><p>图片仅展示明确标注的本地预录结果；网页不运行实时 OCR，不连接本地 API 或云端模型，不提供在线密钥配置。</p></> : <><p>离线分析使用正文结构、规则和已准备好的本地 OCR、图片模型；未准备相应模型时会说明能力缺失。扫描 PDF 的有限页 OCR 需单独启用，默认关闭。</p><p>在线分析是可选项：先配置服务，再对每批次单独授权抽样内容，可能产生费用。建议与相似度都不等于正确率，仍需核对。</p></>}</section>
    <section className="product-explainer" aria-labelledby="product-graph-title"><h2 id="product-graph-title">资料库与知识图谱有什么用</h2><p>{isWebExperience ? '资料库整理本页已确认的文本，图谱按实际正文词项计算关系候选。' : '资料库帮助你按分类查找副本。图谱覆盖当前目录，或全部主动登记且当前会话已授权的目录；不会自动扫描整台电脑。'}</p><p>圆点代表文件，颜色区分类别，曲线表示已有关系。相似关系只是候选，查看依据后再人工确认；没有关系时不会为了画面生成假连线。</p></section>
    <section className="product-boundaries" aria-labelledby="product-boundaries-title"><ShieldCheck size={22} aria-hidden="true" /><div><h2 id="product-boundaries-title">使用前记住这几件事</h2><ul><li>先看依据和目标位置，再确认；分类不确定时可以修改或暂不整理。</li><li>{isWebExperience ? '刷新会清空内存结果；需要保留时先导出清单。' : '副本也占用磁盘空间；本工具不做原位移动、永久删除或自动去重。'}</li><li>预置练习用于学习操作，不代表实时识别结果或独立准确率。</li></ul></div></section>
    <div className="product-footer"><button className="button primary" onClick={onPractice}>用样例练一遍<ArrowRight size={16} /></button><button className="text-button" onClick={onHelp}>查看详细使用说明</button></div>
  </>
}
