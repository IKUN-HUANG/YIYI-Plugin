import { toText, escapeXml } from '#yiyi.utils'

/**
 * @file 卡片里的图表零件：折线、横向柱、段位阶梯线，全部输出内联 SVG 字符串。
 * 只管「把一组数字画成 SVG」，不取数据、不管卡片排版；颜色/尺寸由调用方从模板变量传进来。
 *
 * 为什么用内联 SVG 而不是图表库：渲染器不需要 canvas，也不会因为外链图表库被墙而白图
 * （跟 Gallery.js 的 radarChart 一个路子）。
 */

function round (value) {
  return Number(Number(value).toFixed(1))
}

/**
 * 数值序列的极值、首末与变化量：趋势卡顶部那四格就是它算的。
 * 非数字与 NaN 会被剔掉再算，所以中间断一天不会把整条序列带偏。
 *
 * @param {Array<number|string>} [values] 按时间先后排好的数值序列
 * @returns {object|null} 有数时给 {first,last,max,min,delta,deltaText,maxText,minText,firstText,lastText}（数值保留一位小数，文本已带正负号或「持平」）；一个有效数都没有时给 null
 */
export function seriesStats (values = []) {
  const nums = (Array.isArray(values) ? values : []).map(Number).filter(num => Number.isFinite(num))
  if (!nums.length) return null

  const first = nums[0]
  const last = nums[nums.length - 1]
  const max = Math.max(...nums)
  const min = Math.min(...nums)
  return {
    first,
    last,
    max,
    min,
    delta: last - first,
    deltaText: last === first ? '持平' : `${last > first ? '+' : ''}${round(last - first)}`,
    maxText: String(round(max)),
    minText: String(round(min)),
    firstText: String(round(first)),
    lastText: String(round(last))
  }
}

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
  const peakIndex = values.lastIndexOf(max)
  const markIndexes = markAll
    ? list.map((item, index) => index)
    : [...new Set([0, list.length - 1, peakIndex])]
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

/**
 * 横向柱状图（分路占比、英雄场次占比都用它）。
 * rows: [{ label, value, pct, note }]，pct 缺省时按最大值归一。
 *
 * @param {Array<object>} [rows] 行数据：{ label（必填，行名）, value（数值）, pct（百分比，不填就按最大值归一）, note（备注） }；没有 label 的行会被丢掉
 * @param {object} [opts] 选项：max（归一用的分母，> 0 时不按实际最大值算）、unit（数值后缀）
 * @returns {Array<object>} 与入参同序的行：{ label, value, note, percent（0-100 整数）, valueText（带单位） }；一行都没有时给空数组
 */
export function barRows (rows = [], { max = 0, unit = '' } = {}) {
  const list = (Array.isArray(rows) ? rows : [])
    .map(item => ({
      label: toText(item?.label),
      value: Number(item?.value) || 0,
      pct: Number(item?.pct),
      note: toText(item?.note)
    }))
    .filter(item => item.label)

  if (!list.length) return []

  const ceiling = max > 0 ? max : Math.max(...list.map(item => item.pct || item.value)) || 1
  return list.map(item => ({
    label: item.label,
    value: item.value,
    note: item.note,
    percent: Math.max(0, Math.min(100, Math.round((Number.isFinite(item.pct) ? item.pct : item.value) / ceiling * 100))),
    valueText: `${round(item.value)}${unit}`
  }))
}

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
