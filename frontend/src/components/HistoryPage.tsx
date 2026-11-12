import { History, RotateCcw, Check, CircleAlert, FolderOpen } from 'lucide-react'
import { explain } from '../api'
import { isWebExperience, runtimeCapabilities } from '../runtimeCapabilities'
import type { useWorkspace } from '../useWorkspace'

const localLabels: Record<string, string> = { completed: '已生成副本', partial: '部分未完成', incomplete: '需要恢复检查', corrupt: '记录校验失败', undone: '归档副本已撤回', planned: '未执行', copying: '复制未确认', failed: '失败' }
export function HistoryPage({ state }: { state: ReturnType<typeof useWorkspace> }) {
  const { workspace, history } = state
  const labels = isWebExperience ? { ...localLabels, completed: '已加入内存资料库', undone: '已移除内存结果' } : localLabels
  function action(id: string, kind: 'undo' | 'acknowledge') {
    const message = isWebExperience ? '仅移除浏览器内存中的整理结果，原始文件不会改变。继续？' : kind === 'undo' ? '撤回会将未修改的归档副本移入 .neatdrop/withdrawn，原始文件不动。不会删除文件或释放磁盘空间。继续？' : '请先检查下面各项的源文件、目标副本及日志。确认已人工核对并保留现有文件？应用不会自动重放或删除残留副本。'
    if (window.confirm(message)) void state.historyAction(id, kind)
  }
  return <><section className="page-intro"><div><span className="intro-label">每次整理，都有迹可循</span><h1>记录变化，保留退路<span>。</span></h1><p>{workspace ? workspace.path : isWebExperience ? '先在工作台确认并加入内存资料库，这里会显示本页操作记录。' : '先在整理工作台选择目录，即可读取目录中的本地记录。'}</p></div></section>
    {!history.length ? <section className="empty-history"><History size={37} strokeWidth={1.2} /><h2>这里记录真正发生的整理</h2><p>{isWebExperience ? "分析建议不代表已经保存。确认加入内存资料库后才记录结果；刷新即清空。" : "分析建议不会计为执行成功。生成归档副本后，结果会按文件逐项记录。"}</p></section> : history.map(transaction => <section className="transaction" key={transaction.id}><header><div><span className={`transaction-status ${transaction.status === 'completed' || transaction.status === 'undone' ? 'green' : 'warning'}`}>{transaction.status === 'completed' || transaction.status === 'undone' ? <Check size={15} /> : <CircleAlert size={15} />}{labels[transaction.status] ?? transaction.status}</span><small>{transaction.created ? new Date(transaction.created).toLocaleString('zh-CN') : '记录不完整'} · {transaction.id.slice(0, 10)}</small></div><div className="history-actions">{transaction.undo_verified && transaction.items.some(i => i.stage === 'completed') && (state.config?.undo_supported || runtimeCapabilities.canOrganizeInMemory) ? <button className="button secondary" disabled={!!state.busy} onClick={() => action(transaction.id, 'undo')}><RotateCcw size={15} />{isWebExperience ? '移除体验结果' : '撤回归档副本'}</button> : null}{['partial', 'incomplete'].includes(transaction.status) && !transaction.acknowledged ? <button className="button secondary" disabled={!!state.busy} onClick={() => action(transaction.id, 'acknowledge')}>已人工检查，保留现状</button> : null}</div></header>
      {transaction.status === 'corrupt' ? <div className="notice warning">日志校验失败，已阻止继续写入。请勿删除记录，人工核对 .neatdrop/transactions 中的日志和现有文件。</div> : null}
      {transaction.legacy_read_only ? <div className="notice warning">此记录没有当前安装的可信归档凭据，只能查看，不能自动撤回。旧文件保持原状，请人工管理。</div> : null}
      {transaction.items.map(item => <div className="history-item" key={item.file_id}><FolderOpen size={17} /><div><strong>{item.source}</strong><span>{item.target}</span>{item.error ? <p className="warning">{explain(item.error)}</p> : null}</div><span className={`history-stage ${item.stage === 'completed' || item.stage === 'undone' ? 'green' : 'warning'}`}>{labels[item.stage] ?? item.stage}</span></div>)}
      <footer>{isWebExperience ? '仅浏览器内存 · 没有磁盘副本' : '原件保留 · 副本模式'}{transaction.acknowledged ? ' · 已人工检查并保留现状' : ''}</footer></section>)}
    {!isWebExperience ? <div className="history-disclaimer"><CircleAlert size={17} /><p>撤回不是删除：副本移入当前目录的 <code>.neatdrop/withdrawn</code>，仍占用空间。已修改或被占用的副本不自动撤回。事务日志包含文件名和路径，不加密；请勿随意清除。</p></div> : <p className="notice">这里仅记录本页内存中的整理操作，刷新后清空。没有磁盘复制或撤回。</p>}
  </>
}
