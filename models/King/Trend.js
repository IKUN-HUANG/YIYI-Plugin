/**
 * @file 段位与巅峰分趋势——只读本地归档画趋势：按天取点，遇到赛季重置、换角色、掉分超过阈值就断线，不再打接口。
 * @module models/King/Trend
 */
import { toText } from './Common.js'
import { stripAtText } from './Target.js'
import { ARCHIVE_KEEP_DAYS, filterArchive, getArchiveRange } from './Archive.js'
import { kingReply, kingFail, kingGuard, kingNoBindTip } from './Say.js'
import { renderKing, logoUri } from './Card.js'
import { kingContext, contextFailText, ownerTextOf } from './Context.js'
import { lineChart, stepChart } from './Chart.js'
import { heroIconUri } from './Icon.js'
import { toInt, stampClock } from '#yiyi.utils'

/**
 * 段位趋势 / 巅峰分趋势。
 *
 * 数据只认本地战绩归档（Archive.js）：这两条曲线在营地里拿不到。
 * 营地给的 gameTrend 是「跨赛季段位快照」，只在段位或星数变化那天记一个点，
 * 26 天只有 8 个点、还夹着上个赛季，画出来又稀又和 App 对不上。
 * 归档是战绩推送每轮顺手攒的，每场都在，聚到天就是 App 上那条线的形状。
 *
 * 口径（都是踩过的坑）：
 * - 段位那一场记的是「打这局时的段位快照」，不是这局打完的结果；
 * - 段位编号不能比大小（王者=16 却比星耀 22~25 小），排序键必须是
 *   大段层级 → 段位编号 → 星数；
 * - 赛季重置的形态是「降一个大段 + 段位编号反而变大」，必须单独断段，
 *   否则图上会出现一条 -95 星的垂直断崖；
 * - 巅峰分每赛季重置，跨赛季同样要断段。
 */

/** 不说天数时看图几天：默认近 14 天 */
export const TREND_DEFAULT_DAYS = 14
/** 图上最多画几个点：再多在卡片宽度里就糊成一片，超了等距抽稀 */
export const TREND_MAX_POINTS = 60
/** 段位趋势卡「最近战绩」列几场 */
export const TREND_RECENT = 10
/** 巅峰分趋势卡「最近战绩」列几场（巅峰局卡片更挤，比段位少两场） */
export const PEAK_RECENT = 8
/** 档位差到这个数就当成「跳变」（换角色 / 赛季重置 / 归档缺段） */
export const JUMP_TOLERANCE = 3
/** 巅峰分一次掉这么多只可能是赛季重置（正常输一局掉十几分） */
export const PEAK_RESET_GAP = 300

/**
 * 段位阶梯：低 → 高。ordinal 是「从青铜III 起数第几档」，这才是唯一能比大小的东西
 * ——营地给的 roleJob 编号跨大段不单调（王者 16 比星耀 22~25 还小），
 * 直接比 jobJob 会把升段看成掉段。tiers 是该大段的档位数（黄金/铂金只有 IV~I）。
 */
export const RANK_BANDS = [
  { re: /青铜/, band: 1, name: '青铜', tiers: 3, offset: 0 },
  { re: /白银/, band: 2, name: '白银', tiers: 3, offset: 3 },
  { re: /黄金/, band: 3, name: '黄金', tiers: 4, offset: 6 },
  { re: /铂金|白金/, band: 4, name: '铂金', tiers: 4, offset: 10 },
  { re: /钻石/, band: 5, name: '钻石', tiers: 5, offset: 14 },
  { re: /星耀/, band: 6, name: '星耀', tiers: 5, offset: 19 },
  { re: /王者/, band: 7, name: '王者', tiers: 1, offset: 24 }
]

/** 小段位罗马数字 → 序号（V = 5 是最低一档，I = 1 是最高一档） */
export const ROMAN = { V: 5, IV: 4, III: 3, II: 2, I: 1 }

/**
 * 指令尾巴上的天数：「#段位趋势 7」「7天」都认；@ 段先剥掉，免得 QQ 号被当成天数。
 *
 * @param {string} text 指令尾巴（已去掉「王者段位趋势」这类前缀）
 * @returns {{days: number}} days = 天数，取第一个 1-2 位数字，夹在 1..ARCHIVE_KEEP_DAYS 之间；没给就用 TREND_DEFAULT_DAYS = 14
 */
