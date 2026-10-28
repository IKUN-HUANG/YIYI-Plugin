/**
 * @file 群报取数与统计：按周期拉成员战绩、算总分榜、评奖项
 * @module models/King/report/build
 */
import { toText } from '#yiyi.utils'
import { ensureArchive, filterArchive } from '../Archive.js'
/** `maskUserId`/`describeError` 是拆分时漏掉的导入：补查失败那两条 warn 一执行就会 ReferenceError */
import { describeError, maskUserId } from '../Common.js'
import { isWin } from '../Field.js'
import { isHiddenCamp } from '../Hidden.js'
import { cleanName, normalizeName } from '../Profile.js'
import { heroNameOf } from '../External.js'
import { kingLog } from '../Say.js'
import { campQueryOf, pushAccountFor } from '../auth/roles.js'
import { AWARD_DEFS, PERIOD_PAGES, PERIOD_TEXT, REPORT_MAX_MEMBERS, SWITCH_OFF_RE, SWITCH_ON_RE } from './consts.js'

function pad (value) {
  return String(value).padStart(2, '0')
}

/**
 * 营地返回的时间戳有时是秒有时是毫秒，统一成秒再格式化
 *
 * @param {number} sec 时间戳
 * @returns {string 可读时间}
 */
export function formatTs (sec) {
  const date = new Date((Number(sec) || 0) * 1000)
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 从指令里认出周期（日报/周报/月报），认不出默认周报
 *
 * @param {string} msg 用户消息原文
 * @returns {string daily / weekly / monthly}
 */
export function parsePeriod (msg) {
  const text = toText(msg)
  if (text.includes('日')) return 'daily'
  if (text.includes('月')) return 'monthly'
  return 'weekly'
}
/**
 * 解析开/关词：说到「关」就是 false，其余一律 true
 *
 * @param {string} msg 用户消息原文
 * @returns {boolean 关=false，其余=true}
 */
export function parseSwitchOn (msg) {
  const text = toText(msg)
  if (SWITCH_OFF_RE.test(text)) return false
  if (SWITCH_ON_RE.test(text)) return true
  return true
}

/**
 * 解析「#王者日报 开/关」的后半段
 *
 * @param {string} msg 用户消息原文
 * @returns {{period: string, open: boolean}}
 */
export function parseReportSwitch (msg) {
  const text = toText(msg)
  return { open: parseSwitchOn(text), period: text.includes('天') ? 'daily' : parsePeriod(text) }
}

/**
 * 算出周期的时间窗：日报=今天、周报=本周一到现在、月报=本月 1 号到现在
 *
 * @param {string} [period="weekly"] 周期
 * @param {number} [now] 当前时间，毫秒
 * @returns {{from: number, to: number, title: string} 起止时间戳（秒）与期间名}
 */
export function periodRange (period = 'weekly', now = Date.now()) {
  const date = new Date(now)
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const nowSec = Math.floor(now / 1000)

  if (period === 'daily') {
    return { from: Math.floor(dayStart / 1000), to: nowSec, title: PERIOD_TEXT.daily }
  }

  if (period === 'weekly') {
    const offset = (date.getDay() + 6) % 7
    const monday = dayStart - offset * 86400000
    if (offset === 0) {
      return { from: Math.floor((monday - 7 * 86400000) / 1000), to: Math.floor(monday / 1000), title: PERIOD_TEXT.weekly }
    }
    return { from: Math.floor(monday / 1000), to: nowSec, title: PERIOD_TEXT.weekly }
  }

  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime()
  if (date.getDate() === 1) {
    const prevStart = new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime()
    return { from: Math.floor(prevStart / 1000), to: Math.floor(monthStart / 1000), title: PERIOD_TEXT.monthly }
  }
  return { from: Math.floor(monthStart / 1000), to: nowSec, title: PERIOD_TEXT.monthly }
}

/**
 * 把一个人的战绩汇总成一行：场次、胜负、KDA、上分之星（首尾段位差）
 *
 * @param {Array<object>} [battles] 周期内的对局列表
 * @returns {object 这一人的统计行}
 */
export function summarizeBattles (battles = []) {
  let wins = 0
  let losses = 0
  let mvp = 0
  let loseMvp = 0
  let kills = 0
  let deaths = 0
  let assists = 0
  let scoreSum = 0
  let scoreCount = 0
  let stars = 0
  let peakGain = 0
  let bestStreak = 0
  let streak = 0
  const heroes = new Map()

  for (const item of battles) {
    if (isWin(item.gameresult)) {
      wins += 1
      streak += 1
      if (streak > bestStreak) bestStreak = streak
    } else {
      losses += 1
      streak = 0
    }

    if (Number(item.mvpcnt)) mvp += 1
    if (Number(item.losemvp)) loseMvp += 1
    kills += Number(item.killcnt) || 0
    deaths += Number(item.deadcnt) || 0
    assists += Number(item.assistcnt) || 0

    const score = Number(item.gradeGame) || 0
    if (score > 0) {
      scoreSum += score
      scoreCount += 1
    }

    peakGain += (Number(item.newMasterMatchScore) || 0) - (Number(item.oldMasterMatchScore) || 0)

    const heroId = toText(item.heroId)
    if (!heroId) continue
    /** 老归档里可能只存了 heroId（英雄名表那时还没落盘），本地表能翻出来就补上 */
    const name = cleanName(item.heroName) || heroNameOf(heroId)
    const hit = heroes.get(heroId) || { heroId, heroName: name, heroIcon: toText(item.heroIcon), count: 0 }
    hit.count += 1
    if (!hit.heroName) hit.heroName = name
    if (!hit.heroIcon) hit.heroIcon = toText(item.heroIcon)
    heroes.set(heroId, hit)
  }

  const starRows = battles.filter(item => toText(item.roleJobName) && Number.isFinite(Number(item.stars)))
  if (starRows.length > 1 && cleanName(starRows[0].roleJobName) === cleanName(starRows[starRows.length - 1].roleJobName)) {
    stars = Number(starRows[0].stars) - Number(starRows[starRows.length - 1].stars)
  }

  const total = battles.length
  const heroTop = [...heroes.values()].sort((a, b) => b.count - a.count)[0] || null

  return {
    total,
    wins,
    losses,
    mvp,
    loseMvp,
    kills,
    deaths,
    assists,
    stars,
    peakGain,
    bestStreak,
    winRate: total ? wins / total : 0,
    kda: `${kills}/${deaths}/${assists}`,
    avgScore: scoreCount ? scoreSum / scoreCount : 0,
    heroTop
  }
}

/**
 * 按 AWARD_DEFS 评出本期的奖项（上分之星、连胜王等）
 *
 * @param {Array<object>} [rows] 汇总后的成员行
 * @returns {Array<object> 奖项列表}
 */
export function buildAwards (rows = []) {
  const active = rows.filter(row => row.total > 0)

  return AWARD_DEFS.map(def => {
    let best = null
    let bestValue = 0

    for (const row of active) {
      if (def.filter && !def.filter(row)) continue
      const value = def.pick(row)
      if (!Number.isFinite(value) || value <= 0 || value <= bestValue) continue
      best = row
      bestValue = value
    }

    if (!best) return null

    return {
      key: def.key,
      title: def.title,
      name: best.name,
      avatar: '',
      valueText: def.text(bestValue, best),
      detail: def.detail
    }
  }).filter(Boolean)
}

/**
 * 群报是定时自动跑的：隐藏了主页的营地号一天内不该再白打一次请求，所以先过一遍名单把它们跳过。
 *
 * @param {Array<object>} [targets] 要汇总的角色
 * @param {string} [period="weekly"] 周期
 * @returns {Promise<{rows: Array<object>, pages: number, failed: number, skipped: number, from: number, to: number}>}
 */
export async function collectRows (targets = [], period = 'weekly') {
  const { from, to } = periodRange(period)
  const maxPages = PERIOD_PAGES[period] || 3
  const rows = []
  let failed = 0
  let pages = 0
  let skipped = 0

  for (const target of targets.slice(0, REPORT_MAX_MEMBERS)) {
    let mark = false
    if (await isHiddenCamp(target.roleId)) {
      skipped += 1
      continue
    }
    /** 群报是定时自动跑的，只认本人扫码的号，不借别人的号 */
    const account = pushAccountFor({ accountId: target.accountId, owner: toText(target.qq?.[0]), roleId: target.roleId })

    if (account) {
      try {
        const query = campQueryOf(target.roleId, toText(target.qq?.[0]) || toText(target.byUser))
        const result = await ensureArchive(target.roleId, { fromSec: from, maxPages, accountId: account.id, campUserId: query.campUserId })
        pages += result.pages
      } catch (error) {
        mark = true
        failed += 1
        kingLog.warn(`群报补查失败 ${maskUserId(target.roleId)}：${toText(error?.message) || describeError(error)}`)
      }
    } else {
      mark = true
      failed += 1
      kingLog.warn(`群报查不了 ${maskUserId(target.roleId)}：这个角色还没有可用的营地登录信息`)
    }

    const battles = filterArchive(target.roleId, { fromSec: from, toSec: to })
    const stat = summarizeBattles(battles)
    rows.push({
      roleId: toText(target.roleId),
      name: normalizeName(target.roleName),
      qq: (target.qq || []).map(item => toText(item)).join('、'),
      roleIcon: toText(target.roleIcon),
      failed: mark,
      ...stat
    })
  }

  return { rows, failed, pages, skipped, from, to }
}
