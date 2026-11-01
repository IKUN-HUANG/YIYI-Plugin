/**
 * @file 分路、名字、比例与指令参数的纯格式化。
 * @module models/King/gallery/format
 */
import { countText } from '#yiyi.utils'
import { toText } from '../Common.js'
import { heroBriefOf } from '../Field.js'
import { SEGMENT_MAP, POSITION_MAP, POSITION_LABEL, CAMP_LANE_LABEL } from './constants.js'

/**
 * 分路短名：按 branchType 查短名表，表里没有的（营地以后加的新路数）退回完整名。
 *
 * @param {number|string} branchType 营地给的分路码（1 对抗 / 2 中路 / 3 发育 / 4 游走 / 5 打野，0 全部分路）
 * @returns {string} 短名（「对抗」「发育」这种）；两张表都没有时给「其他」
 */
export function laneShortLabel (branchType) {
  const key = Number(branchType)
  return CAMP_LANE_LABEL[key] || POSITION_LABEL[key] || '其他'
}

/**
 * 接口有时直接回「对抗路 / 发育路」全名（rankInfo.branches 的 branchName），这时按表里那两条对着换，
 * 别的一律原样返回 —— 不能图省事写 replace(/路/g)，那样「打野路」这类迟早会被误伤。
 *
 * @param {string} name 接口给的分路名（可能是全名「对抗路」，也可能是短名「中路」）
 * @returns {string} 短名；不认识的原样返回，空入参给空串
 */
export function laneShortName (name) {
  const text = toText(name)
  if (text === '对抗路') return CAMP_LANE_LABEL[1]
  if (text === '发育路') return CAMP_LANE_LABEL[3]
  return text
}

/**
 * 别名表按「命中的别名最长」挑，不能按声明顺序遇到第一个就 break：
 * 「中单」里含「单」（对抗路的历史别名），短别名会抢掉长别名。
 *
 * @param {string} text 用户输入的筛选词（整句都行，含别名即可）
 * @param {Array<{names: string[]}>} map 别名表（SEGMENT_MAP / POSITION_MAP 那种）
 * @returns {object|null} 命中的那一项（原对象），文本为空或一个别名都没命中时给 null
 */
export function pickAlias (text, map) {
  const source = toText(text)
  if (!source) return null

  let best = null
  let bestLen = 0
  for (const item of map) {
    for (const name of item.names) {
      if (name && source.includes(name) && name.length > bestLen) {
        best = item
        bestLen = name.length
      }
    }
  }

  return best
}

/**
 * 梯度榜的筛选词 → 接口要的 segment / position。
 * 两个词可以一起出现（「巅峰赛 中单」），认不出 segment 时按巅峰赛兜底，认不出 position 时按全部分路。
 *
 * @param {string} text 指令尾巴（已去掉「#王者梯度」这类前缀）
 * @returns {{segment: number, position: number}} segment：1 所有段位 / 3 巅峰赛1350+ / 4 顶端排位 / 5 赛事；position：0 全部 / 1 对抗 / 2 中路 / 3 发育 / 4 游走 / 5 打野
 */
export function parseTierFilter (text) {
  const seg = pickAlias(text, SEGMENT_MAP)
  const pos = pickAlias(text, POSITION_MAP)
  return { segment: seg ? seg.seg : 3, position: pos ? pos.pos : 0 }
}

/**
 * 名字归一：全角括号转半角、去掉所有空白。官网写半角、营地两边都有，不归一就匹配不上。
 *
 * @param {string} text 原始名字
 * @returns {string} 归一后的名字（可能为空串）
 */
export function normName (text) {
  return toText(text).replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '').trim()
}

/**
 * 按用户输入的关键词找英雄，依次匹配：全名 → ename / 拼音 → 名字前缀 → 名字包含。
 * 关键词先做归一（全角括号、空格），所以「李白 (青莲剑仙)」也认。
 *
 * @param {object[]} heroes 英雄表（fetchHeroTable 的结果）
 * @param {string} keyword 用户输入的名字 / 拼音 / 英雄ID
 * @returns {object|null} 命中的那一条（原对象）；关键词为空或全都不匹配时给 null
 */
export function matchHeroKeyword (heroes, keyword) {
  const key = normName(keyword)
  if (!key) return null

  const list = Array.isArray(heroes) ? heroes : []
  const exact = list.find(item => normName(item.name) === key)
  if (exact) return exact

  const byId = list.find(item => toText(item.ename) === key || toText(item.pinyin) === key)
  if (byId) return byId

  const prefix = list.find(item => normName(item.name).startsWith(key))
  if (prefix) return prefix

  return list.find(item => normName(item.name).includes(key)) || null
}

/**
 * 指令尾巴：去掉「#王者xxx」前缀，剩下的就是参数部分。
 *
 * @param {object} e 云崽消息事件对象（读 msg）
 * @param {RegExp} pattern 要剥掉的前缀正则
 * @returns {string} 剥完并去空白的参数；没有 msg 时给空串
 */
export function tailOf (e, pattern) {
  return toText(e?.msg).replace(pattern, '').trim()
}

export function pct (value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return ''
  return `${(num * 100).toFixed(1)}%`
}

/** ============================================================ 取号共通 */

/** ============================================================ 赛季表现 */

/** 常用英雄：排位页与巅峰页、赛季列表里的 heros 是同一个形状，三处共用 */
export function seasonHeroOf (raw) {
  return {
    ...heroBriefOf(raw),
    winRate: pct(raw?.winRate),
    power: countText(raw?.heroFightPower ?? raw?.fightPower)
  }
}

/**
 * 分路胜率：营地这几版字段名换来换去（winRate / winCnt / winGameCnt），
 * 能算就算，算不出来就留空串，模板那边整列不画（写死 0% 更误导）。
 */
export function branchRateOf (item = {}) {
  const rate = pct(item?.winRate)
  if (rate) return rate
  const games = Number(item?.gameCnt) || Number(item?.totalCnt) || 0
  const wins = Number(item?.winCnt) || Number(item?.winGameCnt) || Number(item?.totalWinCnt) || 0
  return games > 0 && wins > 0 ? pct(wins / games) : ''
}

/** 段位名压短：「最强王者」→「王者」、「永恒钻石」→「钻石」，只给图上那行字用 */
export function jobShortOf (name) {
  return toText(name)
    .replace(/^(?:最强|永恒|至尊|荣耀|尊贵|秩序|倔强)/, '')
    .trim()
}

export function trendDayLabel (stamp) {
  const at = new Date((Number(stamp) || 0) * 1000)
  const pad = value => String(value).padStart(2, '0')
  return `${at.getMonth() + 1}.${pad(at.getDate())}`
}
