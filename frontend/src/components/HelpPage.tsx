import { useMemo, useState } from 'react'
import { ArrowRight, BookOpen, Search, ShieldCheck } from 'lucide-react'
import './tutorial.css'
import './help.css'

interface HelpTopic {
  id: string
  title: string
  terms: string
  body: string
}

const topics: HelpTopic[] = [
  { id: 'supported-files', title: '支持的文件和目录', terms: '目录 文件夹 扫描 格式 图片 照片 PDF 文档 文本 JPG JPEG PNG WebP TXT Markdown', body: '支持 JPG / JPEG / PNG / WebP 静态图片、文本型 PDF、UTF-8 TXT 和 Markdown。只读取所选目录的直接子文件，不递归进入子目录，也不跟随链接。' },
  { id: 'photos-documents-categories', title: '照片、文档和分类', terms: '照片 图片 photo OCR 文档 票据凭证 学习科研 工作办公 活动事务 生活服务 设计娱乐 临时资料 待分类', body: '静态图片会结合可用的视觉内容与 OCR 文字，文本型 PDF 和 TXT / Markdown 则使用提取到的文字。分类覆盖票据凭证、学习科研、工作办公、活动事务、生活服务、照片影像、设计娱乐、临时资料和待分类；内容证据不足时应保留待复核。' },
  { id: 'batch-limits', title: '批次容量边界', terms: '容量 限制 大小 数量 MiB 像素 文件数', body: '每批最多 50 个文件、单个不超过 20 MiB、合计不超过 200 MiB；目录最多列出 2000 项。图片预览长边不超过 1024 px。' },
  { id: 'analysis-review', title: '分析和复核', terms: '模型 建议 复核 证据 分类 编辑 选择 侧栏', body: '待复核文件可以加入批次，分析后保留选择；生成计划前仍须明确审核。点击文件打开右侧详情栏，勾选只加入批次。可以在详情中搜索分类、查看完整副本位置和修改名称。图表类型与归档用途分别核对，模型建议不是安全保证。' },
  { id: 'batch-review-categories', title: '批量核对和分类', terms: '批量 批次 核对 一键审核 分类 勾选 选择 复核 状态 图表 网格', body: '复核页核对列表后，可一键审核已选项，包括当前分类候选；未分析且未编辑、或仍有分析错误的项不能通过。编辑分类或名称后必须重新审核。批量分类和重新分析在更多操作中。批量选择只作用于当前可见项，图片较多时默认网格，可切换列表。' },
  { id: 'archive-library', title: '资料库查看副本', terms: '资料库 副本 分类 存放 保存 预览 搜索 位置 侧栏', body: '资料库按分类展示当前授权目录内的归档副本，可搜索名称并点击打开右侧预览。文件保存在本机分类子目录，不上传到云端。刷新或重启后重新选择同一目录即可再次查看记录。最多显示最近1000份；已撤回项不显示，丢失、修改、替换或缺少本机可信凭据的副本不能预览。' },
  { id: 'offline-cloud-analysis', title: '离线与云端分析', terms: '离线 本地 云端 网络 上传 私有 成本', body: '本地规则与已准备好的离线模型无需网络，不会把文件内容发给服务商。云端分析需要配置服务地址和密钥，并在每批分析前单独授权；确认前先核对将发送的抽样内容。云端内容受服务商政策约束，可能产生费用。' },
  { id: 'model-settings', title: '模型服务设置', terms: '设置 百炼 自定义 endpoint 地址 密钥 API key 保存 环境变量 锁定 Chat Completions', body: '可以使用百炼兼容服务或自定义公网 HTTPS 端点。页面会标明字段来自环境配置、本机设置或默认值；环境配置字段会锁定。已保存的密钥不会回显，可选择保留、更换或移除。保存只更新本机设置，不连接服务商；连接测试只发送固定文字，需明确确认目标并知悉可能计费。' },
  { id: 'archive-copy', title: '确认和归档副本', terms: '确认 计划 执行 副本 原件 安全 保留', body: '生成计划后先核对源文件和目标位置，再明确确认。执行采用创建副本的方式，保留原件；目标名称冲突时不会覆盖。副本模式不会释放磁盘空间。' },
  { id: 'interrupt-resume', title: '中断和恢复', terms: '中断 恢复 操作记录 失败 重启', body: '重新打开相同目录后查看操作记录。不完整或失败事务需要先人工检查源与目标，再确认保留现状；损坏日志会阻止继续写入，不会自动重放。' },
  { id: 'withdraw-copy', title: '副本撤回', terms: '撤回 撤销 undo 副本 原件 修改 Windows', body: 'Windows 下可以把未经修改的归档副本撤回到 .neatdrop/withdrawn，原件保持不动。修改过的副本保留现状；其他平台不承诺自动撤回。' },
  { id: 'privacy-deployment', title: '隐私与部署', terms: '隐私 上传 网络 路径 部署 localhost 127.0.0.1', body: '本地服务只面向 127.0.0.1，不可直接暴露到公网。云端内容受所配置服务商的隐私政策约束；本地操作记录包含路径信息，不加密。' },
  { id: 'sessions-costs', title: '会话与费用', terms: '费用 价格 成本 会话 请求 限额 网络', body: '本地会话有效 8 小时；完成的分析状态约保留 15 分钟。服务重启会丢失分析与计划状态，但磁盘操作记录仍在。云端请求有批次上限，不自动重试；实际费用由服务商决定。' },
  { id: 'unsupported', title: '首版暂不支持', terms: '暂不支持 删除 移动 去重 递归 CSV ICS HEIC DOCX PPTX 监听', body: '首版不提供原位移动、永久删除、扫描 PDF OCR、DOCX / PPTX / HEIC、递归目录、票据 CSV、日历 ICS、自动去重或后台监听。' },
]

