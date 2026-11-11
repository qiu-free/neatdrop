import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, BookOpen, Search, ShieldCheck } from 'lucide-react'
import './tutorial.css'
import './help.css'
import { useSessionState, type HelpSession } from '../pageSession'
import { supportedFormats } from '../supportedFormats'
import { workflow } from '../workflow'
import { WorkflowOverview } from './WorkflowOverview'
import { isWebExperience } from '../runtimeCapabilities'

interface HelpTopic {
  id: string
  title: string
  terms: string
  body: string
}

const topics: HelpTopic[] = [
  { id: 'supported-files', title: '支持的文件和目录', terms: '目录 文件夹 扫描 格式 图片 照片 PDF 文档 文本 JPG JPEG PNG WebP TXT Markdown DOCX PPTX XLSX CSV', body: '' },
  { id: 'scanned-pdf', title: '扫描 PDF 离线识别', terms: '扫描 PDF OCR 页面 提取 依赖 开关', body: '文本 PDF 沿用文本提取。扫描 PDF 默认关闭；安装 pdf-ocr 可选依赖并设置 NEATDROP_SCANNED_PDF_OCR=1 后重启本地服务，最多读取前两页、中间页和末页，共4页，单文件总计60秒。必须已有完整性校验通过的本地 OCR 模型；不下载、不联网，不完整页面会提示复核。网页只展示预录图片，不运行 OCR。' },
  { id: 'catalog', title: '跨目录资料集合', terms: '资料集合 全部 文件 图谱 全局 授权 多目录', body: '知识图谱的范围可以切换为全部已授权资料集合。主动加入当前或另选目录后，汇总归档副本并标明来源；每会话须重新授权原目录，最多10目录、每页1000项、画布200节点。目录登记不是永久访问许可。预览和关系依据重新核验当前文件；撤销集合授权不丢工作台草稿，移除登记前会展示人工关系影响。' },
  { id: 'office-reading', title: 'Office 与表格的读取范围', terms: 'DOCX PPTX XLSX CSV Word Excel PowerPoint 段落 幻灯片 表格 公式 缓存 有界', body: '服务支持时，可提取 DOCX 段落与表格、PPTX 幻灯片文字、XLSX 工作表与单元格文字及缓存值、UTF-8 CSV 字段。不会计算公式、启动 Office、执行宏、打开外链或嵌入对象。无缓存公式与部分读取会明确提示；受保护、损坏或超出安全预算的文件会保留原件并给出错误。格式只决定如何读取，归档用途仍以内容证据为准。' },
  { id: 'photos-documents-categories', title: '照片、文档和分类', terms: '照片 图片 photo OCR 文档 票据凭证 学习科研 工作办公 活动事务 生活服务 设计娱乐 临时资料 待分类', body: '静态图片会结合可用的视觉内容与 OCR 文字，文本型 PDF 和 TXT / Markdown 则使用提取到的文字。分类覆盖票据凭证、学习科研、工作办公、活动事务、生活服务、照片影像、设计娱乐、临时资料和待分类；内容证据不足时应保留待复核。' },
  { id: 'batch-limits', title: '批次容量边界', terms: '容量 限制 大小 数量 MiB 像素 文件数', body: '每批最多 50 个文件、单个不超过 20 MiB、合计不超过 200 MiB；目录最多列出 2000 项。图片预览长边不超过 1024 px。' },
  { id: 'analysis-review', title: '分析和复核', terms: '模型 建议 复核 证据 分类 编辑 选择 侧栏', body: '待复核文件可以加入批次，分析后保留选择；生成计划前仍须明确审核。点击文件打开右侧详情栏，勾选只加入批次。可以在详情中搜索分类、查看完整副本位置和修改名称。图表类型与归档用途分别核对，模型建议不是安全保证。' },
  { id: 'batch-review-categories', title: '批量核对和分类', terms: '批量 批次 核对 一键审核 分类 勾选 选择 复核 状态 图表 网格', body: '复核页核对列表后，可一键审核已选项，包括当前分类候选；未分析且未编辑、或仍有分析错误的项不能通过。编辑分类或名称后必须重新审核。批量分类和重新分析在更多操作中。批量选择只作用于当前可见项，图片较多时默认网格，可切换列表。' },
  { id: 'archive-library', title: '资料库查看副本', terms: '资料库 副本 分类 存放 保存 预览 搜索 位置 侧栏', body: '资料库按分类展示当前授权目录内的归档副本，可搜索名称并点击打开右侧预览。文件保存在本机分类子目录，不上传到云端。刷新或重启后重新选择同一目录即可再次查看记录。最多显示最近1000份；已撤回项不显示，丢失、修改、替换或缺少本机可信凭据的副本不能预览。' },
  { id: 'knowledge-graph', title: '本机知识图谱', terms: 'Graphify 知识图谱 图谱 关系 全局 局部 分类分组 分析 索引 候选 图片', body: '知识图谱把当前目录或全部已授权资料集合的归档副本按分类分组，以全局图谱查看整体结构，或聚焦局部关系。点击“分析关联”并明确同意后，服务会在本机读取所选归档副本，并保存数量受限的关键词、位置和图片指纹；这些特征不会上传。自动关系仍是待核实候选，查看依据后才能确认。清除索引会删除特征和自动候选并保留可读的人工关系；若索引文件已损坏，重建可能无法恢复损坏文件中的人工关系，请先保留现场并检查本机状态。撤回的归档副本会从图谱隐藏。' },
  { id: 'offline-cloud-analysis', title: '离线与云端分析', terms: '离线 本地 云端 网络 上传 私有 成本', body: '本地规则与已准备好的离线模型无需网络，不会把文件内容发给服务商。云端分析需要配置服务地址和密钥，并在每批分析前单独授权；确认前先核对将发送的抽样内容。云端内容受服务商政策约束，可能产生费用。' },
  { id: 'model-settings', title: '模型服务设置', terms: '设置 百炼 自定义 endpoint 地址 密钥 API key 保存 环境变量 锁定 Chat Completions', body: '可以使用百炼兼容服务或自定义公网 HTTPS 端点。页面会标明字段来自环境配置、本机设置或默认值；环境配置字段会锁定。已保存的密钥不会回显，可选择保留、更换或移除。保存只更新本机设置，不连接服务商；连接测试只发送固定文字，需明确确认目标并知悉可能计费。' },
  { id: 'archive-copy', title: '确认和归档副本', terms: '确认 计划 执行 副本 原件 安全 保留', body: '生成计划后先核对源文件和目标位置，再明确确认。执行采用创建副本的方式，保留原件；目标名称冲突时不会覆盖。副本模式不会释放磁盘空间。' },
  { id: 'interrupt-resume', title: '中断和恢复', terms: '中断 恢复 操作记录 失败 重启', body: '重新打开相同目录后查看操作记录。不完整或失败事务需要先人工检查源与目标，再确认保留现状；损坏日志会阻止继续写入，不会自动重放。' },
  { id: 'withdraw-copy', title: '副本撤回', terms: '撤回 撤销 undo 副本 原件 修改 Windows', body: 'Windows 下可以把未经修改的归档副本撤回到 .neatdrop/withdrawn，原件保持不动。修改过的副本保留现状；其他平台不承诺自动撤回。' },
  { id: 'privacy-deployment', title: '隐私与部署', terms: '隐私 上传 网络 路径 部署 localhost 127.0.0.1', body: '本地服务只面向 127.0.0.1，不可直接暴露到公网。云端内容受所配置服务商的隐私政策约束；本地操作记录包含路径信息，不加密。' },
  { id: 'sessions-costs', title: '会话与费用', terms: '费用 价格 成本 会话 请求 限额 网络', body: '本地会话有效 8 小时；完成的分析状态约保留 15 分钟。服务重启会丢失分析与计划状态，但磁盘操作记录仍在。云端请求有批次上限，不自动重试；实际费用由服务商决定。' },
  { id: 'unsupported', title: '暂不支持的能力', terms: '暂不支持 删除 移动 去重 递归 ICS HEIC GIF DOC XLS PPT 监听 扫描 PDF', body: '暂不提供旧 DOC / XLS / PPT、Office 内嵌图像提取、HEIC / GIF、宏文档、递归目录、原位移动、永久删除、日历 ICS、自动去重或后台监听。CSV 的内容分析不等于票据导出功能。' },
]
const topicIds = new Set(topics.map(topic => topic.id))

