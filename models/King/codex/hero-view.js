/**
 * @file 常用英雄排序与列表视图。
 * @module models/King/codex/hero-view
 */
import { autoSize, textWidth } from '#yiyi.utils'
import { toText } from '../Common.js'
import { MY_HEROES_TOP, MY_HEROES_MAX, MY_HERO_NAME_ROOM, MY_HERO_NAME_BASE, MY_HERO_NAME_MIN, MY_HERO_SUB_SIZE, MY_HERO_SUB_GAP } from './constants.js'
import { honorBadgeOf } from './honor.js'

/** ============================================================ 视图：常用英雄 */

/** 熟练度等级 → 营地里的叫法。实测 8=神话 7=传说 6=巅峰 5=超凡，4 及以下不猜，直接 Lv.N */
const SKILLED_NAME = { 8: '神话', 7: '传说', 6: '巅峰', 5: '超凡' }

/** 战力配色，跟营地英雄榜同一套阈值 */
function fightColor (power) {
  const value = Number(power) || 0
  if (value <= 2500) return '#c8c8c8'
  if (value <= 5000) return '#6f8ef5'
  if (value <= 7500) return '#a24bff'
  if (value <= 10000) return '#f5d76e'
  return '#ff5b7c'
}

/** 「元流之子(射手)」→ { name: '元流之子', sub: '射手' } */
function splitHeroName (value) {
  const text = toText(value)
  const matched = text.match(/^(.+?)\s*[（(]([^）)]+)[）)]\s*$/)
  return { name: matched ? matched[1] : text, sub: matched ? matched[2] : '' }
}

/** 百分数：营地有时给 0.538、有时给 "53.8%"，两种都认 */
function pctText (value) {
  const text = toText(value).trim()
  if (text.includes('%')) return text
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return `${(num * 100).toFixed(1)}%`
}

/** 场次：赛季常用英雄给 gameCnt，全量英雄表给 playNum，名字不一样但都是一个东西 */
function playOf (raw) {
  for (const key of ['gameCnt', 'playNum', 'count', 'battleCount', 'games']) {
    const value = Number(raw?.[key])
    if (Number.isFinite(value) && value >= 0 && raw?.[key] !== undefined) return value
  }
  return 0
}

/**
 * 一条英雄记录 → 视图。
 * 场次/胜率来自 h5getherolist（生涯累计，playNum 是营地那页的口径），
 * 战力优先用历史最高（maxHeroFightPower，已经由 readMyHeroes 并进 displayPower），拿不到才退回当前战力。
 */
function heroRowOf (raw, index) {
  const rawName = toText(raw?.heroName ?? raw?.name ?? raw?.title ?? raw?.alias)
  const { name, sub } = splitHeroName(rawName)
  const play = playOf(raw)
  const winNum = Number(raw?.winNum ?? raw?.winCnt) || 0
  /** h5getherolist 的 winRate 已经是 "53.8%" 这种字符串，不能再乘 100 */
  const winRate = toText(raw?.winRate).trim()
    ? pctText(raw.winRate)
    : (play > 0 ? `${(winNum / play * 100).toFixed(1)}%` : '—')
  const power = Number(raw?.displayPower) || Number(raw?.maxHeroFightPower) || Number(raw?.heroFightPower) || 0
  const level = Number(raw?.skilledLevel ?? raw?.skilledLevelId) || 0

  return {
    rank: index + 1,
    heroId: toText(raw?.heroId ?? raw?.heroid),
    name: name || '未知英雄',
    sub,
    /** heroTypes 是数组（瑶是 ["辅助","法师"]），对应营地那页英雄名下面的定位 */
    heroType: (Array.isArray(raw?.heroTypes) ? raw.heroTypes.join('/') : toText(raw?.heroType)) || sub,
    skilledText: level ? (SKILLED_NAME[level] || `Lv.${level}`) : toText(raw?.skilledTitle),
    /** 称号取「拿历史最高战力时」的那条，原样展示（「中国澳门第58孙权」），解析不出来就当没有 */
    honorText: toText(raw?.honorText) || toText(raw?.honorTitle?.desc?.full),
    /** 营地给的 TitleType（1 小范围 / 2 带地名市级）：定档位用，缺了就从文字里认 */
    honorType: toText(raw?.honorType ?? raw?.honorTitle?.type),
    play,
    playText: play > 0 ? `${play} 场` : '—',
    winRate,
    winNum,
    power: power > 0 ? String(power) : '—',
    powerColor: fightColor(power),
    powerValue: power,
    icon: toText(raw?.heroIcon ?? raw?.icon ?? raw?.url)
  }
}

/**
 * 常用英雄视图：按战力降序（营地那页「最高战力」列就是这么排的），战力相同场次多的靠前。
 * @param {object[]} list h5getherolist 的 heroList（已并进 displayPower / honorText）
 * @param {{ limit?: number, seasonName?: string, powerLabel?: string, ownCount?: number }} options 显示几个（默认 10，上限 30）、赛季名、战力列标题、已拥有英雄数
 * @returns {{rows: object[], powerLabel: string, ownCount: number, isEmpty: boolean}} 视图：带名次/配色/称号徽章的行，一行都没有时 isEmpty 为 true
 */
export function buildMyHeroesView (list = [], { limit = MY_HEROES_TOP, seasonName = '', powerLabel = '最高战力', ownCount = 0 } = {}) {
  const rows = (Array.isArray(list) ? list : [])
    .filter(raw => raw && typeof raw === 'object')
    .map(heroRowOf)

  /** 没打过的英雄场次为 0，营地那页也不展示；整份都是 0（接口不给场次）时才原样保留 */
  const played = rows.filter(row => row.play > 0)
  const pool = played.length ? played : rows

  const sorted = [...pool].sort((a, b) => (b.powerValue - a.powerValue) || (b.play - a.play))
  const size = Math.min(Math.max(1, Number(limit) || MY_HEROES_TOP), MY_HEROES_MAX)
  const picked = sorted.slice(0, size).map((row, index) => ({
    ...row,
    rank: index + 1,
    /** 名字放不下就压字号、不换行：徽章是独立一列，名字一折行会把行高撑歪 */
    nameSize: autoSize(
      row.name,
      MY_HERO_NAME_BASE,
      MY_HERO_NAME_MIN,
      MY_HERO_NAME_ROOM - (row.sub ? Math.ceil(textWidth(row.sub) * MY_HERO_SUB_SIZE) + MY_HERO_SUB_GAP : 0)
    ),
    /** 有称号就带上那枚奖牌底图（现在是独立一列、右对齐，见 my-heroes.html） */
    honor: honorBadgeOf(row.honorText, { type: row.honorType })
  }))

  const totalPlay = pool.reduce((sum, row) => sum + row.play, 0)
  const totalWin = pool.reduce((sum, row) => sum + row.winNum, 0)

  return {
    isEmpty: !pool.length,
    seasonName: toText(seasonName),
    /** 历史接口拿不到时图上要如实标成当前口径，不能默认写「最高战力」 */
    powerLabel: toText(powerLabel) || '最高战力',
    heroCount: pool.length,
    ownCount: Math.max(Number(ownCount) || 0, pool.length),
    shownCount: picked.length,
    totalPlay,
    totalRate: totalPlay ? `${(totalWin / totalPlay * 100).toFixed(1)}%` : '—',
    rows: picked
  }
}