export interface HelpPageProps {
  onPractice?: () => void
  onReplayTour?: () => void
  exerciseCompleted?: boolean
}

export function HelpPage({ onPractice, onReplayTour, exerciseCompleted = false }: HelpPageProps) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return needle ? topics.filter(topic => `${topic.title} ${topic.terms} ${topic.body}`.toLocaleLowerCase().includes(needle)) : topics
  }, [query])

  return <>
    <section className="page-intro help-intro"><div><span className="intro-label">简单开始，放心整理</span><h1>一份清晰的使用指南<span>。</span></h1><p>先了解流程，再决定哪些文件要整理。</p></div>
      {onReplayTour ? <button className="button secondary help-tour-button" onClick={onReplayTour}><BookOpen size={16} />重新开始导览<ArrowRight size={14} /></button> : null}
    </section>
    <section className="help-content">
      <section className="help-practice-card" aria-label="安全练习">
        <div><span className="intro-label">内置样例 · 约 2 分钟</span><h2>先在练习里熟悉每一步</h2><p>用六个小任务体验查看、选择、分析、复核、确认和撤回；不会读取本机文件或访问 API。</p></div>
        {exerciseCompleted ? <span className="practice-badge"><ShieldCheck size={14} />练习已完成</span> : null}
        {onPractice ? <button className="button primary" onClick={onPractice}>开始安全练习<ArrowRight size={14} /></button> : null}
      </section>

      <header className="help-heading-row"><div><span className="intro-label">本地参考</span><h2>按主题查找说明</h2></div>
        <label className="help-search"><Search size={17} /><input type="search" role="searchbox" aria-label="搜索使用说明" placeholder="搜索目录、复核、撤回…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      </header>

      <h2 className="help-section-title">三个步骤，把文件理清楚</h2>
      <div className="help-steps">
        <article><img src="/help/folder.svg" alt="先选择一个工作目录" /><span>01</span><h3>选择一个目录</h3><p>选择本机目录或粘贴完整路径。只扫描直接子文件，不进入子目录，也不跟随链接。初次体验可以先完成上方的内存练习。</p></article>
        <article><img src="/help/review.svg" alt="查看状态与勾选选择分开表示" /><span>02</span><h3>分析，再预览</h3><p>离线分析无需网络。内容证据不足或分类冲突时会提醒复核；云端分析需要单独授权。查看文件和选择加入批次是两个独立动作。</p></article>
        <article><img src="/help/copy.svg" alt="保留原件并创建归档副本" /><span>03</span><h3>核对并生成副本</h3><p>修改建议后生成计划，再逐项检查目标位置。只有明确确认后才会生成副本；原件保留，目标冲突时不会覆盖。</p></article>
      </div>

      <div className="notice help-safety-note"><ShieldCheck size={23} /><div><strong>为什么首版保留原件？</strong><p>移动和删除存在文件竞争、外部修改与系统中断风险。当前执行器使用独占创建、复制校验和分步记录。副本模式以文件安全为先，不会释放磁盘空间。</p></div></div>

      <section className="help-topics" aria-live="polite" aria-label="帮助主题">
        <div className="help-topic-heading"><h2>详细说明</h2><span>{results.length} 个主题</span></div>
        {results.length ? <>
          <nav className="help-topic-directory" aria-label="帮助目录">
            {results.map(topic => <a key={topic.id} href={`#help-topic-${topic.id}`} onClick={() => document.getElementById(`help-topic-${topic.id}`)?.focus()}>{topic.title}</a>)}
          </nav>
          <div className="help-topic-grid">{results.map(topic => <article className="help-topic" id={`help-topic-${topic.id}`} tabIndex={-1} key={topic.id}><h3>{topic.title}</h3><p>{topic.body}</p></article>)}</div>
        </>
          : <p className="help-empty">没有找到相关说明。可以试试“目录”“复核”或“撤回”。</p>}
      </section>
    </section>
  </>
}
