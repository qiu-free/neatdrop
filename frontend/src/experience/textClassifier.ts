import type { EvidenceItem, Suggestion } from '../types'
import profiles from './studyProfiles.generated.json'

type Rule = { subtype: string; anchor: RegExp; support: RegExp[]; minimum: number }
const rules: Rule[] = [
  { subtype: 'notes', anchor: /课程笔记|学习笔记|复习笔记|读书笔记|课堂笔记|lecture notes/i, support: [/定义|概念|definition/i, /定理|证明|推导|theorem/i, /例题|习题|复习|知识点|矩阵|向量|算法/], minimum: 2 },
  { subtype: 'courseware', anchor: /课件|教学大纲|教学计划|syllabus|lecture slides/i, support: [/课程|教学|讲义|授课/, /章节|第[一二三四五六七八九十\d]+[章节讲]|学时|学习目标|课堂讨论/], minimum: 2 },
  { subtype: 'paper', anchor: /研究论文|学术论文|文献综述|毕业论文|abstract|研究方法/i, support: [/摘要|abstract/i, /方法|method/i, /结果|结论|results|conclusion/i, /参考文献|references|doi\s*:/i], minimum: 3 },
  { subtype: 'exam', anchor: /试卷|试题|练习题|模拟考试|习题集|考试题/i, support: [/选择题|填空题|证明题|解答题/, /答案|解析|得分|满分|每题|求解|计算下列/], minimum: 2 },
  { subtype: 'experiment_material', anchor: /实验记录|实验报告|实验资料|实验指导/, support: [/实验目的[：:]\s*[^\s。]+/, /实验器材[：:]|实验设备[：:]|实验材料[：:]/, /实验步骤[：:]|实验方法[：:]/, /实验结果[：:]|实验数据[：:]/], minimum: 3 },
  { subtype: 'research_data', anchor: /研究数据|科研测量|研究观测|科研数据/, support: [/研究课题[：:]|研究项目[：:]|研究背景[：:]/, /变量定义[：:]|变量说明[：:]|观测数据[：:]|测量值[：:]/, /采集日期[：:]|采集方法[：:]|数据单位[：:]|样本编号[：:]/], minimum: 3 },
  { subtype: 'technical_document', anchor: /技术文档|接口文档|API.{0,3}文档|使用手册|部署文档/i, support: [/请求参数|输入参数|配置参数|安装步骤|操作步骤/, /返回值|响应结果|错误码|依赖版本|调用示例/], minimum: 2 },
  { subtype: 'reading_excerpt', anchor: /读书摘录|阅读摘录|读书摘抄|书籍摘录/, support: [/书名[：:]|作者[：:]/, /摘录原文[：:]|摘录内容[：:]|阅读心得[：:]|原文摘抄[：:]/, /页码[：:]|章节[：:]/], minimum: 2 },
]
const descriptions = new Map(profiles.profiles.map(profile => [profile.subcategory, profile.definition]))
const instructions = /(?:如何|怎样|怎么)(?:.{0,12})(?:写|填写|识别|制作)(?:.{0,10})(?:论文|实验|笔记)|(?:教程|教学示例|占位模板)|不是(?:.{0,8})(?:实验记录|论文|课程笔记)/

/** A conservative browser subset. No filename-only purpose, model call or implied probability. */
export function classifyText(id: string, name: string, source: string): Suggestion {
  const text = source.slice(0, 12000), truncated = source.length > text.length
  const readable = [...text].filter(char => /[\p{L}\p{N}]/u.test(char)).length
  const scope = text.slice(0, 400)
  const candidates = readable >= 30 && !instructions.test(scope) ? rules.flatMap(rule => {
    const anchor = rule.anchor.exec(text)
    const support = rule.support.map(pattern => pattern.exec(text)).filter((match): match is RegExpExecArray => !!match)
    if (!anchor || support.length < rule.minimum) return []
    return [{ rule, anchor, support, weight: support.length / rule.support.length }]
  }).sort((a, b) => b.weight - a.weight || b.support.length - a.support.length) : []
  const best = candidates[0]
  const ambiguous = candidates.length > 1 && candidates[1].weight === best.weight
  const evidence: EvidenceItem[] = best ? [best.anchor, ...best.support.slice(0, 3)].map(match => ({ source: 'body', text: match[0], start: match.index, end: match.index + match[0].length })) : []
  const reasons = best ? ['purpose_uncalibrated', ...(ambiguous ? ['subtype_ambiguous'] : []), ...(truncated ? ['partial_content'] : [])] : ['insufficient_evidence']
  return {
    file_id: id, name, category: best ? 'study' : 'other', subcategory: best ? ambiguous ? null : best.rule.subtype : 'unclassified',
    evidence: best ? '浏览器根据正文结构生成学习用途候选，尚未完成独立质量校准。' : '没有足够的学习用途证据，保留原名与待分类。',
    review_required: true, decision_level: best ? 'candidate' : 'abstain', provider: 'browser_rules',
    sample: truncated ? '浏览器本地读取前12000字符；其余未分析' : '浏览器本地完整读取文本',
    content_form: 'text_document', tags: [], review_reasons: reasons, evidence_items: evidence,
    candidates: candidates.slice(0, 3).map(({ rule }) => ({ category: 'study', subcategory: rule.subtype, evidence: descriptions.get(rule.subtype) ?? '正文结构支持' })),
    engine_versions: { rules: 'web-study-1', profiles: profiles.version },
    sampling: { kind: 'text', truncated, budget_exhausted: truncated, summary: truncated ? '前12000字符；部分内容未读取' : '完整文本', segments: [{ start: 0, end: text.length }] },
    quality: { state: readable < 8 ? 'unavailable' : truncated ? 'limited' : 'acceptable', issues: readable < 8 ? ['no_readable_text'] : truncated ? ['partial_read'] : [], summary: '读取状态不代表分类准确率。', metrics: { text_chars: text.length, readable_chars: readable } },
  }
}