export function parseTrendArgs (text) {
  let days = null
  for (const token of stripAtText(toText(text)).split(/[\s,，、]+/)) {
    if (!/^\d{1,2}$/.test(token)) continue
    days = Number(token)
    break
  }

  const wanted = Number(days) > 0 ? Number(days) : TREND_DEFAULT_DAYS
  return { days: Math.max(1, Math.min(ARCHIVE_KEEP_DAYS, wanted)) }
}

/**
 * 峰值一次掉这么多只可能是赛季重置，不是输了一把（正常输一局掉十几分，重置是掉几百）。
 *
 * @param {object} prev 前一场（取 score / newMasterMatchScore）
 * @param {object} next 后一场（字段同上）
 * @returns {boolean} 掉幅 ≥ PEAK_RESET_GAP = 300 分给 true；任一边没有分数给 false
 */
export function isPeakReset (prev, next) {
  const before = toInt(prev?.score ?? prev?.newMasterMatchScore)
  const after = toInt(next?.score ?? next?.newMasterMatchScore)
  if (!before || !after) return false
  return after - before <= -PEAK_RESET_GAP
}

/**
 * 段位名 → 大段信息（青铜…王者）+ 小段位 + 能比大小的阶梯序号。
 * 营地的 roleJob 编号跨大段不单调（王者 16 比星耀 22 还小），排序只能靠 ordinal。
 *
 * @param {string} jobName 营地段位名（如「永恒钻石II」「最强王者」）
 * @returns {{re: RegExp, band: number, name: string, tiers: number, offset: number, roman: number, pos: number, ordinal: number}|null} band 1-7 越大越高，roman 是小段位罗马数字（王者段为 0），pos 是段内第几档，ordinal = offset + pos 才是可比的阶梯序号；认不出这个段位名时给 null
 */
export function rankBandInfo (jobName) {
  const name = toText(jobName).trim()
  if (!name) return null
  for (const item of RANK_BANDS) {
    if (!item.re.test(name)) continue
    /** 王者段没有小段位，剩下的都在名字尾巴上（至尊星耀III → III） */
    const roman = ROMAN[(name.match(/(IV|V|III|II|I)$/) || [])[1]] || 0
    const pos = roman && item.tiers > 1 ? item.tiers - roman : (item.tiers > 1 ? 0 : 0)
    return { ...item, roman, pos, ordinal: item.offset + pos }
  }
  return null
}

/**
 * 只取大段序号：1 青铜 … 7 王者。
 *
 * @param {string} jobName 营地段位名
 * @returns {number} 大段序号；认不出给 0
 */
export function rankBand (jobName) {
  return rankBandInfo(jobName)?.band || 0
}

/**
 * 段位简称（卡片六宫格与纵轴都放不下全名，只留大段名）。
 *
 * @param {string} jobName 营地段位名
 * @returns {string} 大段名（「永恒钻石II」→「钻石」）；认不出时取原文前两个字，空的给「未知」
 */
export function rankBandShort (jobName) {
  const info = rankBandInfo(jobName)
  if (info) return info.name
  return toText(jobName).slice(0, 2) || '未知'
}

function signed (num) {
  const value = Number(num) || 0
  return value > 0 ? `+${value}` : String(value)
}

function shortDay (stamp) {
  const at = new Date((Number(stamp) || 0) * 1000)
  const pad = num => String(num).padStart(2, '0')
  return `${pad(at.getMonth() + 1)}/${pad(at.getDate())}`
}

