/**
 * @file 关键事件时间轴及其分栏布局。
 */
import { num } from './format.js'
import { TIMELINE_TIME_KEYS, DRAGON_KINDS, TIMELINE_SIDE_TEXT, TIMELINE_NEUTRAL_TEXT, TIMELINE_MAX, TIMELINE_COLUMNS } from './consts.js'
import { toText } from '../Common.js'
import { clockText } from '#yiyi.utils'

function eventSeconds (item) {
  for (const key of TIMELINE_TIME_KEYS) {
    let value = num(item?.[key])
    if (value <= 0) continue
    if (value > 7200) value = Math.round(value / 1000)
    if (value > 0 && value <= 86400) return value
  }
  return 0
}

function innerEventKind (dtType, dtID) {
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

function objectiveRow (item, myCamp) {
  const dt = item?.dtData || {}
  const kind = innerEventKind(dt.dtType, dt.dtID)
  if (!kind || kind === 'buff') return null
  const camp = toText(myCamp)
  const mine = kind === 'tower' || kind === 'core'
    ? Boolean(camp) && Boolean(toText(dt.dtCamp)) && toText(dt.dtCamp) !== camp
    : Boolean(camp) && Boolean(toText(dt.killerCamp)) && toText(dt.killerCamp) === camp
  const text = camp ? TIMELINE_SIDE_TEXT[kind][mine ? 1 : 0] : TIMELINE_NEUTRAL_TEXT[kind]
  const seconds = eventSeconds(dt)
  return { seconds, time: seconds ? clockText(seconds) : '--:--', text, isMine: mine }
}

function teamfightRow (item, myCamp) {
  const battle = item?.battle || {}
  const camp = toText(myCamp)
  const kills = Array.isArray(battle.killInfo) ? battle.killInfo : []
  const camp1Kills = kills.filter(kill => toText(kill?.killerCamp) === '1').length
  const camp2Kills = kills.filter(kill => toText(kill?.killerCamp) === '2').length
  const ourKills = camp === '2' ? camp2Kills : camp1Kills
  const theirKills = camp === '2' ? camp1Kills : camp2Kills
  const ourNum = camp === '2' ? num(battle.camp2MemNum) : num(battle.camp1MemNum)
  const theirNum = camp === '2' ? num(battle.camp1MemNum) : num(battle.camp2MemNum)
  const parts = []
  parts.push(ourNum > 0 || theirNum > 0 ? `团战 ${ourNum} 打 ${theirNum}` : '团战交锋')
  parts.push(ourKills > 0 || theirKills > 0 ? `击杀 ${ourKills} : ${theirKills}` : '双方无人阵亡')
  const seconds = eventSeconds(battle) || eventSeconds(item)
  return { seconds, time: seconds ? clockText(seconds) : '--:--', text: parts.join(' · '), isMine: Boolean(camp) && ourKills > theirKills }
}

/**
 * 对局回顾：关键事件（团战 / 推塔拿龙）→ 一行行带时间的记录。
 *
 * 阵营只影响「这波是我们赢还是对面赢」，所以要先从 `playBaseInfoArr` 查出我是哪一方。
 *
 * @param {object} body 详情返回值（`keyEventArr` / `playBaseInfoArr`）
 * @param {string} [playerId=''] 我的 playID，用来判阵营
 * @returns {Array<object>} 回顾行（时间 / 文案 / 是不是我方领先）
 */
export function mapBattleTimeline (body, playerId = '') {
  const events = Array.isArray(body?.keyEventArr) ? body.keyEventArr : []
  const mine = toText(playerId)
  const bases = Array.isArray(body?.playBaseInfoArr) ? body.playBaseInfoArr : []
  const myCamp = mine ? toText(bases.find(item => toText(item?.playID) === mine)?.acntCamp) : ''
  const rows = []
  events.forEach(item => {
    const type = toText(item?.eventType)
    const row = type === 'battle' ? teamfightRow(item, myCamp) : type === 'dragontower' ? objectiveRow(item, myCamp) : null
    if (row && row.seconds > 0) rows.push(row)
  })
  rows.sort((a, b) => a.seconds - b.seconds)
  const tail = rows.length > TIMELINE_MAX ? rows.slice(rows.length - TIMELINE_MAX) : rows
  return tail.map(row => ({ time: row.time, text: row.text, isMine: row.isMine }))
}

/**
 * 对局回顾按三列并排：先按条数均分（30 条 → 10/10/10，31 条 → 11/10/10），
 * 每列最后一行标 sep=false —— 列底不能再画一条分隔虚线，否则三列底部各挂一条悬空的线。
 *
 * @param {Array<object>} rows 回顾行
 * @param {number} [cols=TIMELINE_COLUMNS] 分几列
 * @returns {Array<Array<object>>} 每列一个数组；空输入给空数组
 */
export function timelineColumns (rows, cols = TIMELINE_COLUMNS) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return []
  const count = Math.max(1, Math.min(cols, list.length))
  const base = Math.floor(list.length / count)
  const extra = list.length % count
  const out = []
  let at = 0
  for (let i = 0; i < count; i += 1) {
    const size = base + (i < extra ? 1 : 0)
    if (!size) continue
    out.push(list.slice(at, at + size).map((row, index) => ({ ...row, sep: index < size - 1 })))
    at += size
  }
  return out
}