export interface HelpPageProps {
  onPractice?: () => void
  onReplayTour?: () => void
  exerciseCompleted?: boolean
  session?: HelpSession
  supportedExtensions?: string[]
}

export function HelpPage({ onPractice, onReplayTour, exerciseCompleted = false, session, supportedExtensions }: HelpPageProps) {
  const [query, setQuery] = useSessionState(session, 'query', '')
  const [expandedTopic, setExpandedTopic] = useState<string | null>(() => {
    const id = window.location.hash.replace(/^#help-topic-/, '')
    return topicIds.has(id) ? id : null
  })
  const results = useMemo(() => {
    const currentTopics = (isWebExperience ? [{ id: 'web-experience', title: '五阶段网页体验', terms: '载入 文本 分类 Worker 内存 图谱 清单', body: '载入学习样例或主动选择1至10份UTF-8 TXT/Markdown（每份512 KiB、总计2 MiB）；分析正文并看依据；核对分类；独立确认加入内存资料库；导出JSON/CSV清单和分析关联。文本在浏览器计算，刷新即清空；没有真实复制、磁盘撤回、云端调用或实时图片识别。图片预录结果单独标明。步骤代表任务阶段，每阶段包含多个操作。' }] : topics).map(topic => topic.id === 'supported-files' ? { ...topic, body: `${supportedFormats(supportedExtensions)}只读取所选目录的直接子文件，不递归进入子目录，也不跟随链接。子目录可单独确认打开；递归扫描尚未启用。` } : topic)
    const needle = query.trim().toLocaleLowerCase()
    return needle ? currentTopics.filter(topic => `${topic.title} ${topic.terms} ${topic.body}`.toLocaleLowerCase().includes(needle)) : currentTopics
  }, [query, supportedExtensions])

  useEffect(() => {
    const openLinkedTopic = () => {
      const id = window.location.hash.replace(/^#help-topic-/, '')
      if (topicIds.has(id)) setExpandedTopic(id)
    }
    window.addEventListener('hashchange', openLinkedTopic)
    return () => window.removeEventListener('hashchange', openLinkedTopic)
  }, [])

  useEffect(() => {
    if (!expandedTopic || !results.some(topic => topic.id === expandedTopic)) return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`help-topic-${expandedTopic}`)?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [expandedTopic, results])

  useEffect(() => {
    if (expandedTopic && !results.some(topic => topic.id === expandedTopic)) setExpandedTopic(null)
  }, [expandedTopic, results])

  return <>
    <section className="page-intro help-intro"><div><span className="intro-label">简单开始，放心整理</span><h1>一份清晰的使用指南<span>。</span></h1><p>先了解流程，再决定哪些文件要整理。</p></div>
      {onReplayTour ? <button className="button secondary help-tour-button" onClick={onReplayTour}><BookOpen size={16} />重新开始导览<ArrowRight size={14} /></button> : null}
    </section>
    <section className="help-content">
      <section className="help-practice-card" aria-label="安全练习">
        <div><span className="intro-label">内置样例 · 分步练习</span><h2>先在练习里熟悉每一步</h2><p>用一个样例完成选择、分析、审核、计划确认和副本查看；记录与撤回可选。不会读取本机文件或访问 API。</p></div>
        {exerciseCompleted ? <span className="practice-badge"><ShieldCheck size={14} />练习已完成</span> : null}
        {onPractice ? <button className="button primary" onClick={onPractice}>开始安全练习<ArrowRight size={14} /></button> : null}
      </section>

      <header className="help-heading-row"><div><span className="intro-label">本地参考</span><h2>按主题查找说明</h2></div>
        <label className="help-search"><Search size={17} /><input type="search" role="searchbox" aria-label="搜索使用说明" placeholder="搜索目录、复核、撤回…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      </header>

      <h2 className="help-section-title">{isWebExperience ? "五个阶段，整理学习资料" : "六个阶段，把文件理清楚"}</h2>
      {!isWebExperience ? <WorkflowOverview label="完整整理流程" /> : null}
      <div className="help-steps">
        {(isWebExperience ? [{id:'choose',title:'载入资料',text:'学习样例或主动选择有限文本，只读入浏览器内存。'}, {id:'analyze',title:'分析与看依据',text:'Worker计算正文结构，显示候选和真实读取范围。'}, {id:'review',title:'核对分类',text:'人工确认当前分类与名称；修改后重新审核。'}, {id:'copy',title:'加入内存资料库',text:'独立核对计划后保存内存结果，可导出元数据清单。'}, {id:'library',title:'查找与关联',text:'预览资料并按实际正文匹配关系候选，查看依据。'}] : workflow).map((step, index) => <article key={step.id}>
          <img src={step.id === 'choose' ? '/help/folder.svg' : `/help/${step.id}.svg`} alt={`${step.title}阶段示意图`} loading={index > 2 ? 'lazy' : 'eager'} />
          <span>0{index + 1}</span><h3>{step.title}</h3><p>{step.text}</p>
        </article>)}
      </div>

      <div className="notice help-safety-note"><ShieldCheck size={23} /><div><strong>{isWebExperience ? "网页结果在哪里？" : "为什么首版保留原件？"}</strong><p>{isWebExperience ? "结果仅在本页内存，没有创建真实文件；刷新即清空。需要保留时在资料库导出清单。本地版使用独立确认的副本模式。" : "移动和删除存在文件竞争、外部修改与系统中断风险。当前执行器使用独占创建、复制校验和分步记录。副本模式以文件安全为先，不会释放磁盘空间。"}</p></div></div>

      <section className="help-topics" aria-live="polite" aria-label="帮助主题">
        <div className="help-topic-heading"><h2>详细说明</h2><span>{results.length} 个主题</span></div>
        {results.length ? <>
          <div className="help-topic-list">{results.map(topic => <details
            className="help-topic"
            id={`help-topic-${topic.id}`}
            key={topic.id}
            open={expandedTopic === topic.id}
          >
            <summary onClick={event => {
              event.preventDefault()
              const shouldOpen = expandedTopic !== topic.id
              setExpandedTopic(shouldOpen ? topic.id : null)
              const targetUrl = shouldOpen
                ? `#help-topic-${topic.id}`
                : `${window.location.pathname}${window.location.search}`
              window.history.replaceState(null, '', targetUrl)
            }}>{topic.title}</summary>
            {expandedTopic === topic.id ? <p>{topic.body}</p> : null}
          </details>)}</div>
        </>
          : <p className="help-empty">没有找到相关说明。可以试试“目录”“复核”或“撤回”。</p>}
      </section>
    </section>
  </>
}
