import { classifyText } from './textClassifier'

const notes = '线性代数学习笔记\n线性映射与矩阵的秩。定义：线性变换保持向量加法与数乘。定理：秩等于独立向量个数。证明：对基向量构造矩阵，复习例题并整理自己的理解。'
const experiment = '光学实验记录\n实验目的：测量透镜焦距。实验器材：凸透镜和光源。实验步骤：调整物距，每隔十厘米记录像距。实验结果：五次测量焦距均值为12.4厘米。'

it('classifies actual body text even when filenames are misleading and changes with the content', () => {
  const result = classifyText('one', 'invoice.txt', notes)
  expect(result.category).toBe('study')
  expect(result.subcategory).toBe('notes')
  expect(classifyText('one', 'invoice.txt', experiment).subcategory).toBe('experiment_material')
  expect(result.evidence_items?.some(item => item.text && notes.includes(item.text))).toBe(true)
})

it('refuses unrelated, empty and instructional examples rather than forcing a learning label', () => {
  for (const text of ['', '买点水果，明天散步。', '这是如何填写实验报告的教程，不是实验记录。示例：实验目的：占位。实验步骤：待填写。实验结果：无。']) {
    const result = classifyText('one', '课程笔记.txt', text)
    expect(result.decision_level).toBe('abstain')
    expect(result.category).toBe('other')
  }
})

it('limits candidate count and marks partial input and uncalibrated rules for review', () => {
  const result = classifyText('one', 'notes.md', notes + '\n'.repeat(13000))
  expect(result.review_required).toBe(true)
  expect(result.candidates!.length).toBeLessThanOrEqual(3)
  expect(result.sampling?.truncated).toBe(true)
  expect(result.engine_versions?.rules).toBe('web-study-1')
  expect(result.name).toBe('notes.md')
})
