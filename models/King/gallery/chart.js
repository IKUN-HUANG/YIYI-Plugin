/**
 * @file 雷达图 SVG 生成。
 * @module models/King/gallery/chart
 */
import { escapeXml } from '#yiyi.utils'
import { toText } from '../Common.js'

/**
 * 五维数据画成雷达图（SVG 字符串，直接内联进 hero-record.html）。
 * 维度少于 3 个画不成多边形，返回空串，模板那边退回到横条。
 *
 * @param {Array<{label: string, value: number}>} [radar] 各维度的名字与分值（0-100，超出会夹到边界）
 * @param {object} [opts] 画布与留白：width/height（像素，默认 440×400）、pad（四周留给文字的像素，默认 80）
 * @returns {string} 一整段 <svg>…</svg>；有效维度不足 3 个时给空串
 */
export function radarChart (radar = [], { width = 440, height = 400, pad = 80 } = {}) {
  const items = (Array.isArray(radar) ? radar : [])
    .map(item => ({
      label: toText(item?.label).trim(),
      value: Math.max(0, Math.min(100, Number(item?.value) || 0))
    }))
    .filter(item => item.label)

  if (items.length < 3) return ''

  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) / 2 - pad
  const labelR = radius + 28
  const step = (Math.PI * 2) / items.length
  const round = n => Number(n.toFixed(1))
  const point = (index, ratio) => {
    const angle = -Math.PI / 2 + step * index
    return [round(cx + Math.cos(angle) * radius * ratio), round(cy + Math.sin(angle) * radius * ratio)]
  }
  const xy = (index, ratio) => point(index, ratio).join(',')

  const rings = [0.25, 0.5, 0.75, 1]
    .map(ratio => `<polygon points="${items.map((_, index) => xy(index, ratio)).join(' ')}" fill="none" stroke="rgba(74,144,217,0.20)" stroke-width="1.5"/>`)
    .join('')
  const axes = items
    .map((_, index) => {
      const [x, y] = point(index, 1)
      return `<line x1="${round(cx)}" y1="${round(cy)}" x2="${x}" y2="${y}" stroke="rgba(74,144,217,0.24)" stroke-width="1.5"/>`
    })
    .join('')
  const area = `<polygon points="${items.map((item, index) => xy(index, item.value / 100)).join(' ')}" fill="rgba(59,130,246,0.28)" stroke="#3b82f6" stroke-width="2.5" stroke-linejoin="round"/>`
  const dots = items
    .map((item, index) => {
      const [x, y] = point(index, item.value / 100)
      return `<circle cx="${x}" cy="${y}" r="4.5" fill="#3b82f6" stroke="#ffffff" stroke-width="2"/>`
    })
    .join('')
  const labels = items
    .map((item, index) => {
      const [x, y] = point(index, labelR / radius)
      const anchor = x > cx + 4 ? 'start' : (x < cx - 4 ? 'end' : 'middle')
      const dy = y < cy - 12 ? -4 : (y > cy + 12 ? 20 : 6)
      return `<text x="${x}" y="${round(y + dy)}" text-anchor="${anchor}" font-size="17" fill="#33517a"><tspan font-weight="700">${escapeXml(item.label)}</tspan> ${item.value}</text>`
    })
    .join('')

  return `<svg class="k-radar-svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img">${rings}${axes}${area}${dots}${labels}</svg>`
}
