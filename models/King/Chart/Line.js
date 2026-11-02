/**
 * @file Chart模块的一片实现：折线图（带断点、金色峰值与标签防叠）。
 *
 * @module models/Chart/Line
 */
import { toText, escapeXml } from '#yiyi.utils'
import { round } from './Util/Num.js'

/**
 * 折线图。points: [{ label, value, mark, gap, strong }]
 * - mark：画在点上的文字（段位这种「y 值只是离散档位、真正含义在段位名」的场景用它，
 *   不传就画 value 本身）；
 * - strong：这一点用金色标出来（「最高那个赛季」就靠它，营地卡走势图用）；
 * - gap：这一点和上一点之间断开（赛季重置 / 换了游戏角色，直接连会把「重置」画成「掉段」）；
 * - axis:false 时不画 y 轴刻度数字（离散档位时那些数字没有意义）；
 * - markAll:true 时每个点都标数字（点少又要每个值都看得见时用，默认只标首尾与峰值）。
 * 点少于 2 个就返回空串（一条线画不出趋势，模板会退回只显示数字）。
 *
 * @param {Array<object>} [points] 数据点：{ label（横轴文字）, value（纵轴数值）, mark（画在点上的文字，默认画 value）, gap（与上一点断开）, strong（金色高亮）, note（备注） }
 * @param {object} [opts] 外观选项：width/height（画布像素，默认 640×260）、color（主色）、unit（数值后缀）、axis（是否画 y 轴刻度）、padLeft/padRight/padTop（内边距像素）、markAll（每个点都标数字）、markAbove（数字一律写在点上方）
 * @returns {string} 一整段 <svg>…</svg>；有效点不足 2 个时给空串
 */
