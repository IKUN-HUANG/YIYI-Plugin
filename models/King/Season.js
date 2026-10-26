/**
 * @file 赛季纯函数——赛季号归一、赛季行映射、走势取点这些纯计算，没有网络也没有模板，方便被别的模块复用。
 * @module models/King/Season
 */
/**
 * 赛季数据的映射层：只留「营地 historyList 一条 → 汇总表一行」的映射与取值口径，
 * 给「#王者营地」卡的赛季汇总表用。视图逻辑（雷达图、分路、走势）不在这层，别再往这里加。
 */
import { toText } from './Common.js'
import { heroBriefOf } from './Field.js'
import { numOf, countText } from '#yiyi.utils'

/** 营地 masterScore 的起始分：超过它才算真打过巅峰赛 */
const PEAK_BASE_SCORE = 1200
/** 每个赛季最多带几个「赛季常用英雄」 */
const SEASON_HERO_LIMIT = 3
/** 汇总表一行最多带几个英雄（营地卡那块地方窄，5 个刚好一行） */
const SEASON_ALL_HERO_LIMIT = 5

const JOB_COLORS = [
  [/王者/, '#c9930a'],
  [/星耀/, '#8e6fd8'],
  [/钻石/, '#3b82f6'],
  [/铂金|白金/, '#2f9e6e'],
  [/黄金/, '#d97a1a'],
  [/白银/, '#8a99ad'],
  [/青铜/, '#a06a45']
]
const JOB_COLOR_DEFAULT = '#7c8aa0'

/** 小工具 —— 取值、拼串、配色这类小函数，每支一个用途，别把业务判断往这儿塞 */

function obj (value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function listOf (value) {
  return Array.isArray(value) ? value : []
}

/** 营地胜率有时给 0.589、有时给 58.9、有时给 null（这场分路没数据），统一成 '59%' */
function rateText (value) {
  if (value === null || value === undefined || value === '') return ''
  const num = Number(value)
  if (!Number.isFinite(num)) return ''
  const per = num > 1 ? num : num * 100
  return `${Math.round(per)}%`
}

function winRateOf ({ win = 0, total = 0, rate = '' } = {}) {
  const text = rateText(rate)
  if (text) return text
  return total > 0 ? `${Math.round(numOf(win) / total * 100)}%` : ''
}

/** 'S45赛季' / '第45赛季' → 'S45'；认不出来就原样返回 */
function seasonTagOf (seasonName) {
  const text = toText(seasonName)
  const hit = text.match(/[sS]\s*(\d+)/)
  if (hit) return `S${hit[1]}`
  return text
}

function monthOf (value) {
  const stamp = Number(value)
  if (!Number.isFinite(stamp) || stamp <= 0) return ''
  const date = new Date(stamp * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}.${date.getMonth() + 1}`
}

function dateRangeOf (startTime, endTime) {
  const from = monthOf(startTime)
  const to = monthOf(endTime)
  if (!from || !to) return '—'
  return `${from} - ${to}`
}

/** '最强王者' 这类段位名取第一个词，汇总表一行放不下全称 */
function shortJobName (name = '') {
  const text = toText(name)
  const hit = text.match(/^([^\s·]+)/)
  return hit ? hit[1] : text
}

function jobColorOf (name = '') {
  const text = toText(name)
  for (const [pattern, color] of JOB_COLORS) {
    if (pattern.test(text)) return color
  }
  return JOB_COLOR_DEFAULT
}

function seasonHeroRows (heros = [], limit = SEASON_HERO_LIMIT) {
  const rows = listOf(heros)
    .map(raw => ({
      ...heroBriefOf(raw),
      winCount: countText(raw?.winCnt),
      winRate: rateText(raw?.winRate),
      power: countText(raw?.heroFightPower ?? raw?.fightPower)
    }))
    .filter(item => item.name !== '未知英雄')

  const max = Number(limit) > 0 ? Number(limit) : SEASON_HERO_LIMIT
  return rows.slice(0, max)
}

/**
 * 营地 historyList 的一条 → 汇总表一行。
 *
 * mode: '排位' 读 rankInfo，'巅峰' 读 masterInfo —— 两边字段名长得像但含义不同（mastr 那边是分数、rank 那边是星数），
 * 所以按 mode 分两路取，不要写「有就用」的混取。
 *
 * @param {object} [entry] 营地 historyList 的一条（seasonName / rankInfo / masterInfo / startTime / endTime）
 * @param {object} [options]
 * @param {string} [options.mode='排位'] '排位' 或 '巅峰'，决定读哪一组字段
 * @returns {{seasonName: string, seasonTag: string, isCurrent: boolean, dateRange: string, games: number, wins: number, loses: number, winRate: string, streak: string, gold: string, silver: string, avgScore: string, scoreLabel: string, jobName: string, shortJob: string, rankingStar: string, jobColor: string, star: number, masterScore: number, peakText: string, heros: Array<object>, trendValue: number, trendTip: string}} 汇总表一行；没数据的格子是 '—' 而不是空串
 */
export function mapSeasonEntry (entry = {}, { mode = '排位' } = {}) {
  const body = obj(entry)
  const rank = obj(body.rankInfo)
  const master = obj(body.masterInfo)
  const isPeak = mode === '巅峰'

  const rankGames = numOf(rank.totalCnt) || numOf(rank.gameCnt)
  const rankWins = numOf(rank.totalWinCnt)
  const masterGames = numOf(master.totalCnt)
  const masterWins = numOf(master.totalWinCnt)
  const masterScore = numOf(master.masterScore)

  const games = isPeak ? masterGames : rankGames
  const wins = isPeak ? masterWins : rankWins
  const jobName = toText(rank.jobName)
  const star = toText(rank.rankingStar)
  const avg = isPeak ? numOf(master.averageScore) : numOf(rank.averageScore)

  return {
    seasonName: toText(body.seasonName),
    seasonTag: seasonTagOf(body.seasonName),
    isCurrent: Boolean(body.isCurrent),
    dateRange: dateRangeOf(body.startTime, body.endTime),
    games,
    wins,
    loses: Math.max(0, games - wins),
    winRate: winRateOf({ win: wins, total: games, rate: isPeak ? master.winRate : rank.winRate }) || '—',
    streak: countText(isPeak ? master.maxContinuousWinCnt : rank.maxContinuousWinCnt),
    gold: isPeak ? countText(master.goldMedal) : countText(rank.goldCnt),
    silver: isPeak ? countText(master.sliverMedal ?? master.silverMedal) : countText(rank.silverCnt),
    avgScore: countText(avg),
    scoreLabel: numOf(avg) > 0 && numOf(avg) <= 20 ? '平均分 · 旧 10 分制' : '平均分',
    jobName,
    shortJob: shortJobName(jobName),
    rankingStar: star,
    jobColor: jobColorOf(jobName),
    star: numOf(rank.totalRankStar) + numOf(star),
    masterScore,
    peakText: masterScore > PEAK_BASE_SCORE || masterGames > 0 ? String(masterScore) : '—',
    heros: seasonHeroRows(rank.heros || master.heros, SEASON_ALL_HERO_LIMIT),
    trendValue: isPeak ? masterScore : numOf(rank.totalRankStar) + numOf(star),
    trendTip: isPeak
      ? `${masterScore} 分`
      : (jobName ? `${shortJobName(jobName)}${star ? ` ${star}星` : ''}` : '—')
  }
}
