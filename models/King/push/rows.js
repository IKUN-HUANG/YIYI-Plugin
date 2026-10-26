/**
 * @file 推送行的构造与文案：上线/开局/结束三种，第二三行必须各自只占一行
 * @module models/King/push/rows
 */
import { toText, truncInt } from '#yiyi.utils'
import { decoratePushRows } from './card.js'
import { parseBattleTime } from '../Archive.js'
import { logoUri } from '../Card.js'
import { resolveEvaluate } from '../Field.js'
import { kingIconBase64 } from '../Icon.js'
import { cleanName, normalizeName } from '../Profile.js'
import { durationCompact, durationText } from './items.js'

/**
 * 按对局时间顺序算当前连胜或连败：从最新一局往回数，结果一变就停
 *
 * @param {Array<object>} [list] 对局列表，按时间正序
 * @returns {{type: string, count: number} win / lose 与连了几局；没有连胜连败时 type 为空串}
 */
export function calcStreak (list = []) {
  const first = list[0]
  const target = truncInt(first?.gameresult)
  if (target !== 1 && target !== 2) return { type: '', count: 0 }

  let count = 0
  for (const item of list) {
    if (truncInt(item?.gameresult) !== target) break
    count += 1
  }

  return { type: target === 1 ? 'win' : 'lose', count }
}

/**
 * 从对局列表里挑出这个订阅还没推过的新对局：比对游标与已推过的 gameSeq
 *
 * @param {Array<object>} [list] 对局列表
 * @param {object} [sub] 订阅记录，带游标
 * @returns {Array<object> 新对局的列表}
 */
export function pickNewBattles (list = [], sub = {}) {
  if (!Array.isArray(list) || !list.length) return []

  const lastSeq = toText(sub?.lastGameSeq)
  const lastTime = truncInt(sub?.lastGameTime)
  if (!lastSeq && !lastTime) return []
  if (lastSeq && toText(list[0]?.gameSeq) === lastSeq) return []

  const bySeq = () => {
    const idx = list.findIndex(item => toText(item?.gameSeq) === lastSeq)
    return idx < 0 ? list.slice() : list.slice(0, idx)
  }

  if (!lastTime) return bySeq().reverse()

  const fresh = list.filter(item => toText(item?.gameSeq) !== lastSeq && truncInt(parseBattleTime(item)) > lastTime)
  return fresh.reverse()
}

/**
 * 三行推送里把「巅峰分 1760 → 1789（+29）」压成「巅峰分1760→1789(+29)」，别让第三行折行
 *
 * @param {string} [text=""] 原始分数变化文本
 * @returns {string 压过的文本}
 */
export function compactDeltaText (text = '') {
  return toText(text).replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')')
}

/**
 * 算出这一局和上一局的分差文案（排位星数 / 巅峰分），没有可比数据时回空串
 *
 * @param {object} [item] 这一局
 * @param {object} [prev=null] 上一局
 * @returns {{tone: string, text: string}|null 分数变化文案，没可比数据时回 null}
 */
export function formatScoreDelta (item = {}, prev = null) {
  const oldScore = truncInt(item?.oldMasterMatchScore)
  const newScore = truncInt(item?.newMasterMatchScore)
  if (oldScore > 0 && newScore > 0 && oldScore !== newScore) {
    const diff = newScore - oldScore
    return { tone: diff > 0 ? 'up' : 'down', text: `巅峰分 ${oldScore} → ${newScore}（${diff > 0 ? '+' : ''}${diff}）` }
  }

  const rank = cleanName(item?.roleJobName)
  if (!rank) return null

  const stars = truncInt(item?.stars)
  const prevRank = cleanName(prev?.roleJobName)
  const prevStars = truncInt(prev?.stars)

  if (prevRank && prevRank !== rank) {
    const tone = Math.abs(prevStars) > 0 || rank ? (rank > prevRank ? 'up' : 'down') : 'flat'
    return { tone, text: `段位 ${prevRank} → ${rank}` }
  }

  if (!prev || !prevRank || prevStars <= 0) return { tone: 'flat', text: `${rank} ${stars} 星` }

  const diff = stars - prevStars
  if (!diff) return { tone: 'flat', text: `${rank} ${stars} 星` }
  return { tone: diff > 0 ? 'up' : 'down', text: `${rank} ${stars} 星（${diff > 0 ? '+' : ''}${diff}）` }
}

/**
 * 结束局的第二、三行：战绩数据与补充信息（连胜、分数变化、时长）
 *
 * @param {object} [item] 这一局
 * @param {object} [prev=null] 上一局
 * @param {string} [name=""] 游戏名
 * @param {string} [extra=""] 额外后缀
 * @returns {string 第二、三行，换行分隔}
 */
