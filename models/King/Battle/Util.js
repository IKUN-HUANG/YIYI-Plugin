/**
 * @file 战绩模块的零碎工具：数字、缓存键、页码、时间与回放。
 *
 * @module models/King/Battle/Util
 */


import { stripAtText } from '../Target.js'




import { Config } from '#yiyi.components'
import { battleOption } from '../Field.js'
import { toText } from '../Common.js'






import { MAX_PAGE } from './Consts.js'
import { MODE_KEYS } from './Consts.js'
import { BOT_SCORE_LINE } from './Consts.js'
import { GOD_SCORE_LINE } from './Consts.js'
import { TIMELINE_TIME_KEYS } from './Consts.js'
import { DRAGON_KINDS } from './Consts.js'

/**
 * 把可能带逗号、带单位的文本转成数字
 *
 * @param {*} text 原文本
 * @returns {number} 取不到给 0
 */
export function num (value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 金币 / 伤害这类大数字的短写：过一千用 k。
 *
 * @param {string|number} value 原始数值
 * @returns {string} `950` 或 `12.3k`；不是数字给 `0`
 */
export function moneyText (value) {
  const total = num(value)
  return total > 1000 ? `${(total / 1000).toFixed(1)}k` : String(total)
}

/**
 * 时长写成人话「12分3秒」。
 *
 * @param {string|number} seconds 秒数，单位 秒
 * @returns {string} 「X分Y秒」；0 或负数给空串（模板那边会留空，不写「0分0秒」）
 */
export function durationCnText (seconds) {
  const total = num(seconds)
  if (total <= 0) return ''
  const min = Math.floor(total / 60)
  return `${min}分${total % 60}秒`
}

/**
 * 缓存按营地角色 ID 记，不跟登录信息走：换一个号接着查也能用同一份缓存
 *
 * @param {string} campId 营地角色 ID
 * @returns {string} 缓存用的键
 */
export function cacheKey (campId) {
  return `battle-${toText(campId)}.yaml`
}

/**
 * 取返回里的业务码：门面回的是 `{ data, code }` 壳，老调用方还传过裸响应体，两种都认。
 * @param {object} result `getBattleDetail` 的返回值
 * @returns {number} 业务码；取不到是 0
 */
export function codeOf (result) {
  const raw = result && typeof result === 'object' ? result : {}
  return Number(raw.returnCode ?? raw.code ?? raw.raw?.returnCode) || 0
}

/**
 * 从指令参数里取页码（夹在 1..MAX_PAGE）
 *
 * @param {*} options 解析出来的参数
 * @returns {number} 页码
 */
export function pageOf (e, fallback = 1) {
  const matched = stripAtText(e.msg).match(/(\d+)\s*$/)
  const page = num(matched?.[1]) || fallback
  return Math.min(Math.max(1, page), MAX_PAGE)
}

/**
 * 从指令文本里抠出模式与页码
 *
 * @param {*} msg 消息文本
 * @returns {object} `{mode, page}`
 */
export function parseOption (msg) {
  const text = toText(msg)
  const hit = MODE_KEYS.find(item => text.includes(item.key))
  return hit ? { option: hit.option, name: battleOption(hit.option).name } : { option: 0, name: battleOption(0).name }
}

/**
 * 对局回顾的缓存文件名
 *
 * @param {*} roleId 角色 ID
 * @param {*} gameId 对局 ID
 * @returns {string} 缓存文件名
 */
export function replayCacheName (gameSeq) {
  return `replay-${toText(gameSeq)}.yaml`
}

/**
 * 缓存里的回放还新不新鲜
 *
 * @param {*} entry 缓存条目
 * @returns {boolean} 真 = 还能用
 */
export function replayFresh (at) {
  const hours = Config.kingReplayCacheHours
  if (!hours) return false
  return Date.now() - num(at) < hours * 3600 * 1000
}

/**
 * 事件发生时间 → 秒
 *
 * @param {*} event 接口的事件节点
 * @returns {number} 秒数；认不出给 -1
 */
export function eventSeconds (item) {
  for (const key of TIMELINE_TIME_KEYS) {
    let value = num(item?.[key])
    if (value <= 0) continue
    if (value > 7200) value = Math.round(value / 1000)
    if (value > 0 && value <= 86400) return value
  }
  return 0
}

/**
 * 判断内层事件属于哪一类（击杀 / 资源 / 团战）
 *
 * @param {*} event 接口的事件节点
 * @returns {string} 类型名
 */
export function innerEventKind (dtType, dtID) {
  const type = num(dtType)
  const id = num(dtID)
  if (type === 1) {
    if (DRAGON_KINDS[id]) return DRAGON_KINDS[id]
    if (id === 10 || id === 11) return 'buff'
    return 'monster'
  }
  if (type === 2) return id === 10 || id === 20 ? 'core' : 'tower'
  return ''
}

/**
 * 走势里的数字列（可能是字符串，统一成数字）
 *
 * @param {*} list 接口给的数组
 * @returns {Array<number>} 数字数组
 */
export function trendNumbers (value) {
  return (Array.isArray(value) ? value : []).map(item => Number(item)).filter(item => Number.isFinite(item))
}

/**
 * 走势上的数值文案（带正负号、万/亿）
 *
 * @param {*} value 数值
 * @returns {string} 文案
 */
export function trendAmount (value, signed) {
  const size = Math.abs(value)
  const text = size >= 10000 ? `${Math.round(size / 1000)}k` : size >= 1000 ? `${Math.round(size / 100) / 10}k` : String(Math.round(size))
  if (!signed) return text
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${text}`
}

/**
 * 评分 → 水印文字：3.0 及以下「神人」，6.0 及以下「人机」，其余空串。
 *
 * @param {string|number} score 这一局的评分
 * @returns {string} 水印文字；不该贴标就是空串
 */
/**
 * 当前连胜 / 连败：从最新一局往回数，结果一变就停。
 *
 * @param {Array<object>} [list=[]] 战绩列表，最新的排在最前面
 * @returns {{type: string, count: number}} type 是 `win` / `lose`，数不出来时为空串
 */
export function currentStreak (list = []) {
  const first = Number(list?.[0]?.gameresult)
  if (first !== 1 && first !== 2) return { type: '', count: 0 }

  let count = 0
  for (const item of list) {
    if (Number(item?.gameresult) !== first) break
    count += 1
  }

  return { type: first === 1 ? 'win' : 'lose', count }
}

/**
 * 分数档位对应的「人机 / 神人」标签：只在高分那两档才有词，其余给空串。
 *
 * @param {string|number} score 对局评分
 * @returns {string} 标签；不在档位里是空串
 */
export const botLabelOf = score => {
  const value = num(score)
  if (!(value > 0) || value > BOT_SCORE_LINE) return ''
  return value <= GOD_SCORE_LINE ? '神人' : '人机'
}

/**
 * 整段战绩里每一串连胜/连败的**起点**（最新那条）都标出来，不是只看最近那一串。
 * 一行一行往回数，结果一变就开一个新组；只有长度 > 1 的组才算连胜/连败。
 *
 * @param {Array<object>} [list=[]] 战绩列表，最新的排在最前面
 * @param {number} [start=0] 当前页第一行在整段列表里的下标
 * @returns {Map<number, { type: string, count: number }>} 行号 → 这一串的结果与长度
 */
export function StreakMarks (list = [], start = 0) {
  const marks = new Map()
  let type = ''
  let count = 0
  list.forEach((item, i) => {
    const r = Number(item?.gameresult)
    const cur = r === 1 ? 'win' : r === 2 ? 'lose' : ''
    if (!cur) { type = ''; count = 0; return }
    if (cur === type) { count += 1; return }
    type = cur
    count = 1
    marks.set(i, { type: cur, count: 0 })
  })
  /** 第二遍把每组真实长度与组内出现过的模式补回去（长度与模式都要往后数完才知道） */
  for (const [i, mark] of marks) {
    const want = mark.type === 'win' ? 1 : 2
    const modes = new Set()
    let n = 0
    while (i + n < list.length && Number(list[i + n]?.gameresult) === want) {
      const text = `${list[i + n]?.mapName || ''}${list[i + n]?.battleTypeDesc || ''}`
      if (/巅峰/.test(text)) modes.add('巅峰')
      else if (/排位/.test(text)) modes.add('排位')
      n += 1
    }
    mark.count = n
    mark.mode = modes.size > 1 ? '排位/巅峰' : ([...modes][0] || '')
    if (n < 2) marks.delete(i)
  }
  return marks
}
