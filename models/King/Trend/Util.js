/**
 * @file Trend模块的一片实现。
 *
 * @module models/Trend/Util
 */
import { toText } from '../Common.js'
import { stripAtText } from '../Target.js'
import { ARCHIVE_KEEP_DAYS } from '../Archive.js'
import { toInt } from '#yiyi.utils'
import { PEAK_RESET_GAP, RANK_BANDS, ROMAN, TREND_DEFAULT_DAYS, TREND_MAX_POINTS } from './Consts.js'


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
 * @returns {{re: RegExp, band: number, name: string, Tiers: number, offset: number, roman: number, pos: number, ordinal: number}|null} band 1-7 越大越高，roman 是小段位罗马数字（王者段为 0），pos 是段内第几档，ordinal = offset + pos 才是可比的阶梯序号；认不出这个段位名时给 null
 */
export function RankBandInfo (jobName) {
  const name = toText(jobName).trim()
  if (!name) return null
  for (const item of RANK_BANDS) {
    if (!item.re.test(name)) continue
    /** 王者段没有小段位，剩下的都在名字尾巴上（至尊星耀III → III） */
    const roman = ROMAN[(name.match(/(IV|V|III|II|I)$/) || [])[1]] || 0
    const pos = roman && item.Tiers > 1 ? item.Tiers - roman : (item.Tiers > 1 ? 0 : 0)
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
function RankBand (jobName) {
  return RankBandInfo(jobName)?.band || 0
}

/**
 * 段位简称（卡片六宫格与纵轴都放不下全名，只留大段名）。
 *
 * @param {string} jobName 营地段位名
 * @returns {string} 大段名（「永恒钻石II」→「钻石」）；认不出时取原文前两个字，空的给「未知」
 */
export function RankBandShort (jobName) {
  const info = RankBandInfo(jobName)
  if (info) return info.name
  return toText(jobName).slice(0, 2) || '未知'
}

/**
 * 给正数补个加号（趋势图上的涨跌要一眼看出来）
 *
 * @param {*} value 数值
 * @returns {string} 带符号的文本
 */
export function signed (num) {
  const value = Number(num) || 0
  return value > 0 ? `+${value}` : String(value)
}

/**
 * 把 `MM-DD` 缩成 `M/D`（图上横轴位置紧）
 *
 * @param {*} day 日期键
 * @returns {string} 缩写后的日期
 */
export function shortDay (stamp) {
  const at = new Date((Number(stamp) || 0) * 1000)
  const pad = num => String(num).padStart(2, '0')
  return `${pad(at.getMonth() + 1)}/${pad(at.getDate())}`
}

/**
 * 把时间戳换成按天的键
 *
 * @param {*} ms 毫秒时间戳
 * @returns {string} `YYYY-MM-DD`
 */
export function dayKeyOf (stamp) {
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
 * @param {object} [item] 归档里的一场（取 roleJobName / roleJob / stars / dtEventTime / gameresult / HeroId / HeroName / HeroIcon / mapName / killcnt / deadcnt / assistcnt）
 * @returns {object} 点对象：jobName、jobNum（营地编号）、stars、band（1-7）、ordinal（阶梯序号）、known（段位名认不认得）、value（排序键 = ordinal×1e6 + stars）、stamp（秒）、result（1 胜 2 负）、win、HeroId、HeroName、HeroIcon、mode、kill、dead、assist、label（「永恒钻石II 3星」）、short（「钻石II」）、starText（「3★」）
 */
export function RankPoint (item = {}) {
  const jobName = toText(item?.roleJobName).trim()
  const jobNum = toInt(item?.roleJob)
  const stars = toInt(item?.stars)
  const info = RankBandInfo(jobName)
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
    HeroId: toText(item?.heroId ?? item?.HeroId),
    HeroName: toText(item?.heroName ?? item?.HeroName),
    HeroIcon: toText(item?.heroIcon ?? item?.HeroIcon),
    mode: toText(item?.mapName),
    kill: toInt(item?.killcnt),
    dead: toInt(item?.deadcnt),
    assist: toInt(item?.assistcnt),
    label: jobName ? `${jobName} ${stars}星` : '未知段位',
    /**
     * 卡片上的段位一律用简称（「永恒钻石II」在六宫格里要换三行），星数单独放副行；
     * 纵轴也只放简称，带星数会被裁掉
     */
    short: jobName ? `${RankBandShort(jobName)}${info?.roman ? ['', 'I', 'II', 'III', 'IV', 'V'][info.roman] : ''}` : '未知',
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
 * @param {object} prev 前一个点（RankPoint 的产物）
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
 * @param {object} first 起点（RankPoint 的产物）
 * @param {object} last 终点
 * @returns {{text: string, tone: string}} text 是给用户看的说法（「+2 星」「持平」「钻石 → 星耀」，缺数据给「—」）；tone 是配色档：'up' 涨 / 'down' 跌 / 'flat' 不变
 */
export function describeDelta (first, last) {
  if (!first || !last || !first.jobName || !last.jobName) return { text: '—', tone: 'flat' }

  if (first.band !== last.band) {
    const up = last.band > first.band
    return { text: `${RankBandShort(first.jobName)} → ${RankBandShort(last.jobName)}`, tone: up ? 'up' : 'down' }
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
 * @param {object[]} [points] 按时间正序的点（RankPoint 的产物）
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

/**
 * 从一条战绩里判断输赢（营地字段不统一，几种写法都认）
 *
 * @param {*} battle 战绩条目
 * @returns {string} `win` / `lose` / 空串
 */
export function pickResult (item) {
  /** RankPoint() 造出来的点只留 result（营地原始字段叫 gameresult），两种都认 */
  const result = toInt(item?.gameresult ?? item?.result)
  if (result === 1) return 'win'
  if (result === 2) return 'lose'
  return ''
}

/**
 * 胜率写成百分比（没有场次给空串）
 *
 * @param {*} win 赢的场次
 * @param {*} total 总场次
 * @returns {string} 百分比文本
 */
export function winRateShort (win, total) {
  if (!total) return '—'
  return `${Math.round(win / total * 100)}%`
}