export function formatBattleText (item = {}, prev = null, name = '', extra = '') {
  const win = truncInt(item?.gameresult) === 1
  const hero = cleanName(item?.heroName) || (toText(item?.heroId) ? `英雄${toText(item.heroId)}` : '未知英雄')
  const kda = `${truncInt(item?.killcnt)}/${truncInt(item?.deadcnt)}/${truncInt(item?.assistcnt)}`
  const grade = item?.gradeGame ? ` · 评分 ${item.gradeGame}` : ''
  const who = cleanName(name)

  const lines = [
    `【王者战绩】${who || '本群成员'}`,
    `${win ? '🏆 胜利' : '💧 失败'} · ${hero} · ${kda}${grade}`
  ]

  const change = formatScoreDelta(item, prev)
  if (change) lines.push(`${change.tone === 'up' ? '📈' : change.tone === 'down' ? '📉' : '⭐'} ${change.text}`)

  const parts = []
  const mode = cleanName(item?.mapName)
  if (mode) parts.push(mode)
  const duration = durationText(item?.usedTime)
  if (duration) parts.push(`⏱ ${duration}`)
  if (parts.length) lines.push(parts.join(' · '))

  if (extra) lines.push(extra)
  return lines.join('\n')
}

/**
 * 开局行的第二、三行：模式 + 英雄名 与 开始时间
 *
 * @param {object} [gaming] 主页里的对局中信息
 * @param {string} [name=""] 游戏名
 * @returns {string 第二、三行，换行分隔}
 */
export function formatGamingText (gaming = {}, name = '') {
  const who = normalizeName(name)
  const mode = cleanName(gaming?.mapName) || '对局'

  const lines = [`【开局提醒】${who} 进入了${mode}`]
  const stat = []
  const gameNum = truncInt(gaming?.gameNum)
  if (gameNum > 0) stat.push(`${gameNum} 场`)
  if (gaming?.winRate) stat.push(`胜率 ${gaming.winRate}`)
  if (stat.length) lines.push(`🎮 ${stat.join(' · ')}`)

  const minutes = truncInt(gaming?.duration)
  if (minutes > 0) lines.push(`开局 ${minutes} 分钟`)
  return lines.join('\n')
}

/**
 * 上下线行的第二、三行：游戏名与这次在线/离线多久
 *
 * @param {string} kind online 或 offline
 * @returns {string 第二、三行，换行分隔}
 */
export function formatOnlineText (kind, { name = '', gameOnline = 0, durationSec = 0, session = null } = {}) {
  const who = normalizeName(name)

  if (kind === 'online') {
    return `【上下线提醒】🟢 ${who} 王者已上线${truncInt(gameOnline) === 2 ? ' · 已进游戏' : ''}`
  }

  const lines = [`【上下线提醒】⚫ ${who} 王者已下线`]
  const duration = durationText(durationSec)
  if (duration) lines[0] += ` · 本次在线 ${duration}`

  if (session?.count > 0) {
    lines.push(`🎮 打了 ${session.count} 局 · ${session.win} 胜 ${session.lose} 负`)
  } else if (duration) {
    lines.push('🎮 本次没有新战绩')
  }

  return lines.join('\n')
}

/**
 * 拼一条推送行的公共骨架：昵称、QQ 号、头像、编号列
 *
 * @param {string} kind 行类型
 * @param {string} name 游戏名
 * @param {object} [opts] 各类型的额外字段
 * @returns {object 推送行}
 */
export function pushRow (kind, name, opts = {}) {
  return {
    kind: toText(kind),
    no: toText(opts.no),
    face: toText(opts.face),
    /** 第一行：QQ 昵称(QQ号)，发卡前由 decoratePushRows 补上 */
    name: toText(name),
    /** 第二行开头的游戏名（营地角色名），也是发卡前补 */
    who: toText(opts.who),
    /** 一条推送只摆三行：第一行 QQ 昵称(QQ号)，第二、三行就是这两个 */
    line2: toText(opts.line2),
    line3: toText(opts.line3),
    /** 顶级 / 金牌 / 银牌 / 铜牌：跟战绩详情同一套图标（图片，不是奖牌 emoji） */
    medal: toText(opts.medal),
    chip: opts.chip ? { text: toText(opts.chip.text), tone: toText(opts.chip.tone) || 'on' } : null,
    result: opts.result ? { text: toText(opts.result.text), tone: toText(opts.result.tone) || 'flat' } : null,
    /** 排位赛 / 巅峰赛：跟胜负徽章一起竖在最左边那列 */
    mode: toText(opts.mode)
  }
}

