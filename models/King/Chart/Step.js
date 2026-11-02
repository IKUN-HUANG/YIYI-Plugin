/**
 * @file Chart模块的一片实现：段位阶梯折线图。
 *
 * @module models/Chart/Step
 */
import { toText, escapeXml } from '#yiyi.utils'
import { round } from './Util/Num.js'

/**
 * 阶梯折线：段位趋势专用。
 * 段位不是连续量（星耀III 掉到星耀IV 只挪一格，王者段再涨星也只是同一格），
 * 所以纵轴取「离散档位」：points[].level 是 levels 的下标，线在档位之间走台阶。
 * points: [{ label, level, mark, gap }]，gap 断开（赛季重置 / 换游戏角色）。
 *
 * @param {Array<object>} [points] 数据点：{ label（横轴文字）, level（档位下标，指向 levels）, mark（画在点上的档位名）, gap（与上一点断开） }；level 不是数字的点会被丢掉
 * @param {object} [opts] 外观选项：width/height（画布像素，默认 640×280）、color（主色）、levels（档位名数组，按低到高排）、axis（是否画纵轴档位名）、padLeft/padRight（内边距像素）
 * @returns {string} 一整段 <svg>…</svg>；有效点不足 2 个或档位不足 2 档时给空串
 */
export function stepChart (points = [], {
  width = 640,
  height = 280,
  color = '#3b82f6',
  levels = [],
  axis = true,
  /** 左侧要放「永恒钻石II」这种五个字的档位名，留 46px 会被裁，所以左右分开给 */
  padLeft = 46,
  padRight = 24
} = {}) {
  const list = (Array.isArray(points) ? points : [])
    .map((item, index) => ({
      label: toText(item?.label) || `#${index + 1}`,
      level: Number(item?.level),
      mark: toText(item?.mark),
      gap: Boolean(item?.gap)
    }))
    .filter(item => Number.isFinite(item.level))

  const texts = (Array.isArray(levels) ? levels : []).map(item => toText(item?.text ?? item))
  const count = Math.max(texts.length, ...list.map(item => item.level + 1), 1)
  if (list.length < 2 || count < 2) return ''

  const left = padLeft
  const right = width - padRight
  const padTop = 26
  const padBottom = 40
  const innerW = right - left
  const innerH = height - padTop - padBottom

  const ratio = level => 1 - Math.min(count - 1, Math.max(0, level)) / (count - 1)
  const step = list.length > 1 ? innerW / (list.length - 1) : 0
  const xOf = index => round(left + step * index)
  const yOf = level => round(padTop + innerH * ratio(level))

  /** 纵轴最多标 5 档：档位多的时候等距抽，全标会糊成一片 */
  const tickTotal = Math.min(5, count)
  const tickIndexes = []
  for (let i = 0; i < tickTotal; i += 1) {
    tickIndexes.push(Math.round((count - 1) * (tickTotal === 1 ? 0 : i / (tickTotal - 1))))
  }
  const grid = [...new Set(tickIndexes)]
    .map(level => {
      const y = yOf(level)
      const text = axis ? escapeXml(texts[level] || '') : ''
      const label = text ? `<text x="${left - 10}" y="${round(y + 5)}" text-anchor="end" font-size="15" fill="#7b90ad">${text}</text>` : ''
      return `<line x1="${left}" y1="${y}" x2="${round(right)}" y2="${y}" stroke="rgba(74,144,217,0.18)" stroke-width="1.5" stroke-dasharray="6 6"/>${label}`
    })
    .join('')

  /** 按 gap 切段：段内台阶连线，段间留白（不断开的话赛季重置会被画成一条垂直掉分线） */
  const segments = []
  list.forEach((item, index) => {
    if (!segments.length || item.gap) segments.push([])
    segments[segments.length - 1].push([item, index])
  })

  const shapes = segments
    .map(seg => {
      if (!seg.length) return ''
      const base = round(padTop + innerH)
      const coords = seg.map(([item, index]) => [xOf(index), yOf(item.level)])
      /** 台阶：横向走到下一个点的 x，再竖着落到下一档 */
      const steps = [`${coords[0][0]},${coords[0][1]}`]
      for (let i = 1; i < coords.length; i += 1) {
        steps.push(`${coords[i][0]},${coords[i - 1][1]}`)
        steps.push(`${coords[i][0]},${coords[i][1]}`)
      }
      const line = steps.join(' ')
      const area = `${coords[0][0]},${base} ${line} ${coords[coords.length - 1][0]},${base}`
      const dots = coords
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="${color}" stroke="#ffffff" stroke-width="2"/>`)
        .join('')
      const poly = seg.length > 1
        ? `<polygon points="${area}" fill="${color}" fill-opacity="0.14"/>`
          + `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
        : ''
      return poly + dots
    })
    .join('')

  const markIndexes = [...new Set([0, list.length - 1])]
    .concat(list.map((item, index) => (item.mark ? index : -1)).filter(index => index >= 0))
  const marks = [...new Set(markIndexes)]
    .filter(index => index >= 0 && index < list.length)
    .map(index => {
      const item = list[index]
      const x = xOf(index)
      const y = yOf(item.level)
      const above = y > padTop + 24
      return `<text x="${x}" y="${round(above ? y - 14 : y + 22)}" text-anchor="middle" font-size="15" font-weight="700" fill="#2b4a76">${escapeXml(item.mark || texts[item.level] || '')}</text>`
    })
    .join('')

  const ticks = [0, Math.floor((list.length - 1) / 2), list.length - 1]
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .map(index => {
      const anchor = index === 0 ? 'start' : (index === list.length - 1 ? 'end' : 'middle')
      return `<text x="${xOf(index)}" y="${height - 12}" text-anchor="${anchor}" font-size="14" fill="#7b90ad">${escapeXml(list[index].label)}</text>`
    })
    .join('')

  return `<svg class="k-chart-svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img">`
    + `${grid}${shapes}${marks}${ticks}</svg>`
}