export function lineChart (points = [], {
  width = 640,
  height = 260,
  color = '#3b82f6',
  unit = '',
  axis = true,
  /** 左边要放「1650」这种四位刻度，46px 会被裁掉首位数字（曾出现 1650.2 显示成 550.2） */
  padLeft = 46,
  padRight = 24,
  /** 每个点都标数字时顶上得先留出写字的地方，否则最高那个点会被画布切掉 */
  padTop = 26,
  markAll = false,
  /** 一律把数字写在点上方（点在下面就是面积色块，写字不会被线压住） */
  markAbove = false
} = {}) {
  const list = (Array.isArray(points) ? points : [])
    .map((item, index) => ({
      label: toText(item?.label) || `#${index + 1}`,
      value: Number(item?.value),
      mark: toText(item?.mark),
      gap: Boolean(item?.gap),
      strong: Boolean(item?.strong),
      note: toText(item?.note)
    }))
    .filter(item => Number.isFinite(item.value))

  if (list.length < 2) return ''

  const left = padLeft
  const right = width - padRight
  const padBottom = 40
  const innerW = right - left
  const innerH = height - padTop - padBottom

  const values = list.map(item => item.value)
  const max = Math.max(...values)
  const min = Math.min(...values)
  /** 全平的一段线要留出上下空白，否则会贴在顶边或底边，看着像是被截断 */
  const span = max - min || Math.max(1, Math.abs(max) * 0.1)
  const top = max + span * 0.12
  const bottom = min - span * 0.12
  const ratio = value => (top - value) / (top - bottom || 1)

  const step = list.length > 1 ? innerW / (list.length - 1) : 0
  const xy = (item, index) => [round(left + step * index), round(padTop + innerH * ratio(item.value))]

  /** 按 gap 切成若干段：段内连线，段间留白 */
  const segments = []
  list.forEach((item, index) => {
    if (!segments.length || item.gap) segments.push([])
    segments[segments.length - 1].push([item, index])
  })

  const toPoints = seg => seg.map(([item, index]) => xy(item, index).join(',')).join(' ')

  const grid = [0, 0.5, 1]
    .map(part => {
      const y = round(padTop + innerH * part)
      const value = Math.round(top - (top - bottom) * part)
      const dash = part === 1 ? '0' : '6 6'
      const label = axis
        ? `<text x="${left - 10}" y="${round(y + 5)}" text-anchor="end" font-size="15" fill="#7b90ad">${escapeXml(value)}</text>`
        : ''
      return `<line x1="${left}" y1="${y}" x2="${round(right)}" y2="${y}" stroke="rgba(74,144,217,0.18)" stroke-width="1.5" stroke-dasharray="${dash}"/>${label}`
    })
    .join('')

  const dots = list
    .map((item, index) => {
      const [x, y] = xy(item, index)
      const dot = item.strong ? '#c9930a' : color
      const r = item.strong ? 5.5 : 4.5
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="${dot}" stroke="#ffffff" stroke-width="2"/>`
    })
    .join('')

  /**
   * 默认只标首尾与峰值三点（中间点太多会糊成一片）；markAll 时每个点都标。
   * strong 的那一点（最高赛季）换成金色，一眼看得出哪个赛季星数最高。
   * 峰值取**最后一次**出现最高值的那个点：最高值常常连着好几个点（两把都打了最高星），
   * 取 indexOf 会标在倒数第二个点上，跟末点的标签挤在同一个 14px 的点距里叠成一团
   * —— 实测出现过「王者 636★」这种两层字压一起的糊字。
   */
  const PeakIndex = values.lastIndexOf(max)
  const markIndexes = markAll
    ? list.map((item, index) => index)
    : [...new Set([0, list.length - 1, PeakIndex])]
  /**
   * 标签防叠：点距只有 14px 上下，而「1525」这种四个字就要 52px 宽，
   * 峰值点跟末点挨着时两行字必然压在一起。这里按矩形判交，
   * 撞上了就把后一个标签整体往上/往下让一行，实在让不开才不画。
   */
  const placed = []
  const hits = (rect) => placed.some(other =>
    Math.abs(other.cx - rect.cx) * 2 < other.wide + rect.wide - 2 &&
    Math.abs(other.cy - rect.cy) < Math.max(other.size, rect.size) + 3)
  const marks = markIndexes
    .map(index => {
      const item = list[index]
      const [x, y] = xy(item, index)
      const above = markAbove || y > padTop + 22
      const text = item.mark || `${round(item.value)}${unit}`
      /**
       * 首尾两点的标签要往画布里收：居中写在最后一个点上，右半边会直接溢出画布被裁。
       * 按字数粗估宽度，贴边就改锚点。
       */
      const wide = Math.min(text.length * 13, innerW)
      let anchor = 'middle'
      let tx = x
      if (x - wide / 2 < 4) {
        anchor = 'start'
        tx = Math.max(4, x - 2)
      } else if (x + wide / 2 > width - 4) {
        anchor = 'end'
        tx = Math.min(width - 4, x + 2)
      }
      const size = item.strong ? 18 : 15
      const fill = item.strong ? '#c9930a' : '#2b4a76'
      const baseY = above ? y - 12 : y + 20
      const tries = above ? [baseY, baseY - (size + 4), baseY - (size + 4) * 2] : [baseY, baseY + (size + 4), baseY + (size + 4) * 2]
      const cx = anchor === 'middle' ? tx : (anchor === 'start' ? tx + wide / 2 : tx - wide / 2)
      let ty = null
      for (const candidate of tries) {
        if (candidate < 8 || candidate > height - 6) continue
        if (hits({ cx, cy: candidate, wide, size })) continue
        ty = candidate
        break
      }
      if (ty === null) return ''
      placed.push({ cx, cy: ty, wide, size })
      return `<text x="${round(tx)}" y="${round(ty)}" text-anchor="${anchor}" font-size="${size}" font-weight="700" fill="${fill}">${escapeXml(text)}</text>`
    })
    .join('')

  const ticks = [0, Math.floor((list.length - 1) / 2), list.length - 1]
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .map(index => {
      const [x] = xy(list[index], index)
      const anchor = index === 0 ? 'start' : (index === list.length - 1 ? 'end' : 'middle')
      return `<text x="${x}" y="${height - 12}" text-anchor="${anchor}" font-size="14" fill="#7b90ad">${escapeXml(list[index].label)}</text>`
    })
    .join('')

  const shapes = segments
    .map(seg => {
      const pts = toPoints(seg)
      if (seg.length < 2) return ''
      const [fx, fy] = xy(seg[0][0], seg[0][1])
      const [lx] = xy(seg[seg.length - 1][0], seg[seg.length - 1][1])
      const base = round(padTop + innerH)
      return `<polygon points="${fx},${base} ${pts} ${lx},${base}" fill="${color}" fill-opacity="0.16"/>`
        + `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
    })
    .join('')

  return `<svg class="k-chart-svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img">`
    + `${grid}${shapes}${dots}${marks}${ticks}</svg>`
}