/**
 * 结束局的行：模式胶囊 + 战绩 + 补充
 *
 * @param {object} [item] 这一局
 * @param {object} [prev=null] 上一局
 * @param {string} [name=""] 游戏名
 * @param {string} [extra=""] 额外后缀
 * @returns {object 推送行}
 */
export function battleRow (item = {}, prev = null, name = '', extra = '') {
  const win = truncInt(item?.gameresult) === 1

  /** 「排位赛 / 巅峰赛」在左边那列，这里只留组队人数（五排 / 三排 / 双排） */
  const mode = cleanName(item?.mapName)
  const ranked = /^(排位赛|巅峰赛)/.test(mode)
  const modeLabel = ranked ? (mode.startsWith('巅峰') ? '巅峰赛' : '排位赛') : mode
  const team = ranked ? mode.replace(/^(排位赛|巅峰赛)\s*/, '') : ''

  /** 第二行：组队人数 · KDA · 评分（三排写在 KDA 前面），金银铜牌图标挂行尾 */
  const second = []
  if (team) second.push(team)
  second.push(`KDA ${truncInt(item?.killcnt)}/${truncInt(item?.deadcnt)}/${truncInt(item?.assistcnt)}`)
  const grade = toText(item?.gradeGame)
  if (grade) second.push(`评分 ${grade}`)

  /** 第三行：时长 · 巅峰分（跟水平时的段位变化）· 连胜 */
  const third = []
  const duration = durationCompact(item?.usedTime)
  if (duration) third.push(`时长 ${duration}`)

  const change = formatScoreDelta(item, prev)
  if (change) third.push(`${change.tone === 'up' ? '📈' : change.tone === 'down' ? '📉' : '⭐'} ${compactDeltaText(change.text)}`)
  if (extra) third.push(extra)

  /** 营地给的分路 / 勋章评价：顶级打野、金牌射手这种，行尾挂图标 */
  const evaluate = resolveEvaluate([item?.evaluateUrlV3, item?.evaluateUrlV2, item?.evaluateUrl])

  return pushRow('battle', cleanName(name) || '本群成员', {
    line2: second.join(' · '),
    line3: third.join(' · '),
    medal: evaluate.icon,
    mode: modeLabel,
    /** 胜负挪到最前面挨着 No.，用颜色填满的方框 */
    result: { text: win ? '胜利' : '失败', tone: win ? 'win' : 'lose' },
    face: kingIconBase64('hero', item?.heroId)
  })
}

/**
 * 开局行的行：对局中模式 + 英雄 + 时长
 *
 * @param {object} [gaming] 对局中信息
 * @param {string} [name=""] 游戏名
 * @returns {object 推送行}
 */
export function gamingRow (gaming = {}, name = '') {
  /** 第二行（跟角色名同一行）：这一局开局多久，一眼就知道还要等多久 */
  const second = []
  const minutes = truncInt(gaming?.duration)
  if (minutes > 0) second.push(`开局 ${minutes} 分钟`)

  /** 第三行：胜率先说，再打了几场 */
  const third = []
  if (gaming?.winRate) third.push(`胜率 ${gaming.winRate}`)
  const gameNum = truncInt(gaming?.gameNum)
  if (gameNum > 0) third.push(`${gameNum} 场`)

  return pushRow('gaming', normalizeName(name), {
    line2: second.join(' · '),
    line3: third.join(' · '),
    chip: { text: cleanName(gaming?.mapName) || '对局中', tone: 'play' },
    face: kingIconBase64('hero', gaming?.heroId)
  })
}

/**
 * 上下线行的行：在线/离线/游戏中 + 时长
 *
 * @param {string} kind online 或 offline
 * @returns {object 推送行}
 */
export function onlineRow (kind, { name = '', gameOnline = 0, durationSec = 0, session = null } = {}) {
  const online = kind === 'online'
  const third = []

  if (online) {
    if (truncInt(gameOnline) === 2) third.push('刚刚进入游戏')
  } else {
    const duration = durationCompact(durationSec)
    if (duration) third.push(`本次在线 ${duration}`)
    if (session?.count > 0) third.push(`打了 ${session.count} 局 · ${session.win} 胜 ${session.lose} 负`)
    else if (duration) third.push('本次没有新战绩')
  }

  return pushRow('online', normalizeName(name), {
    line3: third.join(' · '),
    chip: { text: online ? '已上线' : '已离线', tone: online ? 'on' : 'off' },
    face: logoUri()
  })
}