function dayKeyOf (stamp) {
  const at = new Date((Number(stamp) || 0) * 1000)
  const pad = num => String(num).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/**
 * 等距抽稀，首尾必留：60 个点以上的曲线在卡片宽度里已经糊成一片。
 *
 * @param {Array<*>} [list] 原始点
 * @param {number} [max] 最多留几个点（少于 2 按 2 算），默认 TREND_MAX_POINTS = 60
 * @returns {Array<*>} 抽稀后的新数组（首尾都在，相邻重复点会合并）；原数组不超过上限时给一份浅拷贝
 */
export function thin (list = [], max = TREND_MAX_POINTS) {
  const items = Array.isArray(list) ? list : []
  const limit = Math.max(2, Number(max) || TREND_MAX_POINTS)
  if (items.length <= limit) return items.slice()

  const out = []
  const step = (items.length - 1) / (limit - 1)
  for (let i = 0; i < limit; i += 1) out.push(items[Math.round(step * i)])
  return out.filter((item, index) => index === 0 || item !== out[index - 1])
}

/**
 * 段位那一场的内容：段位名 + 编号 + 星数，压成一个可比标量。
 * 同一个对象也带着这一场的对局信息（胜负、英雄、KDA），卡片各段都用它。
 *
 * @param {object} [item] 归档里的一场（取 roleJobName / roleJob / stars / dtEventTime / gameresult / heroId / heroName / heroIcon / mapName / killcnt / deadcnt / assistcnt）
 * @returns {object} 点对象：jobName、jobNum（营地编号）、stars、band（1-7）、ordinal（阶梯序号）、known（段位名认不认得）、value（排序键 = ordinal×1e6 + stars）、stamp（秒）、result（1 胜 2 负）、win、heroId、heroName、heroIcon、mode、kill、dead、assist、label（「永恒钻石II 3星」）、short（「钻石II」）、starText（「3★」）
 */
export function rankPoint (item = {}) {
  const jobName = toText(item?.roleJobName).trim()
  const jobNum = toInt(item?.roleJob)
  const stars = toInt(item?.stars)
  const info = rankBandInfo(jobName)
  const ordinal = info ? info.ordinal : 0
  return {
    jobName,
    jobNum,
    stars,
    band: info?.band || 0,
    ordinal,
    known: Boolean(info),
    /** 排序键是阶梯序号，不是营地编号：同档内才看星数 */
    value: ordinal * 1e6 + stars,
    stamp: toInt(item?.dtEventTime),
    result: toInt(item?.gameresult),
    win: toInt(item?.gameresult) === 1,
    heroId: toText(item?.heroId),
    heroName: toText(item?.heroName),
    heroIcon: toText(item?.heroIcon),
    mode: toText(item?.mapName),
    kill: toInt(item?.killcnt),
    dead: toInt(item?.deadcnt),
    assist: toInt(item?.assistcnt),
    label: jobName ? `${jobName} ${stars}星` : '未知段位',
    /**
     * 卡片上的段位一律用简称（「永恒钻石II」在六宫格里要换三行），星数单独放副行；
     * 纵轴也只放简称，带星数会被裁掉
     */
    short: jobName ? `${rankBandShort(jobName)}${info?.roman ? ['', 'I', 'II', 'III', 'IV', 'V'][info.roman] : ''}` : '未知',
    starText: `${stars}★`
  }
}

/**
 * 相邻两点是不是「跳变」。
 *
 * 只按阶梯序号判断：真实对局里一次最多挪一档（星耀V 掉到 钻石I 就是一档），
 * 所以「序号掉两档以上」只可能是换游戏角色、赛季重置，或者归档中间缺了段。
 * 往上涨多少都正常，不断段。王者段内掉星序号不变，也不算跳。
 *
 * @param {object} prev 前一个点（rankPoint 的产物）
 * @param {object} next 后一个点
 * @returns {boolean} 阶梯序号掉 2 档及以上给 true；任一点缺段位信息（known 为假）也当没跳，给 false
 */
export function isRankJump (prev, next) {
  if (!prev || !next || !prev.known || !next.known) return false
  return next.ordinal - prev.ordinal <= -2
}

/**
 * 两点之间的变化：跨大段说段位名，同大段说段/星（卡片上那行「钻石II → 星耀V」就是它）。
 *
 * @param {object} first 起点（rankPoint 的产物）
 * @param {object} last 终点
 * @returns {{text: string, tone: string}} text 是给用户看的说法（「+2 星」「持平」「钻石 → 星耀」，缺数据给「—」）；tone 是配色档：'up' 涨 / 'down' 跌 / 'flat' 不变
 */
export function describeDelta (first, last) {
  if (!first || !last || !first.jobName || !last.jobName) return { text: '—', tone: 'flat' }

  if (first.band !== last.band) {
    const up = last.band > first.band
    return { text: `${rankBandShort(first.jobName)} → ${rankBandShort(last.jobName)}`, tone: up ? 'up' : 'down' }
  }

  if (first.jobNum !== last.jobNum) {
    const diff = last.jobNum - first.jobNum
    return { text: `${signed(diff)} 段`, tone: diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat') }
  }

  const diff = last.stars - first.stars
  return { text: diff ? `${signed(diff)} 星` : '持平', tone: diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat') }
}

/**
 * 升/降段次数与涨/掉星次数：王者段永远同一档，只能靠星数看进展。
 * 跳变（换角色 / 赛季重置）那一步直接跳过，不计进任何一边。
 *
 * @param {object[]} [points] 按时间正序的点（rankPoint 的产物）
 * @returns {{up: number, down: number, starUp: number, starDown: number}} 升段次数、降段次数、涨星次数、掉星次数
 */
export function countSteps (points = []) {
  let up = 0
  let down = 0
  let starUp = 0
  let starDown = 0

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]
    const next = points[i]
    if (isRankJump(prev, next)) continue

    if (next.band !== prev.band) {
      if (next.band > prev.band) up += 1
      else down += 1
      continue
    }

    if (next.jobNum !== prev.jobNum) {
      const diff = Math.abs(next.jobNum - prev.jobNum)
      if (next.jobNum > prev.jobNum) up += diff
      else down += diff
      continue
    }

    if (next.value > prev.value) starUp += 1
    else if (next.value < prev.value) starDown += 1
  }

  return { up, down, starUp, starDown }
}

/**
 * 最长连胜 / 连败（只认 1 胜 2 负，逃跑与未结算算断）。
 *
 * @param {object[]} [items] 按时间正序的场次
 * @param {(item: object) => string} pick 取这一场的胜负：'win' / 'lose'，返回空串表示断链
 * @returns {{type: string, count: number}} type 是 'win' / 'lose'，count 是连了几场；一场都没判定出来时给 {type: '', count: 0}
 */
export function maxStreak (items = [], pick) {
  let best = { type: '', count: 0 }
  let current = { type: '', count: 0 }

  for (const item of items) {
    const type = pick(item)
    if (!type) {
      current = { type: '', count: 0 }
      continue
    }
    if (current.type === type) current.count += 1
    else current = { type, count: 1 }
    if (current.count > best.count) best = { ...current }
  }

  return best
}

function pickResult (item) {
  /** rankPoint() 造出来的点只留 result（营地原始字段叫 gameresult），两种都认 */
  const result = toInt(item?.gameresult ?? item?.result)
  if (result === 1) return 'win'
  if (result === 2) return 'lose'
  return ''
}

function winRateShort (win, total) {
  if (!total) return '—'
  return `${Math.round(win / total * 100)}%`
}

function baseView ({ isPeak, days, pile, ctx }) {
  const range = getArchiveRange(ctx.roleId)
  const first = pile[0]
  const last = pile[pile.length - 1]
  const spanDays = first && last
    ? Math.max(1, Math.round((last.stamp - first.stamp) / 86400 * 10) / 10)
    : 0

  return {
    isPeak,
    title: isPeak ? '王者荣耀 · 巅峰分趋势' : '王者荣耀 · 段位趋势',
    logoSrc: logoUri(),
    genTime: new Date().toLocaleString('zh-CN', { hour12: false }),
    roleName: toText(ctx.bind?.roleName) || toText(ctx.target?.name) || '',
    rankName: '',
    ownerText: ownerTextOf(ctx.e, ctx.owner),
    days,
    keepDays: ARCHIVE_KEEP_DAYS,
    modeLabel: isPeak ? '巅峰赛' : '排位赛',
    countText: `${pile.length} 场`,
    rangeText: first && last ? `${shortDay(first.stamp)} ~ ${shortDay(last.stamp)}` : '',
    coverText: range ? (spanDays >= days ? `近 ${days} 天` : `实际覆盖 ${spanDays} 天`) : '',
    /** 两个视图共用一个模板，用不到的区块给空数组，模板就不用到处判 undefined */
    stats: [],
    chart: '',
    chartTip: '',
    segNote: '',
    dayRows: [],
    heroRows: [],
    modeRows: [],
    recentRows: [],
    note: '',
    footText: `数据取自本地战绩存档（最多 ${ARCHIVE_KEEP_DAYS} 天）· 只统计${isPeak ? '巅峰赛' : '排位赛'}`
  }
}

/**
 * 归档里挑出这个模式的场次（正序：老 → 新）。
 * 巅峰局与排位局都带对方的分数字段，所以只能按模式名筛，不能按字段有没有筛。
 *
 * @param {object[]} [battles] 归档里的原始场次
 * @param {{isPeak?: boolean, fromSec?: number}} [opts] isPeak = 要巅峰赛（true）还是排位赛（false）；fromSec = 只留这之后（秒级时间戳）
 * @returns {object[]} 正序场次，每场多带两个字段：stamp（秒级时间戳）、result（营地原始 gameresult）
 */
export function pickBattles (battles = [], { isPeak, fromSec = 0 } = {}) {
  const keyword = isPeak ? '巅峰' : '排位'
  return (Array.isArray(battles) ? battles : [])
    .filter(item => toText(item?.mapName).includes(keyword))
    .filter(item => toInt(item?.dtEventTime) >= fromSec)
    .map(item => ({ ...item, stamp: toInt(item?.dtEventTime), result: toInt(item?.gameresult) }))
    .sort((a, b) => a.stamp - b.stamp)
}

/**
 * 巅峰分趋势视图。
 *
 * @param {{battles?: object[], days?: number, ctx?: object}} [opts] battles = 归档场次；days = 看几天（默认 14）；ctx = kingContext 的结果（取 roleName / bind / target / owner / e）
 * @returns {object} 趋势卡 view（baseView 的字段 + unitText / stats / chart / chartTip / dayRows / heroRows / modeRows / recentRows / note 等）；有效场次不足 2 场时给 `{empty: true, count, days}`，由调用方改发文字
 */
export function buildPeakView ({ battles = [], days = TREND_DEFAULT_DAYS, ctx = {} } = {}) {
  const fromSec = Math.floor(Date.now() / 1000) - days * 86400
  const pile = pickBattles(battles, { isPeak: true, fromSec })
    .map(item => ({
      ...item,
      score: toInt(item?.newMasterMatchScore),
      oldScore: toInt(item?.oldMasterMatchScore),
      heroId: toText(item?.heroId),
      heroName: toText(item?.heroName),
      heroIcon: toText(item?.heroIcon),
      kill: toInt(item?.killcnt),
      dead: toInt(item?.deadcnt),
      assist: toInt(item?.assistcnt)
    }))
    .filter(item => item.score > 0)

  if (pile.length < 2) return { empty: true, count: pile.length, days }

  /**
   * 段位会被赛季重置打断：重置前那一段的分数跟现在不是同一个赛季，统计只算最后一段，
   * 否则「区间涨跌」会变成「重置掉了多少分」。
   */
  let segStart = 0
  pile.forEach((item, index) => {
    if (index > 0 && isPeakReset(pile[index - 1], item)) segStart = index
  })
  const tail = pile.slice(segStart)
  const scores = tail.map(item => item.score)
  /**
   * 重置后的第一场本身就是「掉到 1200」那一场，它的 oldScore 还是上赛季的分，
   * 拿来算涨跌会凭空多出几百点的落差，所以重置段直接以它自己的新分为起点
   */
  const startScore = segStart > 0 ? scores[0] : (toInt(tail[0].oldScore) || scores[0])
  const current = scores[scores.length - 1]
  const peak = Math.max(...scores)
  const low = Math.min(...scores)
  const delta = current - startScore
  const resetText = segStart > 0 ? '重置后' : ''
  const wins = pile.filter(item => item.result === 1).length
  const loses = pile.filter(item => item.result === 2).length
  const decided = wins + loses
  const rate = decided ? Math.round(wins / decided * 1000) / 10 : 0
  const streak = maxStreak(pile, pickResult)
  const lossStreak = maxStreak(pile, item => (pickResult(item) === 'lose' ? 'lose' : ''))

  const view = baseView({ isPeak: true, days, pile, ctx })
  view.unitText = '分'
  view.stats = [
    { label: '当前巅峰分', value: String(current), sub: shortDay(pile[pile.length - 1].stamp) },
    { label: '区间涨跌', value: signed(delta), sub: `${startScore} → ${current}${resetText ? `（${resetText}）` : ''}`, tone: delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat') },
    { label: '区间最高', value: String(peak), sub: resetText },
    { label: '巅峰胜率', value: `${rate}%`, sub: `${wins} 胜 ${loses} 负`, tone: rate >= 50 ? 'up' : 'down' },
    { label: '区间最低', value: String(low), sub: resetText },
    {
      label: '最长连胜',
      value: streak.type === 'win' ? `${streak.count} 连` : '—',
      sub: lossStreak.type === 'lose' ? `最长连败 ${lossStreak.count}` : ''
    }
  ]

  const shown = thin(pile, TREND_MAX_POINTS)
  view.chartTitle = '巅峰分走势'
  view.chartTip = `${startScore} → ${current}，共 ${pile.length} 场，${view.coverText || `近 ${days} 天`}`
  view.chart = lineChart(shown.map((item, index) => {
    const prev = shown[index - 1]
    return {
      label: shortDay(item.stamp),
      value: item.score,
      /** 巅峰分每赛季重置：一次掉 300 分以上只可能是重置，断段而不是画成断崖 */
      gap: Boolean(prev) && isPeakReset(prev, item),
      mark: index === shown.length - 1 ? String(item.score) : ''
    }
  }), { width: 660, height: 280, color: '#c07bdb', unit: ' 分', padLeft: 84 })

  /** 逐日：当天最后一场的分数 − 当天第一场之前的分数 */
  const resetDays = new Set()
  pile.forEach((item, index) => {
    if (index > 0 && isPeakReset(pile[index - 1], item)) resetDays.add(dayKeyOf(item.stamp))
  })

  const dayMap = new Map()
  for (const item of pile) {
    const key = dayKeyOf(item.stamp)
    const row = dayMap.get(key) || {
      day: key,
      label: shortDay(item.stamp),
      count: 0,
      win: 0,
      lose: 0,
      start: toInt(item.oldScore) || item.score,
      end: item.score
    }
    row.count += 1
    if (item.result === 1) row.win += 1
    if (item.result === 2) row.lose += 1
    row.end = item.score
    dayMap.set(key, row)
  }
  view.dayRows = [...dayMap.values()]
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .map(row => {
      const reset = resetDays.has(row.day)
      const diff = row.end - row.start
      return {
        label: row.label,
        value: `${row.end} 分`,
        sub: `${row.count} 场 · ${row.win} 胜 ${row.lose} 负${reset ? ' · 当天赛季重置' : ''}`,
        delta: reset ? '重置' : signed(diff),
        tone: reset ? 'flat' : (diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat'))
      }
    })

  /** 带分英雄：每场净得分累加（oldScore 缺失就退回 newScore，否则把绝对分当增量会让排序整个反过来） */
  const heroMap = new Map()
  pile.forEach((item, index) => {
    if (index > 0 && isPeakReset(pile[index - 1], item)) return
    const id = toText(item.heroId)
    const name = toText(item.heroName) || (id ? `英雄${id}` : '未知英雄')
    const key = id || name
    const row = heroMap.get(key) || {
      label: name,
      icon: heroIconUri(id, item.heroIcon),
      count: 0,
      win: 0,
      net: 0
    }
    row.count += 1
    if (item.result === 1) row.win += 1
    row.net += item.score - (toInt(item.oldScore) || item.score)
    heroMap.set(key, row)
  })
  view.heroRows = [...heroMap.values()]
    .sort((a, b) => b.net - a.net || b.count - a.count)
    .slice(0, 6)
    .map(row => ({
      label: row.label,
      icon: row.icon,
      value: signed(row.net),
      sub: `${row.count} 场 · 胜率 ${winRateShort(row.win, row.count)}`,
      tone: row.net > 0 ? 'up' : (row.net < 0 ? 'down' : 'flat')
    }))

  view.recentRows = pile.slice(-PEAK_RECENT).reverse().map((item, index, arr) => {
    const prev = arr[index + 1]
    const diff = item.score - (toInt(item.oldScore) || (prev ? prev.score : item.score))
    const reset = diff <= -PEAK_RESET_GAP
    return {
      label: stampClock(item.stamp),
      value: item.result === 1 ? '胜' : (item.result === 2 ? '负' : '—'),
      win: item.result === 1,
      lose: item.result === 2,
      sub: `${toText(item.heroName) || '未知英雄'} · ${item.kill}/${item.dead}/${item.assist}`,
      delta: reset ? '重置' : signed(diff),
      tone: reset ? 'flat' : (diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat'))
    }
  })

  view.note = `只统计「模式名含巅峰」的场次：排位局也带巅峰分字段，混进来会变成一条水平噪声`
  return view
}

/**
 * 段位趋势视图。
 *
 * @param {{battles?: object[], days?: number, ctx?: object}} [opts] battles = 归档场次；days = 看几天（默认 14）；ctx = kingContext 的结果
 * @returns {object} 趋势卡 view（baseView 的字段 + stats / chart / dayRows / heroRows / modeRows / recentRows / note 等）；有效场次不足 2 场时给 `{empty: true, count, days}`，由调用方改发文字
 */
export function buildRankView ({ battles = [], days = TREND_DEFAULT_DAYS, ctx = {} } = {}) {
  const fromSec = Math.floor(Date.now() / 1000) - days * 86400
  const points = pickBattles(battles, { isPeak: false, fromSec })
    .filter(item => toText(item?.roleJobName).trim() && toInt(item?.roleJob) > 0)
    .map(rankPoint)

  if (points.length < 2) return { empty: true, count: points.length, days }

  /** 先标跳变（必须在抽稀之前，否则断点会被抽掉） */
  let seg = 0
  points.forEach((item, index) => {
    if (index > 0 && isRankJump(points[index - 1], item)) seg += 1
    item.seg = seg
  })
  const segCount = seg + 1
  const tail = points.filter(item => item.seg === seg)

  const levelValues = [...new Set(points.map(item => item.value))].sort((a, b) => a - b)
  const levelOf = value => levelValues.indexOf(value)
  const levelTexts = levelValues.map(value => {
    const hit = points.find(item => item.value === value)
    return { text: hit ? hit.short : String(value), full: hit ? hit.label : '' }
  })

  const first = tail[0] || points[0]
  const last = points[points.length - 1]
  const peakPoint = tail.reduce((best, item) => (item.value > best.value ? item : best), tail[0] || last)
  const lowPoint = tail.reduce((best, item) => (item.value < best.value ? item : best), tail[0] || last)
  const delta = describeDelta(first, last)
  const steps = countSteps(points)
  const wins = points.filter(item => item.result === 1).length
  const loses = points.filter(item => item.result === 2).length
  const decided = wins + loses
  const rate = decided ? Math.round(wins / decided * 1000) / 10 : 0
  const streak = maxStreak(points, pickResult)
  const lossStreak = maxStreak(points, item => (pickResult(item) === 'lose' ? 'lose' : ''))

  const view = baseView({ isPeak: false, days, pile: points, ctx })
  view.rankName = toText(ctx.rankName) || `${last.jobName} ${last.stars}星`
  view.stats = [
    { label: '当前段位', value: last.short, sub: `${last.stars} 星` },
    { label: '区间变化', value: delta.text, sub: `${first.short} → ${last.short}`, tone: delta.tone },
    { label: '区间最高', value: peakPoint.short, sub: `${peakPoint.stars} 星` },
    { label: '区间最低', value: lowPoint.short, sub: `${lowPoint.stars} 星` },
    { label: '排位胜率', value: `${rate}%`, sub: `${wins} 胜 ${loses} 负`, tone: rate >= 50 ? 'up' : 'down' },
    { label: '涨星 / 掉星', value: `${steps.starUp} / ${steps.starDown}`, sub: `${steps.up} 升 ${steps.down} 降` }
  ]
  view.streakRows = [
    { label: '最长连胜', value: streak.type === 'win' ? `${streak.count} 连` : '—', sub: '排位赛，按场次连续算' },
    { label: '最长连败', value: lossStreak.type === 'lose' ? `${lossStreak.count} 连` : '—', sub: '逃跑与未结算会打断' }
  ]

  const shown = thin(points, TREND_MAX_POINTS)
  view.chartTitle = '段位走势'
  view.chartTip = `${first.label} → ${last.label}，${view.coverText || `近 ${days} 天`}`
  view.chart = stepChart(shown.map((item, index) => {
    const prev = shown[index - 1]
    return {
      label: shortDay(item.stamp),
      level: levelOf(item.value),
      /** 段与段之间断开，否则赛季重置会被画成一条垂直掉段线 */
      gap: Boolean(prev) && prev.seg !== item.seg,
      mark: index === 0 || index === shown.length - 1 ? item.starText : ''
    }
  }), { width: 660, height: 300, color: '#3b82f6', levels: levelTexts, padLeft: 92 })

  view.segNote = segCount > 1
    ? `检测到 ${segCount - 1} 处段位跳变，已断成 ${segCount} 段（多为切换游戏角色或赛季重置）；区间变化、最高最低只统计最后一段`
    : ''

  /** 逐日：变化 = 当天最后一场的段位 − 前一天最后一场的段位 */
  const dayMap = new Map()
  for (const item of points) {
    const key = dayKeyOf(item.stamp)
    const row = dayMap.get(key) || {
      day: key,
      label: shortDay(item.stamp),
      first: item,
      end: item,
      count: 0,
      win: 0,
      lose: 0
    }
    row.count += 1
    if (item.result === 1) row.win += 1
    if (item.result === 2) row.lose += 1
    row.end = item
    dayMap.set(key, row)
  }
  const daysSorted = [...dayMap.values()].sort((a, b) => (a.day < b.day ? -1 : 1))
  view.dayRows = daysSorted.map((row, index) => {
    const prev = index > 0 ? daysSorted[index - 1].end : row.first
    const jump = isRankJump(prev, row.end)
    const diff = jump ? { text: '—', tone: 'flat' } : describeDelta(prev, row.end)
    return {
      label: row.label,
      value: `${row.end.short} ${row.end.stars} 星`,
      sub: `${row.count} 场 · ${row.win} 胜 ${row.lose} 负`,
      delta: diff.text,
      tone: diff.tone
    }
  }).reverse()

  /** 上分英雄：同一段位内才累加星数（升/掉段那一场星数会重置，算了反而错） */
  const heroMap = new Map()
  points.forEach((item, index) => {
    const prev = points[index - 1]
    const sameTier = prev && !isRankJump(prev, item) && prev.short === item.short
    const diff = sameTier ? item.stars - prev.stars : 0
    const key = item.heroId || item.heroName || '未知英雄'
    const row = heroMap.get(key) || {
      label: item.heroName || (item.heroId ? `英雄${item.heroId}` : '未知英雄'),
      icon: heroIconUri(item.heroId, item.heroIcon),
      count: 0,
      win: 0,
      net: 0
    }
    row.count += 1
    if (item.result === 1) row.win += 1
    row.net += diff
    heroMap.set(key, row)
  })
  view.heroRows = [...heroMap.values()]
    .sort((a, b) => b.net - a.net || b.count - a.count)
    .slice(0, 6)
    .map(row => ({
      label: row.label,
      icon: row.icon,
      value: `${signed(row.net)} 星`,
      sub: `${row.count} 场 · 胜率 ${winRateShort(row.win, row.count)}`,
      tone: row.net > 0 ? 'up' : (row.net < 0 ? 'down' : 'flat')
    }))

  /** 模式分布：单排 / 双排 / 五排这些开黑形态 */
  const modeMap = new Map()
  for (const item of points) {
    const key = item.mode || '排位赛'
    const row = modeMap.get(key) || { label: key, count: 0, win: 0 }
    row.count += 1
    if (item.result === 1) row.win += 1
    modeMap.set(key, row)
  }
  view.modeRows = [...modeMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map(row => ({
      label: row.label,
      value: `${row.count} 场`,
      sub: `胜率 ${winRateShort(row.win, row.count)}`,
      tone: ''
    }))

  view.recentRows = points.slice(-TREND_RECENT).reverse().map((item, index, arr) => {
    const prev = arr[index + 1]
    const jump = isRankJump(prev, item)
    const diff = jump ? { text: '—', tone: 'flat' } : describeDelta(prev, item)
    return {
      label: stampClock(item.stamp),
      value: item.result === 1 ? '胜' : (item.result === 2 ? '负' : '—'),
      win: item.result === 1,
      lose: item.result === 2,
      sub: `${item.heroName || '未知英雄'} · ${item.short} ${item.stars} 星`,
      delta: diff.text,
      tone: diff.tone
    }
  })

  view.note = '段位是打这一场时的快照，变化是与上一场之间的差；只统计排位赛，巅峰赛与娱乐局不计入'
  return view
}

/**
 * 场次太少画不出趋势时的文字说明（顺带说清哪种对局算数、怎么让数据变多）。
 *
 * @param {boolean} isPeak true 说巅峰赛，false 说排位赛
 * @param {number} count 区间里找到几场
 * @param {number} days 看了几天
 * @returns {string} 多行文字，直接发给用户
 */
export function trendEmptyText (isPeak, count, days) {
  const label = isPeak ? '巅峰赛' : '排位赛'
  const hint = isPeak
    ? '· 排位赛不算：排位不影响巅峰分'
    : '· 巅峰赛和娱乐局不算：只有排位赛会改变段位'
  return `本地存档里最近 ${days} 天只找到 ${count} 场${label}，画不出趋势。\n${hint}\n`
    + '· 开了 #王者战绩推送 之后每天的对局会自动存档，往后趋势会越来越全'
}

async function trendCard (e, isPeak) {
  if (!(await kingGuard(e))) return false

  const ctx = await kingContext(e)
  if (ctx.error) {
    const fail = contextFailText(ctx.error)
    return kingReply(e, fail || kingNoBindTip(e.user_id))
  }

  const raw = stripAtText(toText(e.msg)).replace(/^[#＃]?王者(?:荣耀|农药)?(?:巅峰(?:分)?|段位|排位)(?:趋势|走势|曲线)/, '')
  const { days } = parseTrendArgs(raw)

  try {
    const battles = filterArchive(ctx.roleId, {})
    const view = isPeak
      ? buildPeakView({ battles, days, ctx: { ...ctx, e } })
      : buildRankView({ battles, days, ctx: { ...ctx, e } })

    if (view.empty) return kingReply(e, trendEmptyText(isPeak, view.count, days))

    await renderKing(e, 'trend', view)
    return true
  } catch (error) {
    return kingFail(e, error, '趋势算不出来，稍后再试')
  }
}

/**
 * 指令「王者段位趋势 [天数]」：出段位趋势卡（数据只来自本地战绩归档）。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<boolean>} 发出去了给 true；没权限、没绑角色、场次不足、算不出来时回一句话并给 false
 */
export async function kingRankTrend (e) {
  return trendCard(e, false)
}

/**
 * 指令「王者巅峰趋势 [天数]」：出巅峰分趋势卡（数据只来自本地战绩归档）。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<boolean>} 发出去了给 true；没权限、没绑角色、场次不足、算不出来时回一句话并给 false
 */
export async function kingPeakTrend (e) {
  return trendCard(e, true)
}
