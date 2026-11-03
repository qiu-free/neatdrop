import { fireEvent, render, screen } from '@testing-library/react'
import { ContentQuality } from './ContentQuality'
import type { ContentQualityReport } from '../types'

const limited: ContentQualityReport = { state: 'limited', issues: ['ocr_low_confidence'],
  summary: '部分图片文字不够可靠，请核对原图。', metrics: { text_chars: 120, readable_chars: 95, replacement_chars: 0, ocr_lines: 8, ocr_mean_confidence: .8 } }

it('explains a reading limitation without presenting OCR scores as classification accuracy', () => {
  render(<ContentQuality quality={limited} />)
  const section = screen.getByRole('region', { name: '内容读取质量' })
  expect(section).toHaveTextContent('读取受限')
  expect(section).toHaveTextContent('部分图片文字不够可靠，请核对原图。')
  expect(section).toHaveTextContent('请结合原图核对文字，再确认分类与名称。')
  expect(section).not.toHaveTextContent(/80%|0\.8|准确率/)
  fireEvent.click(screen.getByText('查看读取信息'))
  expect(screen.getByText('已提取文字：120 字符')).toBeVisible()
  expect(screen.getByText('OCR 文字行：8 行')).toBeVisible()
})

it('does not add a reading panel to suggestions from older servers', () => {
  render(<ContentQuality />)
  expect(screen.queryByRole('region')).not.toBeInTheDocument()
})

it('keeps acceptable extraction separate from a confirmed classification', () => {
  render(<ContentQuality quality={{ state: 'acceptable', issues: [], summary: '已完成本次内容读取。', metrics: { text_chars: 350 } }} />)
  const section = screen.getByRole('region')
  expect(section).toHaveTextContent('内容已读取')
  expect(section).toHaveTextContent('读取状态不代表归档用途已确认。')
  expect(section).not.toHaveTextContent('已确认此项')
})

it('falls back safely for unknown states, duplicate issues and invalid metrics', () => {
  render(<ContentQuality quality={{ state: 'future', summary: '', issues: ['partial_read', 'partial_read', '__proto__'],
    metrics: { text_chars: -4, ocr_lines: Number.NaN } } as unknown as ContentQualityReport} />)
  expect(screen.getByRole('region')).toHaveTextContent('读取状态待核对')
  fireEvent.click(screen.getByText('查看读取信息'))
  expect(screen.getAllByText('仅读取了部分内容')).toHaveLength(1)
  expect(screen.queryByText(/NaN|-4|__proto__/)).not.toBeInTheDocument()
})

it('prompts manual classification when no readable document content is available', () => {
  render(<ContentQuality quality={{ state: 'unavailable', issues: ['no_readable_text'], summary: '没有提取到可用文字。', metrics: {} }} />)
  expect(screen.getByRole('region')).toHaveTextContent('请核对原文件，手动选择分类并保留合适的名称。')
})
