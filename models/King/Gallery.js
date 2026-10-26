/**
 * @file 赛季摘要与图鉴解析——赛季页 / 战绩页 / 详情页的原始 JSON 折成卡片可直接吃的结构，纯解析为主，取数一律走 Api 门面。
 * @module models/King/Gallery
 */
import { createLogger, countText, escapeXml } from '#yiyi.utils'
import { kingReply, kingFail, kingGuard } from './Say.js'
import { renderKing, timeText, logoUri } from './Card.js'
import { getSeasonPage, getSeasonUsuallyHeroList, getDetailRankList, getHeroRecordDetail, getFightData, getBattleList } from './Api.js'
import { rankBandInfo, rankBandShort, thin, PEAK_RESET_GAP } from './Trend.js'
import { toText, isProfileHiddenCode } from './Common.js'
import { kingContext, ownerTextOf } from './Context.js'
import { fetchHeroTable } from './External.js'
import { lineChart } from './Chart.js'
import { heroIconByName, heroIconUri, gearUri } from './Icon.js'
import { mapSeasonEntry } from './Season.js'
import { heroTextOf, heroBriefOf } from './Field.js'
import { readCache, writeCache } from './Store.js'

const log = createLogger('王者图鉴')

/** 目标用户 + 绑定 + 可用登录态：图鉴卡共用的一套取号（王者营地 / 英雄战绩 / 出装都走这里） */
async function bindTarget (e) {
  const ctx = await kingContext(e)
  return { owner: ctx.owner, bind: ctx.bind, account: ctx.account, error: ctx.error }
}

/**
 * 赛季表现那张卡一页摆几个赛季（营地历史赛季列表常见的量级，够看一屏）。
 * @type {number}
 */
export const SEASON_PAGE_SIZE = 24
/**
 * 梯度榜每个档位最多列几个英雄（T0 常常很多，太多会把卡撑长）。
 * @type {number}
 */
export const TIER_MAX = 40
/**
 * 出装推荐最多几件装备（营地的出装位就是六格）。
 * @type {number}
 */
export const EQUIP_MAX = 6
/**
 * 铭文推荐最多几条（一套铭文就是这个量级）。
 * @type {number}
 */
export const RING_MAX = 10
/**
 * 英雄战绩卡「最近战绩」摆几场。
 * @type {number}
 */
export const HERO_RECORD_ROWS = 8

/** 段位筛选：文字 → segment。巅峰 3 / 所有段位 1 / 顶端排位 4 / 赛事 5 */
export const SEGMENT_MAP = [
  { seg: 3, names: ['巅峰赛', '巅峰', '1350', '巅峰赛1350+'] },
  { seg: 1, names: ['所有段位', '全段位', '全部段位', '所有'] },
  { seg: 4, names: ['顶端排位', '顶端', '顶端局'] },
  { seg: 5, names: ['赛事', 'kpl', '职业'] }
]

/**
 * 段位筛选项 → 用户看到的名字（筛选项的值见 SEGMENT_MAP）。
 * @type {Record<number, string>}
 */
export const SEGMENT_LABEL = { 1: '所有段位', 3: '巅峰赛1350+', 4: '顶端排位', 5: '赛事' }

/** 分路筛选：文字 → position。对抗 1 / 中路 2 / 发育 3 / 游走 4 / 打野 5 */
export const POSITION_MAP = [
  { pos: 1, names: ['对抗路', '对抗', '上单', '边路'] },
  { pos: 2, names: ['中路', '中单'] },
  { pos: 3, names: ['发育路', '发育', '射手', 'adc', '下路'] },
  { pos: 4, names: ['游走', '辅助'] },
  { pos: 5, names: ['打野'] }
]

/**
 * 分路筛选项 → 完整分路名。别的卡（分路表现等）也拿它当完整名用，
 * 需要去掉「路」字的短名请用 CAMP_LANE_LABEL，别改这张表。
 * @type {Record<number, string>}
 */
export const POSITION_LABEL = { 0: '全部分路', 1: '对抗路', 2: '中路', 3: '发育路', 4: '游走', 5: '打野' }

/**
 * 营地卡「分路表现」里的短名：对抗路 / 发育路去掉「路」字。
 * 只给这张卡用 —— POSITION_LABEL 还被别的卡（positionLabel 等）当完整分路名用，
 * 改它的语义会把别处一起带歪，所以另开一张表。
 * 中路 / 游走 / 打野本来就不带「路」，保持原样；「全部分路」是筛选用的总称，也不动。
 */
export const CAMP_LANE_LABEL = { 0: '全部分路', 1: '对抗', 2: '中路', 3: '发育', 4: '游走', 5: '打野' }

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
 * 梯度榜的档位顺序（从强到弱），出图与分组都按这个序，不认营地返回的顺序。
 * @type {string[]}
 */
export const TIER_ORDER = ['T0', 'T1', 'T2', 'T3']

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

function pct (value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return ''
  return `${(num * 100).toFixed(1)}%`
}

/** ============================================================ 取号共通 */

/** ============================================================ 赛季表现 */

/** 常用英雄：排位页与巅峰页、赛季列表里的 heros 是同一个形状，三处共用 */
function seasonHeroOf (raw) {
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
function branchRateOf (item = {}) {
  const rate = pct(item?.winRate)
  if (rate) return rate
  const games = Number(item?.gameCnt) || Number(item?.totalCnt) || 0
  const wins = Number(item?.winCnt) || Number(item?.winGameCnt) || Number(item?.totalWinCnt) || 0
  return games > 0 && wins > 0 ? pct(wins / games) : ''
}

/**
 * 本赛季「上分走势」：营地赛季页 `behavior.rankInfo.gameTrend` 每个段位/星数变化记一个点。
 * 纵轴用「本季累计星点」= totalRankStar + stars —— 这才是真正的上分进度
 * （星耀II 90+2=92 → 星耀I 95+0=95 → 王者 100+15=115），只取当季星数就会在升段时
 * 变成 2★→0★ 的假掉星。mark 仍然写人看得懂的「王者 15★」。
 * @param {object[]} gameTrend 营地给的是新的在前
 * @param {{startTime?: number, endTime?: number}} opts 赛季起止（秒），给了就只留这个区间里的点
 * @returns {object[]} 按时间正序的走势点：{at（秒）, dateText/label（月.日）, value（本季累计星点 = totalRankStar + stars）, stars（当季星数）, score（当时的巅峰分）, jobName, jobShort, jobColor, mark（「王者 15★」）}；没有有效点时给空数组
 */
export function campTrendOf (gameTrend = [], { startTime = 0, endTime = 0 } = {}) {
  const from = Number(startTime) || 0
  const to = Number(endTime) || 0

  return (Array.isArray(gameTrend) ? gameTrend : [])
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const at = Number(item.time) || 0
      const stars = Number(item.stars) || 0
      const total = Number(item.totalRankStar) || 0
      return {
        at,
        dateText: at > 0 ? `${new Date(at * 1000).getMonth() + 1}.${new Date(at * 1000).getDate()}` : '',
        label: at > 0 ? `${new Date(at * 1000).getMonth() + 1}.${new Date(at * 1000).getDate()}` : '',
        value: total + stars,
        stars,
        /** 营地每个点还带着当时的巅峰分：营地卡「本赛季巅峰(最高)」拿它取最大值 */
        score: Number(item.score) || 0,
        jobName: toText(item.jobName),
        jobShort: jobShortOf(item.jobName),
        jobColor: toText(item.jobColor),
        mark: `${jobShortOf(item.jobName)} ${stars}★`
      }
    })
    .filter(item => Number.isFinite(item.value) && (!from || !to || !item.at || (item.at >= from && item.at <= to)))
    .sort((a, b) => a.at - b.at)
}

/** 段位名压短：「最强王者」→「王者」、「永恒钻石」→「钻石」，只给图上那行字用 */
function jobShortOf (name) {
  return toText(name)
    .replace(/^(?:最强|永恒|至尊|荣耀|尊贵|秩序|倔强)/, '')
    .trim()
}

/**
 * 赛季页一次性给全：headCard（段位/星/巅峰分/胜率/场次）、battleStats（五维与原画）、
 * behavior.rankInfo（排位常用英雄 + 分路 + 上分走势）、behavior.masterInfo（巅峰常用英雄）。
 * 五维是万分制，跟营地那页一样按 12000 折成百分比。
 *
 * @param {object} data getSeasonPage 的 data
 * @param {object} [opts] seasonName（赛季名，给图上标题）、fallbackName（英雄名兜底）、seasonWindow（{startTime, endTime} 赛季起止秒，用来裁走势点）
 * @returns {object} 卡片直吃的赛季视图：段位/星数/巅峰分/场次/胜率/评分、常用英雄（rankHeros / masterHeros）、分路（branches）、五维（radar）、荣誉（honor）、上分走势（trend），另有 isEmpty 标记整页有没有内容
 */
export function parseSeasonPage (data, { seasonName = '', fallbackName = '', seasonWindow = null } = {}) {
  const body = data && typeof data === 'object' ? data : {}
  const head = body.headCard && typeof body.headCard === 'object' ? body.headCard : {}
  const stats = body.battleStats && typeof body.battleStats === 'object' ? body.battleStats : {}
  const rank = body.behavior?.rankInfo && typeof body.behavior.rankInfo === 'object' ? body.behavior.rankInfo : {}
  const master = body.behavior?.masterInfo && typeof body.behavior.masterInfo === 'object' ? body.behavior.masterInfo : {}

  const heroOf = seasonHeroOf

  const rankHeros = (Array.isArray(rank.heros) ? rank.heros : []).map(heroOf).filter(item => item.name !== '未知英雄')
  const masterHeros = (Array.isArray(master.heros) ? master.heros : []).map(heroOf).filter(item => item.name !== '未知英雄')

  const branches = (Array.isArray(rank.branches) ? rank.branches : [])
    .filter(item => Number(item?.gameCnt) > 0)
    .map(item => ({
      /** 排位分路表现（左那份）：名字走营卡短名，对抗路→对抗 / 发育路→发育 */
      name: laneShortName(toText(item.branchName)) || laneShortLabel(item.branchType),
      count: countText(item.gameCnt),
      /** 营地有的赛季只给 winCnt 不给 winRate，能算就算，算不出来宁可空着也不写 0% */
      winRate: pct(item.winRate) || branchRateOf(item)
    }))

  const games = Number(head.gameCnt) || branches.reduce((sum, item) => sum + (Number(item.count) || 0), 0)
  const winRate = pct(head.winRate)

  /** 分路占比：营地只给场次不给百分比，卡片上的条按「本路场次 / 总场次」自己算 */
  const branchTotal = branches.reduce((sum, item) => sum + (Number(item.count) || 0), 0)
  for (const item of branches) {
    item.percent = branchTotal > 0 ? Math.min(100, Math.round((Number(item.count) || 0) / branchTotal * 100)) : 0
  }

  /** 五维与荣誉都取 `battleStats`：季节页（seasonId = 本赛季那一页）里它本来就是「本赛季」口径的排位数据，
   * 所以营地卡的「排位五维 / 排位荣誉」不用另外换接口，也不做任何换算 —— 这一份就对了。
     巅峰那边没有赛季口径（见 campSeasonBlock 里的说明），保持近 30 天那份，别拿它冒充本赛季。 */
  const dims = [
    ['hurtHero', '输出'],
    ['survive', '生存'],
    ['battle', '团战'],
    ['grow', '发育'],
    ['kda', 'KDA']
  ]

  const radar = dims
    .map(([key, label]) => {
      const value = Number(stats[key]) || 0
      return { label, value, pct: Math.min(100, Math.round(value / 12000 * 100)) }
    })
    .filter(item => item.value > 0)

  const honor = [
    { label: '全场最佳', value: countText(stats.mvp) },
    { label: '败方最佳', value: countText(stats.loseMvp) },
    { label: '三连决胜', value: countText(stats.threeKill) },
    { label: '四连超凡', value: countText(stats.fourKill) },
    { label: '五连绝世', value: countText(stats.fiveKill) },
    { label: '超神', value: countText(stats.godLike) }
  ].filter(item => item.value)

  const star = toText(head.rankingStar)
  const jobName = toText(head.jobName)
  /** 巅峰 1200 是起始分：没打过就别把 1200 当成绩亮出来 */
  const masterScore = Number(head.masterScore) || 0
  const masterGames = Number(master.totalCnt) || 0
  const peakText = masterScore > 0 && (masterScore > 1200 || masterGames > 0) ? String(masterScore) : ''
  const masterWin = Number(master.totalWinCnt) || 0
  const masterRate = pct(master.winRate) || (masterGames > 0 && masterWin > 0 ? pct(masterWin / masterGames) : '')

  return {
    roleName: toText(head.roleName) || fallbackName,
    serverName: toText(head.serverName),
    seasonName: seasonName || toText(body.seasonName),
    rankText: jobName ? (star ? `${jobName} ${star}星` : jobName) : '—',
    /** 排位一组：段位 / 场次 / 胜率 / 平均评分 */
    rankGames: games || 0,
    rankWinRate: winRate || '—',
    rankScore: countText(head.score),
    /** 巅峰一组：积分 / 排名 / 场次 / 胜率 / 平均评分 */
    peakText: peakText || '—',
    peakRank: countText(head.masterRank),
    peakGames: masterGames,
    peakWinRate: masterRate || '—',
    peakScore: countText(master.averageScore),
    /** 老字段留着：其他读取方（探针、旧模板）还在用 */
    score: countText(head.score),
    games: games || 0,
    winRate: winRate || '—',
    rankHeros,
    masterHeros,
    branches,
    radar,
    honor,
    /** 上分走势：只在「本赛季」那一页有，历史赛季营地不给 */
    trend: campTrendOf(rank.gameTrend, seasonWindow || {}),
    isEmpty: !jobName && !rankHeros.length && !masterHeros.length && !radar.length
  }
}

/** ============================================================ 营地卡内嵌：本赛季 */

/**
 * 逐赛季列表（historyList）里第一条就是当前赛季：新的在前，seasonId 跟赛季序号也不是一回事。
 *
 * @param {object} data getSeasonPage（seasonId=0）的 data
 * @returns {object|null} 当前赛季那一条（原对象）；列表为空或没有带 seasonId 的条目时给 null
 */
export function currentSeasonEntry (data) {
  const list = Array.isArray(data?.historyList) ? data.historyList : []
  return list.find(item => item && typeof item === 'object' && toText(item.seasonId) !== '') || null
}

/**
 * 那一页赛季拉不到时，用 historyList 这一条自带的排位 / 巅峰数据拼摘要。
 * 巅峰 1200 是起始分（还没定级），不算成绩，所以只写「—」不留数。
 *
 * @param {object} entry historyList 里的一条（currentSeasonEntry 的结果）
 * @param {object} [opts] fallbackName：角色名兜底
 * @returns {object} 与 parseSeasonPage 同形状的视图，只是分路/五维/荣誉/走势都为空的占位（trend 永远是空数组）；isEmpty 为 true 表示连段位都没拼出来
 */
export function seasonEntryView (entry, { fallbackName = '' } = {}) {
  const rank = entry?.rankInfo && typeof entry.rankInfo === 'object' ? entry.rankInfo : {}
  const master = entry?.masterInfo && typeof entry.masterInfo === 'object' ? entry.masterInfo : {}
  const rankHeros = (Array.isArray(rank.heros) ? rank.heros : []).map(seasonHeroOf).filter(item => item.name !== '未知英雄')
  const masterHeros = (Array.isArray(master.heros) ? master.heros : []).map(seasonHeroOf).filter(item => item.name !== '未知英雄')

  const games = Number(rank.totalCnt) || Number(rank.gameCnt) || 0
  const win = Number(rank.totalWinCnt) || 0
  const masterGames = Number(master.totalCnt) || 0
  const masterScore = Number(master.masterScore) || 0
  const masterWin = Number(master.totalWinCnt) || 0
  const star = toText(rank.rankingStar)
  const jobName = toText(rank.jobName)
  const rate = pct(rank.winRate) || (games > 0 && win > 0 ? pct(win / games) : '')
  const masterRate = pct(master.winRate) || (masterGames > 0 && masterWin > 0 ? pct(masterWin / masterGames) : '')
  const peak = masterGames > 0 && masterScore > 1200 ? String(masterScore) : ''

  return {
    roleName: fallbackName,
    serverName: '',
    seasonName: toText(entry?.seasonName),
    rankText: jobName ? (star ? `${jobName} ${star}星` : jobName) : '—',
    rankGames: games,
    rankWinRate: rate || '—',
    rankScore: countText(rank.averageScore),
    peakText: peak || '—',
    peakRank: '',
    peakGames: masterGames,
    peakWinRate: masterRate || '—',
    peakScore: countText(master.averageScore),
    score: '',
    games,
    winRate: rate || '—',
    rankHeros,
    masterHeros,
    branches: [],
    radar: [],
    honor: [],
    /** 上分走势只有「本赛季那一页」才有；退到列表这一条时只能空着 */
    trend: [],
    isEmpty: !jobName && !rankHeros.length && !masterHeros.length && !games && !peak
  }
}

/**
 * 营地卡里只留「本赛季」的摘要：
 * 段位 / 巅峰 / 场次 / 胜率 / 赛季分 + 三个常用英雄。
 *
 * seasonId=0 那一次的 headCard 是「全部赛季汇总」（历史最高段位 / 巅峰历史最高 / 生涯场次胜率），
 * 不是本赛季。真正的逐赛季数据在 historyList（新的在前），所以先认 historyList[0] 的 seasonId，
 * 再按它拉一次那一页；那一页拉不到就用列表里这一条自带的 rankInfo / masterInfo 拼。
 * 赛季页拿不到（隐藏战绩 / -30408）就退一步只拉常用英雄，总比什么都不给好。
 *
 * @param {object} [target] roleId（角色 ID）、accountId（用哪个登录态）、fallbackName（角色名兜底）
 * @returns {Promise<object|null>} {view（本赛季视图，拼不出来时 null）, hidden（赛季页被拒/被隐藏）, history（historyList 原样，营地卡那张汇总表用它铺）, peakStats（近 30 天巅峰自我数据，没取到 null）, peakBranches（巅峰分路数组，没取到空数组）}；连 historyList 都没拿到时给 null
 */
export async function readCampSeason ({ roleId, accountId, fallbackName = '' } = {}) {
  const opts = { accountId }
  let view = null
  let entry = null
  let hidden = false
  /** 逐赛季列表（新的在前）：营地卡的「赛季数据汇总」表就是拿它铺的，不额外发请求 */
  let history = []

  try {
    const answer = await getSeasonPage({ seasonId: 0, roleId }, opts)
    history = Array.isArray(answer?.data?.historyList) ? answer.data.historyList : []
    entry = currentSeasonEntry(answer?.data)

    if (entry) {
      const seasonId = entry.seasonId
      try {
        const page = await getSeasonPage({ seasonId, roleId }, opts)
        view = parseSeasonPage(page?.data, {
          seasonName: toText(entry.seasonName),
          fallbackName,
          seasonWindow: { startTime: Number(entry.startTime) || 0, endTime: Number(entry.endTime) || 0 }
        })
      } catch {
        /** 这一页不给就退到列表里的数据，别把整张营地卡带崩 */
      }

      const fromEntry = seasonEntryView(entry, { fallbackName })
      if (!view || view.isEmpty) view = fromEntry
      else {
        if (!view.rankText || view.rankText === '—') view.rankText = fromEntry.rankText
        if (!view.peakText || view.peakText === '—') view.peakText = fromEntry.peakText
        if (!view.games) view.games = fromEntry.games
        if (!view.winRate || view.winRate === '—') view.winRate = fromEntry.winRate
        if (!view.rankGames) view.rankGames = fromEntry.rankGames
        if (!view.rankWinRate || view.rankWinRate === '—') view.rankWinRate = fromEntry.rankWinRate
        if (!view.rankScore) view.rankScore = fromEntry.rankScore
        if (!view.peakGames) view.peakGames = fromEntry.peakGames
        if (!view.peakWinRate || view.peakWinRate === '—') view.peakWinRate = fromEntry.peakWinRate
        if (!view.peakScore) view.peakScore = fromEntry.peakScore
        if (!view.rankHeros.length) view.rankHeros = fromEntry.rankHeros
        if (!view.masterHeros.length) view.masterHeros = fromEntry.masterHeros
        if (!view.seasonName) view.seasonName = fromEntry.seasonName
        if (!Array.isArray(view.trend)) view.trend = []
        view.isEmpty = false
      }
    } else {
      /** 没有列表（刚定级 / 老号）只能拿这一页凑合 */
      view = parseSeasonPage(answer?.data, { fallbackName })
    }
  } catch (error) {
    if (!isProfileHiddenCode(error?.code)) throw error
    hidden = true
  }

  if (!view || view.isEmpty) {
    const answer = await getSeasonUsuallyHeroList({ seasonId: entry?.seasonId ?? 0, roleId }, opts)
    const list = Array.isArray(answer?.data) ? answer.data : Array.isArray(answer?.data?.heroList) ? answer.data.heroList : []
    const heros = list.map(seasonHeroOf).filter(item => item.name !== '未知英雄')

    if (view && !view.rankHeros.length) view.rankHeros = heros
    else if (!view) {
      view = {
        roleName: fallbackName,
        serverName: '',
        seasonName: toText(entry?.seasonName),
        rankText: '—',
        rankGames: 0,
        rankWinRate: '—',
        rankScore: '',
        peakText: '—',
        peakRank: '',
        peakGames: 0,
        peakWinRate: '—',
        peakScore: '',
        score: '',
        games: 0,
        winRate: '—',
        rankHeros: heros,
        masterHeros: [],
        branches: [],
        radar: [],
        honor: [],
        trend: [],
        isEmpty: !heros.length
      }
    }
  }

  /** 巅峰的五维与荣誉只有 getfightdata(10) 会给，而且统计口径是「近 30 天」；
   * 季节页那份 battleStats 是排位口径，拿它冒充巅峰会把两件事混成一件，
   * 所以单独再取一次，取不到就 null，卡里巅峰那一段的五维/荣誉整块不画。
   * 只在赛季页真拿到了才去问：赛季页都被拒 / 被隐藏时，排位那块本来就整段不画，
      再去多打一次接口只是白费一次请求，也会拖慢营地卡查不到时的那套换号重查。 */
  const peakStats = view && !view.isEmpty ? await campPeakBattle(roleId, opts) : null
  /** 巅峰分路跟着一起取（自带 30 分钟缓存），失败就是空数组。
   * 但它是 5 次请求（一路一次），所以只为「真会画出巅峰块」的角色花：
     赛季页没巅峰分、近 30 天也一场没打时，分路那几条本来就无处可摆，问了只是白等 6 秒 */
  const hasPeakBlock = Boolean(view && !view.isEmpty && (
    (view.peakText && view.peakText !== '—') ||
    Number(view.peakGames) > 0 ||
    (Number(toText(peakStats?.winNum)) || 0) + (Number(toText(peakStats?.loseNum)) || 0) > 0
  ))
  const peakBranches = hasPeakBlock ? await campPeakBranches(roleId, opts) : []

  if (!view || view.isEmpty) return history.length ? { view: null, hidden, history, peakStats, peakBranches } : null
  return { view, hidden, history, peakStats, peakBranches }
}

/** 近 30 天的巅峰赛自我数据（五维 + 荣誉计数），失败当没有，不打断营地卡 */
async function campPeakBattle (roleId, opts) {
  const id = toText(roleId)
  if (!id) return null
  try {
    const answer = await getFightData({ gameBattleType: 10, branchType: 0, roleId: id }, opts)
    const self = answer?.data?.battleDataSelf
    return self && typeof self === 'object' ? self : null
  } catch (error) {
    log.info(`巅峰近 30 天数据失败：${toText(error?.message) || error}`)
    return null
  }
}

/**
 * 近 30 天巅峰赛的分路表现。
 * 营地只按 branchType 一路一路给，没有「一次拿五路」的接口，所以是 5 次请求；
 * 全局队列一拍 1.2 秒，冷启动大概多花 6 秒，因此这里按角色缓存 30 分钟 —— 同一张卡连着发不会反复打。
 * 任一路失败就当那一路没数据，全失败返回空数组，卡片上这一格不画，不影响别的部分。
 * 场次/胜率口径与排位那份一致：count = winNum + loseNum，胜率优先用接口的 winRate，
 * 没给就用 branchRateOf 自己算；percent 按「本路场次 / 五路总场次」。
 */
const PEAK_BRANCH_TTL_MS = 30 * 60 * 1000
const peakBranchCache = new Map()

async function campPeakBranches (roleId, opts) {
  const id = toText(roleId)
  if (!id) return []
  const hit = peakBranchCache.get(id)
  if (hit && Date.now() - hit.at < PEAK_BRANCH_TTL_MS) return hit.rows

  /** 五路互不相干，一起发出去等：取号层按**账号**节流 1.2 秒，
   * 串行的 5 次就是 5 个节拍、冷启动白等 6 秒；并发之后各走各的拍子，
     池子里只有一个号时请求层自己会把它们排好，不会撞限频。 */
  const answers = await Promise.all([1, 2, 3, 4, 5].map(async branchType => {
    try {
      const answer = await getFightData({ gameBattleType: 10, branchType, roleId: id }, opts)
      const self = answer?.data?.battleDataSelf
      return self && typeof self === 'object' ? { branchType, self } : null
    } catch (error) {
      log.info(`巅峰分路 ${branchType} 取失败：${toText(error?.message) || error}`)
      return null
    }
  }))

  const rows = []
  for (const item of answers) {
    if (!item) continue
    const win = Number(toText(item.self.winNum)) || 0
    const lose = Number(toText(item.self.loseNum)) || 0
    const count = win + lose
    if (count <= 0) continue
    rows.push({
      name: laneShortLabel(item.branchType),
      count: String(count),
      winRate: pct(item.self.winRate) || branchRateOf({ winCnt: win, gameCnt: count })
    })
  }

  const total = rows.reduce((sum, item) => sum + (Number(item.count) || 0), 0)
  for (const item of rows) {
    item.percent = total > 0 ? Math.min(100, Math.round((Number(item.count) || 0) / total * 100)) : 0
  }
  rows.sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))

  /** 全失败（rows 为空）时不写缓存：营地偶发抽风一次就把这张卡的分路锁死半小时不划算，
     下次发指令还会再问；真打过巅峰的号才有得缓存 */
  if (rows.length) peakBranchCache.set(id, { at: Date.now(), rows })
  return rows
}

/** 营地卡「赛季数据汇总」最多摆几个赛季 */
export const CAMP_SEASON_ROWS = 10
export const CAMP_TREND_SEASONS = 12

/**
 * 营地卡「排位走势」看最近多少把：口径是「把」不是「天」，和巅峰走势一样只看一页 30 条，
 * 这一段最多 1 次请求（按天算的 30 天窗口要翻到 6 页 180 条）。
 * 数据源是营地自己的战绩列表（`morebattlelist` 的 `option=1` 排位赛）：每条对局都带
 * `roleJobName / roleJob / stars / dtEventTime`。赛季页那条 `gameTrend` 只当兜底
 * （它是「跨赛季段位快照」，26 天只有 8 个点，还夹着上个赛季，跟 App 对不上）。
 */
export const CAMP_RANK_TREND_GAMES = 30

/** 营地卡「巅峰走势」看最近多少场 —— 两条线同一个口径，都是一页 30 条 */
export const CAMP_PEAK_TREND_GAMES = 30

/**
 * 走势最多画几个点：两条线都是一页 30 条战绩，470 宽的图塞 30 个点，点距已经只剩约 14px，
 * 再多就糊成一片了，所以再加一道点数上限（战绩列表一页也正好 30 条，跟它对得上）。
 */
export const CAMP_TREND_POINTS = 30

/** 走势取数的缓存窗口：同一份数据 10 分钟内再发不重复请求 */
const CAMP_TREND_TTL_MS = 10 * 60 * 1000
const campTrendCache = new Map()

function trendDayLabel (stamp) {
  const at = new Date((Number(stamp) || 0) * 1000)
  const pad = value => String(value).padStart(2, '0')
  return `${at.getMonth() + 1}.${pad(at.getDate())}`
}

/**
 * 排位战绩列表 → 走势点：口径是「最近 30 把」，跟巅峰走势同一个数据源。
 * 列表是新的在前：先按时间倒序取最近 games 把（营地一页正好 30 条），再翻成正序画图；每条对局一个点。
 * 纵轴用「阶梯序号 × 100 + 星数」：同一大段里一颗星就是 1，升一个大段正好
 * 100 的台阶 —— 直接拿星数当纵轴的话，星耀 I 3 星升到王者 0 星会画成掉到 0。
 * 赛季重置 / 换角色（阶梯序号一次退两档以上）只留最后一段，否则图上会出现一条垂直断崖。
 * @param {object[]} list morebattlelist（option=1）的 list，新的在前
 * @param {{games?: number, pointCap?: number}} opts games = 只看最近多少把；pointCap = 图上最多几个点
 * @returns {object[]} 按时间正序的走势点（最多 pointCap 个）：{at, label（月.日）, value（阶梯序号×100 + 星数）, stars, jobName, jobShort, mark}；同一纵轴值的点会被合并，没有有效点给空数组
 */
export function campRankTrendOf (list = [], { games = CAMP_RANK_TREND_GAMES, pointCap = CAMP_TREND_POINTS } = {}) {
  const max = Math.max(2, Number(games) || CAMP_RANK_TREND_GAMES)
  const maxPoints = Math.max(2, Number(pointCap) || CAMP_TREND_POINTS)
  const rows = (Array.isArray(list) ? list : [])
    .filter(item => item && typeof item === 'object')
    /** 先倒序取最近 max 把（接口本来就是倒序，这里再兜一次底），再翻成正序 */
    .sort((a, b) => (Number(b.dtEventTime) || 0) - (Number(a.dtEventTime) || 0))
    .slice(0, max)
    .sort((a, b) => (Number(a.dtEventTime) || 0) - (Number(b.dtEventTime) || 0))

  let start = 0
  for (let index = 1; index < rows.length; index += 1) {
    const prev = rankBandInfo(rows[index - 1]?.roleJobName)
    const next = rankBandInfo(rows[index]?.roleJobName)
    if (prev && next && next.ordinal - prev.ordinal <= -2) start = index
  }

  const draw = []
  for (const item of rows.slice(start)) {
    const jobName = toText(item.roleJobName).trim()
    const info = rankBandInfo(jobName)
    const stars = Number(item.stars) || 0
    const at = Number(item.dtEventTime) || 0
    const value = (info?.ordinal || 0) * 100 + stars
    /** 星数没动的局（勇者积分攒满前、或是别人代打）不单独记点，否则一串平线 */
    if (draw.length && draw[draw.length - 1].value === value) continue
    const jobShort = info ? rankBandShort(jobName) : (jobName.slice(0, 2) || '未知')
    draw.push({ at, label: trendDayLabel(at), value, stars, jobName, jobShort, mark: `${jobShort} ${stars}★` })
  }
  return thin(draw, maxPoints)
}

/**
 * 巅峰战绩列表 → 走势点（同一轮：巅峰取最近 30 把）。
 * 营地 `option=4` 每条带 `oldMasterMatchScore → newMasterMatchScore`，取每把打完的那个分；
 * 一页正好 30 把，就是「最近 30 把」的口径。1200 以下（还没定级）不记；
 * 跨赛季重置（一次掉 300 分以上）只留最后一段，两条线的断线规矩一致。
 * @param {{limit?: number}} opts limit = 最多要几个点
 * @returns {object[]} 按时间正序的巅峰走势点（最多 limit 个）：{at, label（月.日）, value（本把打完的巅峰分）, mark（分数文本）}；1200 以下（未定级）与重复分数的点不记
 */
export function campPeakTrendOf (list = [], { limit = CAMP_PEAK_TREND_GAMES } = {}) {
  const recent = (Array.isArray(list) ? list : [])
    .filter(item => item && typeof item === 'object')
    .slice(0, limit)
    .reverse()

  let start = 0
  for (let index = 1; index < recent.length; index += 1) {
    const prev = Number(recent[index - 1]?.newMasterMatchScore) || 0
    const next = Number(recent[index]?.newMasterMatchScore) || 0
    if (prev > 1200 && next > 1200 && prev - next >= PEAK_RESET_GAP) start = index
  }

  const points = []
  for (const item of recent.slice(start)) {
    const value = Number(item.newMasterMatchScore) || 0
    if (value <= 1200) continue
    const at = Number(item.dtEventTime) || 0
    if (points.length && points[points.length - 1].value === value) continue
    points.push({ at, label: trendDayLabel(at), value, mark: String(value) })
  }
  return points.slice(-limit)
}

/**
 * 营地卡两条走势的取数：两条线同一个口径，各只要一页营地战绩列表 `morebattlelist`：
 * - 排位 `option=1`：一页 30 条排位 = 最近 30 把，每把一个点（`roleJobName + stars`）；
 * - 巅峰 `option=4`：一页 30 条 = 最近 30 把（`newMasterMatchScore`）。
 * 赛季页 `gameTrend`（跨赛季快照，26 天只有 8 个点）与本地归档（要等推送慢慢攒）都凑不出「场」口径，
 * 只当兜底。接口失败就回空数组，卡片侧退回那两条老数据源，别把卡带崩。
 * @param {{roleId?: string, campUserId?: string, accountId?: any}} opts roleId（角色 ID）、campUserId（营地 ID，喂给战绩列表接口）、accountId（用哪个登录态）
 * @returns {Promise<{rank: object[], rankGames: number, peak: object[], peakGames: number, games: number}>} 排位/巅峰两条走势点与各自场数（最多 30），games 是口径（最近多少把）；没有营地 ID 或接口全失败时两条都是空数组
 */
export async function readCampBattleTrend ({ roleId = '', campUserId = '', accountId } = {}) {
  const friendUserId = toText(campUserId)
  if (!friendUserId) {
    return { rank: [], rankGames: 0, peak: [], peakGames: 0, games: CAMP_RANK_TREND_GAMES }
  }

  const key = `${friendUserId}:${toText(roleId)}`
  const hit = campTrendCache.get(key)
  if (hit && Date.now() - hit.at < CAMP_TREND_TTL_MS) return hit.value

  const opts = { accountId }
  /** 排位、巅峰各要一页 30 条，两个请求一起发（限流是按账号排队走的，并发不会破 1.2 秒的规矩） */
  const fetchList = option => getBattleList({ friendUserId, option, lastTime: 0, roleId }, opts)
    .then(answer => (Array.isArray(answer?.data?.list) ? answer.data.list : []))
    .catch(error => {
      log.info(`${option === 1 ? '排位' : '巅峰'}走势取战绩列表失败：${toText(error?.message) || error}`)
      return []
    })
  const [rankList, peakList] = await Promise.all([fetchList(1), fetchList(4)])

  const value = {
    rank: campRankTrendOf(rankList),
    rankGames: Math.min(CAMP_RANK_TREND_GAMES, rankList.length),
    peak: campPeakTrendOf(peakList),
    peakGames: Math.min(CAMP_PEAK_TREND_GAMES, peakList.length),
    games: CAMP_RANK_TREND_GAMES
  }
  /** 两条都空（接口全失败）不写缓存：下次发指令再问一遍，别把空结果锁十分钟 */
  if (value.rank.length || value.peak.length) campTrendCache.set(key, { at: Date.now(), value })
  return value
}

/**
 * 逐赛季汇总表：营地卡下面那张表就是它。
 * 只摆真打过的赛季（场次 0 且没巅峰分的不占一行），新的在前，最多 CAMP_SEASON_ROWS 个。
 * @param {object[]} history getFightData 的 historyList
 * @param {{limit?: number}} opts limit：最多留几个赛季（默认 CAMP_SEASON_ROWS = 10）
 * @returns {object[]} 新的在前的赛季行：{seasonName, seasonTag, jobName（段位全名）, starText, games/wins, winRate/winRateText, gamesText, peakText/peakScoreText, peakGames/peakGamesText, peakWinRateText, star（累计星数）, starNum（当季星数）, isKing（是否上过王者）, maxStreak, avgScore, scoreLabel, isCurrent}；一场没打的赛季不占行，全空给空数组
 */
export function campSeasonRows (history = [], { limit = CAMP_SEASON_ROWS } = {}) {
  const list = Array.isArray(history) ? history.filter(item => item && typeof item === 'object') : []
  const rows = []

  for (const item of list) {
    const row = mapSeasonEntry(item, { mode: '排位' })
    const master = item?.masterInfo && typeof item.masterInfo === 'object' ? item.masterInfo : {}
    const peakValue = Number(master.masterScore) || 0
    const peakText = peakValue > 1200 ? String(peakValue) : ''
    /** 巅峰那一列的场次与胜率：masterInfo 自己带了 totalCnt / winRate，不用另外请求 */
    const peakGames = Number(master.totalCnt) || 0
    const peakWinRate = pct(master.winRate)
    const games = Number(row.games) || 0
    if (!games && !peakText) continue

    rows.push({
      seasonName: row.seasonName,
      seasonTag: row.seasonTag || row.seasonName,
      jobName: row.jobName || (peakText ? '未定级' : '—'),
      starText: row.rankingStar ? `${row.rankingStar} 星` : '',
      games,
      wins: Number(row.wins) || 0,
      winRate: row.winRate || '—',
      peakText,
      dateRange: row.dateRange,
      isCurrent: rows.length === 0,
      /** 表里现在按列对齐，胜率/场次都要数字 + 文本两份 */
      winRateText: row.winRate || '—',
      gamesText: games ? String(games) : '—',
      peakScoreText: peakText || '—',
      /** 巅峰那一列的场次与胜率（没打过巅峰就是 —） */
      peakGames,
      peakGamesText: peakGames ? String(peakGames) : '—',
      peakWinRateText: peakWinRate || '—',
      /** 汇总用：段位总星数（rank.totalRankStar + rankingStar），王者赛季才算「上过王者」 */
      star: Number(row.star) || 0,
      /** 当季星数：走势图纵轴用它，累计星数（star）会把曲线画歪 */
      starNum: Number(row.rankingStar) || 0,
      isKing: /王者/.test(row.jobName || ''),
      maxStreak: row.streak || '',
      avgScore: row.avgScore || '',
      scoreLabel: row.scoreLabel || '平均分'
    })
  }

  return rows.slice(0, Math.max(1, Number(limit) || CAMP_SEASON_ROWS))
}

/**
 * 赛季汇总的四格：最高段位 / 王者赛季 / 生涯场次 / 总胜率。
 * 按全部赛季算，不跟着上面那张表只留 10 行。
 * @param {object[]} history getFightData 的 historyList
 * @returns {object|null} {seasonCount, kingSeasons, totalGames, totalWins, winRate, peakSeasons, peakGames, peakWins, peakWinRate, bestText（最高段位）, bestStar, bestPeak, bestSeasonTag}；一行赛季都没有时给 null
 */
export function campSeasonSummary (history = []) {
  const all = campSeasonRows(history, { limit: 999 })
  if (!all.length) return null

  const games = all.reduce((sum, row) => sum + (Number(row.games) || 0), 0)
  const wins = all.reduce((sum, row) => sum + (Number(row.wins) || 0), 0)
  const best = all.reduce((top, row) => (Number(row.star) || 0) > (Number(top.star) || 0) ? row : top, all[0])

  /** 巅峰侧的合计：
     只统计真打出过巅峰分的赛季，场次与胜场取 masterInfo 那两条自己报的数 */
  const peakRowsAll = all.filter(row => Number(row.peakGames) > 0)
  const peakGames = peakRowsAll.reduce((sum, row) => sum + (Number(row.peakGames) || 0), 0)
  const peakWins = peakRowsAll.reduce((sum, row) => {
    const rate = Number(String(row.peakWinRateText).replace(/[^\d.]/g, ''))
    return sum + (Number.isFinite(rate) && rate > 0 ? Math.round(Number(row.peakGames) * rate / 100) : 0)
  }, 0)

  return {
    seasonCount: all.length,
    kingSeasons: all.filter(row => row.isKing).length,
    totalGames: games,
    totalWins: wins,
    winRate: games > 0 ? `${Math.round(wins / games * 100)}%` : '—',
    peakSeasons: all.filter(row => row.peakText).length,
    peakGames,
    peakWins,
    peakWinRate: peakGames > 0 ? `${Math.round(peakWins / peakGames * 100)}%` : '—',
    bestText: best.jobName || '—',
    bestStar: best.starText || '',
    bestPeak: best.peakText || '—',
    bestSeasonTag: best.seasonTag || ''
  }
}

/**
 * 近 30 天巅峰赛那一份（getfightdata 10）→ 五维 / 荣誉 / 场次胜率。
 * 五维万分制，跟赛季页一样按 12000 折百分比；荣誉只留真出现过的，
 * 一项都没有就整组不画 —— 赛季页那份荣誉是排位打出来的，拿来凑巅峰会误导。
 */
function campPeakViewOf (self) {
  const empty = { games: 0, winRate: '', avgScore: '', radar: [], honors: [] }
  if (!self || typeof self !== 'object') return empty

  const num = key => Number(toText(self[key]).replace(/[^\d.]/g, '')) || 0
  const winNum = num('winNum')
  const loseNum = num('loseNum')
  const games = winNum + loseNum

  const rawRate = toText(self.winRate).trim()
  let winRate = ''
  if (rawRate.includes('%')) winRate = rawRate
  else {
    const rate = Number(rawRate)
    if (Number.isFinite(rate) && rate > 0) winRate = rate <= 1 ? pct(rate) : `${Math.round(rate)}%`
    else if (games > 0) winRate = `${Math.round(winNum / games * 100)}%`
  }

  const dims = [
    ['hurtHero', '输出'],
    ['survive', '生存'],
    ['battle', '团战'],
    ['grow', '发育'],
    ['kda', 'KDA']
  ]
  const radar = dims.map(([key, label]) => {
    const value = num(key)
    return { label, value, pct: Math.min(100, Math.round(value / 12000 * 100)) }
  })

  const honorDefs = { mvp: '全场最佳', loseMvp: '败方最佳', threeKill: '三连决胜', fourKill: '四连超凡', fiveKill: '五连绝世', godLike: '超神' }
  const honors = Object.keys(honorDefs)
    .map(key => ({ key, label: honorDefs[key], value: num(key) }))
    .filter(item => item.value > 0)

  return { games, winNum, loseNum, winRate, avgScore: toText(self.avgScore), radar, honors }
}

/** 中间那段的「排位 / 巅峰」两组格：两边各取自己那份场次、胜率、评分与常用英雄。
 *
 * @param {object} view 赛季页汇总
 * @param {object} peakBattle 近 30 天巅峰那份（`campPeakViewOf` 的结果）
 * @param {boolean} hasRank 这一侧有没有排位数据
 * @param {boolean} hasPeak 这一侧有没有巅峰数据
 * @returns {object[]} 两组（模板按 key 取）
 */
function campSeasonPaneGroups (view, peakBattle, hasRank, hasPeak) {
  const groups = []
  if (hasRank) {
    groups.push({
      key: 'rank',
      label: '排位',
      facts: [
        { label: '段位', value: view.rankText || '—' },
        { label: '场次', value: view.rankGames ? `${view.rankGames} 场` : '—' },
        { label: '胜率', value: view.rankWinRate || '—' },
        { label: '评分', value: view.rankScore || '—' }
      ],
      heroes: view.rankHeros.slice(0, 3)
    })
  }
  if (hasPeak) {
    groups.push({
      key: 'peak',
      label: '巅峰',
      note: '',
      facts: [
        { label: '积分', value: view.peakText || '—' },
        { label: '场次', value: view.peakGames ? `${view.peakGames} 场` : '—' },
        { label: '胜率', value: view.peakWinRate || '—' },
        { label: '评分', value: view.peakScore || '—' }
      ],
      heroes: view.masterHeros.slice(0, 3)
    })
  }
  return groups
}

/** 赛季名压成标题后面那枚小徽章：「S41 赛季」「S45」统一成 `S45`，兜底的「本赛季」不挂。
 *
 * @param {object} view 赛季页汇总
 * @returns {{seasonName: string, seasonTag: string}} 标题用的赛季名与徽章
 */
function campSeasonNameOf (view) {
  const seasonName = view.seasonName || '本赛季'
  const seasonNo = String(seasonName).match(/S\s*(\d+)/i)
  const seasonTag = seasonNo
    ? `S${seasonNo[1]}`
    : (seasonName && seasonName !== '本赛季' ? seasonName : '')

  return { seasonName, seasonTag }
}

/** 「赛季数据汇总」那条走势：按时间从左往右、最多 12 个赛季，纵轴是当季星数，最高的那点转金。
 *
 * @param {object} loaded `readCampSeason` 的返回值
 * @returns {{trendSvg: string, maxStreak: string, seasonTrend: object[]}} 走势图与最长连胜
 */
function campSeasonTrendSvg (loaded) {
  const seasonTrend = campSeasonRows(loaded?.history, { limit: CAMP_TREND_SEASONS })
    .slice()
    .reverse()
  const starPeak = seasonTrend.reduce((max, row) => Math.max(max, Number(row.starNum) || 0), 0)
  const trendSvg = seasonTrend.length >= 3
    ? lineChart(
      seasonTrend.map(row => {
        const star = Number(row.starNum) || 0
        return {
          label: row.seasonTag,
          value: star,
          mark: `${star}`,
          strong: star > 0 && star === starPeak
        }
      }),
      /** 赛季走势现在占整卡宽度（汇总结成一块），所以 viewBox 拉宽到 1000×230；
         线色统一成金色 #c9930a —— 跟上面排位 / 巅峰两条走势一个色系，图上不再两种蓝。 */
      { width: 1000, height: 230, color: '#c9930a', padLeft: 46, padRight: 44, padTop: 40, markAll: true, markAbove: true }
    )
    : ''
  const maxStreak = campSeasonRows(loaded?.history, { limit: 1 })[0]?.maxStreak || ''

  return { trendSvg, maxStreak, seasonTrend }
}

/** 本赛季「排位走势」：优先营地战绩列表的最近 30 把，拿不到才退回赛季页那条跨赛季快照。
 *
 * @param {object[]} rankPoints 接口给的最近 30 把（`campRankTrendOf` 的结果）
 * @param {object} view 赛季页汇总
 * @param {number} chartWidth 图宽（并排 470 / 单边 1000）
 * @returns {object} 走势点、图、首末点与「最高」那一点
 */
function campSeasonRankTrend (rankPoints, view, chartWidth) {
  const rankLive = (Array.isArray(rankPoints) ? rankPoints : []).filter(item => item && Number.isFinite(Number(item.value)))
  const rankSeason = Array.isArray(view.trend) ? view.trend : []
  /** 接口给了就整条用它（就是最近 30 把）；接口没给才退回赛季页那条跨赛季快照 */
  const rankTrend = rankLive.length ? rankLive : rankSeason
  /** 画图只用最近这一段（rankLine，接口给的已经是最近 30 把里抽稀到 30 点的序列）；
   * upBest / bestRankText / peakBest 这些「最高」统计一律走整条赛季序列，
     不能因为只画三十把就把「本赛季最高段位 / 最高巅峰分」算低。 */
  const rankLine = rankLive.length ? rankLive : rankTrend.slice(-CAMP_TREND_POINTS)
  /** 取**最后**一个最高点（>=）：最高星数常常连着两三个点，取第一个会被 lineChart 标在倒数第二个点旁边，
      跟末点标签挤成一团（实测「王者 636★」两层字压在一起） */
  const rankPeakAt = rankLine.reduce((top, item) => (item.value >= (top?.value ?? -1) ? item : top), null)
  const upMarks = rankLine.map((item, index) => {
    const prev = rankLine[index - 1]
    /**
     * 首点、末点、段位变了的那点、以及峰值点写全名（「王者 36★」），其余点只写星数
     * —— 峰值点是唯一会被画成金色的那一点，只写「36★」看不出是哪个段位，所以它一律带段位名
     */
    const showJob = index === 0 || index === rankLine.length - 1 || !prev || prev.jobShort !== item.jobShort || item === rankPeakAt
    return {
      label: item.label,
      value: item.value,
      mark: showJob ? item.mark : `${Number(item.stars) || 0}★`,
      /** 峰值点转金（lineChart 的 strong）；首末点若正好是峰值也一并转金，不重复标 */
      strong: Boolean(rankPeakAt) && item === rankPeakAt
    }
  })
  const upSvg = rankLine.length >= 2
    ? lineChart(upMarks, { width: chartWidth, height: 210, color: '#c9930a', axis: false, padLeft: 34, padRight: 34, padTop: 46, markAll: false, markAbove: true })
    : ''
  const upFirst = rankLine[0] || null
  const upLast = rankLine[rankLine.length - 1] || null
  /** 全量口径：本赛季最高的那一点。两处取大 ——
   * ① 赛季页那条整季序列（营地记的最高点，比头卡准）；② 最近 30 把里最高的那个点。
   * 只信赛季页会出洋相：刚打上去的那几把还没进赛季记录，图上明明爬到 37★，脚注却写「最高 36★」。
     段位名一律用赛季记录那套新命名（走势那套「最强王者 / 无双王者」是营地老口径，不能露脸）。 */
  const topOf = list => list.reduce((top, item) => (item.value >= (top?.value ?? -1) ? item : top), null)
  const seasonTop = topOf(rankSeason)
  const liveTop = topOf(rankLine)
  const upBest = seasonTop && liveTop && Number(liveTop.value) > Number(seasonTop.value)
    ? { ...liveTop, jobName: seasonTop.jobName || liveTop.jobName, jobShort: seasonTop.jobShort || liveTop.jobShort }
    : (seasonTop || liveTop)

  return { rankLive, rankSeason, rankTrend, rankLine, upMarks, upSvg, upFirst, upLast, upBest, seasonTop, liveTop }
}

/** 本赛季「巅峰走势」：营地战绩列表 option=4 一页 30 把，纵轴是打完的那个分，峰点转金。
 *
 * @param {object[]} peakPoints 巅峰分序列
 * @param {number} chartWidth 图宽
 * @returns {object} 走势点、图、首末点与峰点
 */
function campSeasonPeakTrend (peakPoints, chartWidth) {
  const peakLine = (Array.isArray(peakPoints) ? peakPoints : []).filter(item => Number(item?.value) > 1200)
  const peakDraw = peakLine.slice(-CAMP_PEAK_TREND_GAMES)
  /** 同上：取最后一个最高分，避免跟末点标签叠在一起 */
  const peakPeakAt = peakDraw.reduce((top, item) => (item.value >= (top?.value ?? -1) ? item : top), null)
  const peakSvg = peakDraw.length >= 2
    ? lineChart(
      peakDraw.map(item => ({ label: item.label, value: item.value, mark: `${item.value}`, strong: Boolean(peakPeakAt) && item === peakPeakAt })),
      { width: chartWidth, height: 210, color: '#c9930a', axis: false, padLeft: 34, padRight: 34, padTop: 46, markAll: false, markAbove: true }
    )
    : ''
  const peakBestAt = peakLine.reduce((top, item) => (item.value >= (top?.value ?? -1) ? item : top), null)
  const peakFirst = peakDraw[0] || null
  const peakLast = peakDraw[peakDraw.length - 1] || null

  return { peakLine, peakDraw, peakSvg, peakPeakAt, peakBestAt, peakFirst, peakLast }
}

/** 两张走势图下面的副标题与脚注：口径一律「最近 N 把」，上界取 max(接口给的场数, 画出来的点数)。
 *
 * @param {object} parts 需要的上下文（见调用处）
 * @returns {object} 四段文案与「本赛季最高」两个值
 */
function campSeasonBestTexts ({ loaded, view, upBest, rankSeason, peakLine, rankLine, rankTrend, rankLive, rankGames, upFirst, upLast, peakFirst, peakLast, peakWord }) {
  const seasonEntry = (Array.isArray(loaded?.history) ? loaded.history : [])[0] || null
  const entryRank = seasonEntry?.rankInfo && typeof seasonEntry.rankInfo === 'object' ? seasonEntry.rankInfo : {}
  const entryMaster = seasonEntry?.masterInfo && typeof seasonEntry.masterInfo === 'object' ? seasonEntry.masterInfo : {}
  const entryStars = Number(entryRank.rankingStar) || 0
  const entryJobName = toText(entryRank.jobName) || toText(entryRank.shortJobName)
  const trendStars = Number(upBest?.stars) || 0
  const bestStars = Math.max(entryStars, trendStars)
  const bestJobName = bestStars > 0 && bestStars === entryStars && entryJobName
    ? entryJobName
    : (upBest?.jobName || upBest?.jobShort || entryJobName || '')
  const bestRankText = bestStars > 0
    ? `${bestJobName} ${bestStars}星`.trim()
    : (view.rankText && view.rankText !== '—' ? view.rankText : '')

  /** 巅峰最高分：赛季记录（entryMaster.masterScore）、当前头卡、走势点里最大的那个 */
  const peakNow = Number(toText(view.peakText).replace(/[^\d]/g, '')) || 0
  const peakBest = Math.max(
    peakNow,
    Number(entryMaster.masterScore) || 0,
    ...rankSeason.map(item => Number(item.score) || 0),
    ...peakLine.map(item => Number(item.value) || 0)
  )
  const bestPeakText = peakBest > 1200 ? String(peakBest) : ''
  /** 排位那条的副标题：接口给了就写「最近 N 把」，退回老数据源按老口径写「最近 N 场」 */
  const rankGamesCount = Math.max(rankGames || 0, rankLine.length)
  const rankWord = rankLive.length ? `最近 ${rankGamesCount} 把` : `最近 ${rankLine.length} 场`
  const upText = upFirst && upLast
    ? `${upFirst.jobShort} ${upFirst.stars}★ → ${upLast.jobShort} ${upLast.stars}★ · ${rankWord}`
    : ''
  const peakText = peakFirst && peakLast ? `${peakFirst.value} → ${peakLast.value} 分 · ${peakWord}` : ''

  const upNote = rankLive.length
    ? `近 ${rankGamesCount} 把排位赛${rankLine.length < rankTrend.length ? ` · 图中最近 ${rankLine.length} 个点` : ''}${upBest ? ` · 最高 ${upBest.jobShort} ${upBest.stars}★` : ''}`
    : (rankTrend.length
      ? `共 ${rankTrend.length} 次段位/星数变化${rankLine.length < rankTrend.length ? ` · 图中最近 ${rankLine.length} 次` : ''}${upBest ? ` · 最高 ${upBest.jobShort} ${upBest.stars}★` : ''}`
      : '')
  return { bestRankText, bestPeakText, peakNow, peakBest, upText, peakText, upNote, rankGamesCount }
}

/** 巅峰那一栏的专属料：五维、荣誉、赛季表、汇总与脚注（排位那份在 `radarSvg` / `honorRows` / `seasonRows`，互不共用）。
 *
 * @param {object} parts 需要的上下文（见调用处）
 * @returns {object} 巅峰这一栏要的字段
 */
function campSeasonPeakPane ({ peakBattle, loaded, peakNow, bestPeakText, peakGames, peakDraw, peakLine }) {
  const peakGamesCount = peakGames || peakDraw.length
  const peakRadarSvg = peakBattle.radar.some(item => item.value > 0)
    ? radarChart(peakBattle.radar.map(item => ({ label: item.label, value: item.pct })), { width: 380, height: 300, pad: 52 })
    : ''
  const peakSeasonAll = campSeasonRows(loaded?.history, { limit: 999 }).filter(row => row.peakText)
  const peakTopRow = peakSeasonAll.reduce((top, row) => (Number(row.peakText) || 0) > (Number(top?.peakText) || 0) ? row : top, null)
  const peakRows = peakSeasonAll.slice(0, CAMP_SEASON_ROWS).map(row => ({
    seasonTag: row.seasonTag,
    seasonName: row.seasonName,
    peakScoreText: row.peakScoreText,
    isCurrent: row.isCurrent
  }))
  const peakSummary = {
    seasons: peakSeasonAll.length,
    bestText: peakTopRow ? peakTopRow.peakScoreText : (bestPeakText || '—'),
    bestSeasonTag: peakTopRow?.seasonTag || '',
    seasonText: peakNow > 1200 ? String(peakNow) : '—',
    games30: peakBattle.games,
    winRate30: peakBattle.winRate || '—',
    avgScore30: peakBattle.avgScore
  }
  /** 巅峰五维 / 荣誉 / 分路的真实口径还是「近 30 天」：营地没有巅峰赛季口径的接口
   * （getFightData 的 dateType 只有 1=全部 / 2=近30天，0/3/4/5/6 实测全空；seasonpage 的
   * battleStats 是排位数据；masterInfo 只有场次/胜率/评分/分路），所以数据一个数都不换算、
   * 也不编。标题后面不再写口径小字，数据层干脆置空，模板拿到的就是个空串，
     画不出东西也不会漏字。 */
  const peakWindowNote = ''

  const peakNote = peakDraw.length
    ? `近 ${Math.max(peakGamesCount, peakDraw.length)} 把巅峰赛${peakDraw.length < peakLine.length ? ` · 图中最近 ${peakDraw.length} 把` : ''} · 最高 ${peakLine.reduce((max, item) => Math.max(max, item.value), 0)} 分`
    : ''
  return { peakRadarSvg, peakRows, peakSummary, peakWindowNote, peakNote, peakGamesCount }
}

/**
 * 「本赛季表现」整段：排位、巅峰两列并排；只有一边有数据时那一边平铺整卡宽，
 * 两边都没数据时整段不出现。
 *
 * @param {object} loaded 营地卡已取到的数据（用 `view` 与 `peakStats`）
 * @param {object} [options] 走势点与场次
 * @param {Array<object>} [options.rankPoints] 排位星数走势点
 * @param {Array<object>} [options.peakPoints] 巅峰分数走势点
 * @param {number} [options.rankGames] 本赛季排位场次
 * @param {number} [options.peakGames] 本赛季巅峰场次
 * @returns {object|null} 视图段（两列数据 + 走势图）；两边都没数据时 null
 */
export function campSeasonBlock (loaded, { rankPoints = [], peakPoints = [], rankGames = 0, peakGames = 0 } = {}) {
  const view = loaded?.view
  if (!view) return null

  const hasRank = Boolean(view.rankText && view.rankText !== '—') || Number(view.rankGames) > 0
  /** 巅峰那一块只要有「本赛季积分」或「近 30 天打过」就画：有人赛季页没积分但 30 天内刚打过，
     那一块的走势/五维/荣誉照样有内容可摆 */
  const peakBattle = campPeakViewOf(loaded?.peakStats)
  const hasPeak = Boolean(view.peakText && view.peakText !== '—') || Number(view.peakGames) > 0 || peakBattle.games > 0
  if (!hasRank && !hasPeak) return null

  /** 只有一边有数据时，这一边平铺整卡宽：排位独有就铺排位，巅峰独有就铺巅峰，两边都没有则整段不显示。
   * 两边都有才左右并排；只有一个时模板给 .k-camp-pairs 挂 is-single，只剩一栏、占满整宽。
   * 两张走势图的 viewBox 也跟着从半栏的 470 拉到整栏的 1000 —— 图是在 CSS 里 width:100% 撑开的，
     viewBox 还是 470 的话会被放大 2.1 倍，点标那 15px 的字会变成 32px 糊一片。 */
  const singlePane = hasRank && hasPeak ? '' : (hasRank ? 'rank' : 'peak')
  const chartWidth = singlePane ? 1000 : 470

  const { seasonName, seasonTag } = campSeasonNameOf(view)
  const groups = campSeasonPaneGroups(view, peakBattle, hasRank, hasPeak)
  const branches = (Array.isArray(view.branches) ? view.branches : []).slice(0, 5)
  const radarRows = Array.isArray(view.radar) ? view.radar : []

  const { trendSvg, maxStreak } = campSeasonTrendSvg(loaded)
  const { rankLive, rankSeason, rankTrend, rankLine, upSvg, upFirst, upLast, upBest } = campSeasonRankTrend(rankPoints, view, chartWidth)
  const { peakLine, peakDraw, peakSvg, peakPeakAt, peakFirst, peakLast } = campSeasonPeakTrend(peakPoints, chartWidth)

  /** 副标题的场数口径：接口给了就写「最近 N 把」，退回老数据源就写「最近 N 场」 */
  const peakWord = peakGames ? `最近 ${peakGames} 把` : `最近 ${peakDraw.length} 场`
  const { bestRankText, bestPeakText, peakNow, upText, peakText, upNote } = campSeasonBestTexts({
    loaded,
    view,
    upBest,
    rankSeason,
    peakLine,
    rankLine,
    rankTrend,
    rankLive,
    rankGames,
    upFirst,
    upLast,
    peakFirst,
    peakLast,
    peakWord
  })
  const { peakRadarSvg, peakRows, peakSummary, peakWindowNote, peakNote } = campSeasonPeakPane({
    peakBattle,
    loaded,
    peakNow,
    bestPeakText,
    peakGames,
    peakDraw,
    peakLine
  })

  return {
    seasonName,
    seasonTag,
    hiddenNote: loaded.hidden ? '赛季页被隐藏，这里只有常用英雄' : '',
    groups,
    /** 两块各取自己那份：模板按「有没有」决定画不画，不再靠 groups.length 猜 */
    rankGroup: groups.find(item => item.key === 'rank') || null,
    peakGroup: groups.find(item => item.key === 'peak') || null,
    /** '' = 左右并排（两边都有）/ 'rank' = 只剩排位、平铺整宽 / 'peak' = 只剩巅峰、平铺整宽。
       模板拿这个挂 .k-camp-pairs.is-single，并且把空的那半边整段不画，不留空栏。 */
    singlePane,
    /** 巅峰五维 / 荣誉 / 赛季表（排位那份在 radarSvg / honorRows / seasonRows 里，互不共用） */
    peakRadarSvg,
    peakHonorRows: peakBattle.honors,
    /** 近 30 天巅峰赛的分路表现（左排位那份在 branches 里，两份不共用） */
    peakBranches: Array.isArray(loaded?.peakBranches) ? loaded.peakBranches : [],
    peakWindowNote,
    peakRows,
    peakSummary,
    maxStreak,
    trendSvg,
    /** 本赛季排位走势（营地战绩列表 option=1 的最近 30 把）：点不够就不画 */
    upSvg,
    upText,
    /** 本赛季巅峰走势（营地战绩列表 option=4）：点不够就不画 */
    peakSvg,
    peakText,
    /** 两栏脚注同一套写法：全量算「近多少把 / 最高多少」，只有真被截断时才写「图中最近 N 把」 */
    peakNote,
    peakBestText: peakPeakAt ? String(peakPeakAt.value) : '',
    /** 中间四格用的「本赛季最高」两个值 + 本赛季段位（没走势时的兜底） */
    bestRankText,
    bestPeakText,
    seasonRankText: view.rankText && view.rankText !== '—' ? view.rankText : '',
    seasonPeakText: peakNow > 1200 ? String(peakNow) : '',
    upNote,
    upPoints: rankTrend.length,
    /** 荣誉：老赛季卡里那六项（全场最佳 / 败方最佳 / 三连 / 四连 / 五连 / 超神）全部摆出来 */
    honorRows: Array.isArray(view.honor) ? view.honor : [],
    honorText: view.honor.slice(0, 3).map(item => `${item.label} ${item.value}`).join(' · '),
    /** 五维（本赛季排位，万分制折成百分比）+ 分路占比：都在赛季页那一格里 */
    radarSvg: radarRows.length ? radarChart(radarRows.map(item => ({ label: item.label, value: item.pct })), { width: 380, height: 300, pad: 52 }) : '',
    radarMax: radarRows.reduce((max, item) => Math.max(max, Number(item.pct) || 0), 0),
    branches
  }
}

/** ============================================================ 英雄梯度榜 */

/**
 * 营地梯度榜 → 卡片结构：按 T0-T3 分组，组内保持营地给的顺序。
 *
 * @param {object|object[]} data getDetailRankList 的 data（也认直接给数组）
 * @returns {{total: number, groups: Array<{tier: string, rows: object[]}>, updateTime: string}} total：英雄总数；groups：只保留有英雄的档位，每组最多 TIER_MAX 个，行是 {name, sub（职业/副名）, icon, winRate, showRate, banRate}；updateTime：榜单更新时间
 */
export function parseTierList (data) {
  const list = Array.isArray(data?.list) ? data.list : Array.isArray(data) ? data : []

  const groups = new Map()
  for (const raw of list) {
    const info = raw?.heroInfo && typeof raw.heroInfo === 'object' ? raw.heroInfo : {}
    const rawName = toText(info.heroName ?? raw?.heroName)
    const { name, sub } = heroTextOf(rawName)
    const tier = TIER_ORDER.includes(toText(raw?.tRank)) ? toText(raw.tRank) : 'T3'

    const rows = groups.get(tier) || []
    rows.push({
      name: name || '未知英雄',
      sub: toText(info.heroCareer) || sub,
      icon: heroIconByName(rawName, toText(info.heroIcon ?? raw?.heroIcon)),
      winRate: pct(raw?.winRate),
      showRate: pct(raw?.showRate),
      banRate: pct(raw?.banRate)
    })
    groups.set(tier, rows)
  }

  const order = TIER_ORDER.filter(tier => groups.get(tier)?.length)
  return {
    total: list.length,
    groups: order.map(tier => ({ tier, rows: groups.get(tier).slice(0, TIER_MAX) })),
    updateTime: timeText(data?.updateTime)
  }
}

/**
 * 指令「王者梯度榜 [段位词] [分路词]」：出英雄梯度榜卡片。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<*>} 出图结果；营地没给数据、或取数失败时回一句话
 */
export async function kingTier (e) {
  if (!(await kingGuard(e))) return

  try {
    const text = tailOf(e, /^#?王者(荣耀)?(英雄)?(梯度|强度)/)
    const { segment, position } = parseTierFilter(text)
    const answer = await getDetailRankList({ segment, position })
    const view = parseTierList(answer?.data)

    if (!view.groups.length) return kingReply(e, '营地这次没给梯度榜数据，过一会儿再试')

    return renderKing(e, 'tier', {
      title: '英雄梯度榜',
      logoSrc: logoUri(),
      segmentLabel: SEGMENT_LABEL[segment] || '巅峰赛1350+',
      positionLabel: POSITION_LABEL[position] || '全部分路',
      updateTime: view.updateTime,
      heroCount: view.total,
      groups: view.groups,
      note: '数据跟着营地实时变。加「中单」只看中路。'
    })
  } catch (error) {
    return kingFail(e, error, '梯度榜没拿到，晚点再试')
  }
}

/** ============================================================ 出装与铭文 */

function pickList (data, keys) {
  for (const key of keys) {
    const list = data?.[key]
    if (Array.isArray(list) && list.length) return list
  }
  return []
}

/**
 * 营地出装 + 铭文 → 卡片结构。两处铭文来源都认（现在的 RuneSetList[].runeList 与早期的平铺列表），
 * 有 RuneSetList 就用它；装备名在营地这份数据里放在 szTitle（szCate 是分类）。
 *
 * @param {object} equip 出装接口的 data（equipList / bestEquip / list 等几种键都认）
 * @param {object} fringe 铭文接口的 data（RuneSetList / fringeList 等几种键都认）
 * @returns {{gears: object[], rings: object[], ringRate: string, tip: string}} gears：{id,name,cat（分类）,win（胜率文本）,icon}，最多 EQUIP_MAX 件；rings：{id,name（已去掉「5级铭文:」前缀）,count,icon}，最多 RING_MAX 条；ringRate：第一套铭文的胜率；tip：出装提示
 */
export function parseEquipData (equip, fringe) {
  const gear = pickList(equip, ['equipList', 'equips', 'bestEquip', 'list', 'equipInfo', 'recommendList'])
  /**
   * 铭文两处来源：营地现在把官方推荐铭文放在 `RuneSetList[].runeList`
   * （`getherofringedata` 返回，第一套是出场率最高的那套）；早期结构是平铺的 fringeList/mingList。
   * 两套都认，有 RuneSetList 就用它 —— 「#王者英雄 李白」出装铭文并卡后才看得见这几行。
   */
  const runeSets = pickList(fringe, ['RuneSetList', 'runeSetList', 'runeSets'])
  const ringRaw = (() => {
    const flat = pickList(fringe, ['fringeList', 'mingList', 'mingwenList', 'list', 'fringeInfo', 'recommendList'])
    if (flat.length) return flat
    const first = runeSets[0]?.runeList
    return Array.isArray(first) ? first : []
  })()

  const mapGear = raw => ({
    id: toText(raw?.equipId ?? raw?.itemId ?? raw?.id),
    /** 营地这份「英雄工具」里，装备名放在 szTitle（szCate 是攻击/打野这类分类） */
    name: toText(raw?.szTitle ?? raw?.equipName ?? raw?.itemName ?? raw?.name ?? raw?.title),
    cat: toText(raw?.szCate),
    win: raw?.winRate ? `${Math.round(Number(raw.winRate) * 1000) / 10}%` : '',
    icon: gearUri('equip', raw?.equipId ?? raw?.itemId ?? raw?.id, toText(raw?.icon ?? raw?.iconUrl ?? raw?.equipIcon))
  })

  const mapRing = raw => ({
    id: toText(raw?.runeId ?? raw?.fringeId ?? raw?.mingId ?? raw?.id),
    /** 「5级铭文:异变」只留「异变」，级别与颜色对用户没用 */
    name: toText(raw?.szTitle ?? raw?.fringeName ?? raw?.mingName ?? raw?.name ?? raw?.title)
      .replace(/^\d+级铭文\s*[:：]?\s*/u, ''),
    count: countText(raw?.num ?? raw?.count ?? raw?.packageNum),
    icon: toText(raw?.szIcon) || gearUri('equip', raw?.runeId ?? raw?.fringeId ?? raw?.mingId ?? raw?.id, toText(raw?.icon ?? raw?.iconUrl))
  })

  return {
    gears: gear.map(mapGear).filter(item => item.name || item.icon).slice(0, EQUIP_MAX),
    rings: ringRaw.map(mapRing).filter(item => item.name || item.icon).slice(0, RING_MAX),
    /** 铭文套的胜率/出场率（营地给的整行数据，模板右上角用得上） */
    ringRate: toText(runeSets[0]?.winRate ? `${Math.round(Number(runeSets[0].winRate) * 1000) / 10}%` : ''),
    tip: toText(equip?.tip ?? equip?.tips ?? equip?.desc)
  }
}

/** ============================================================ 英雄战绩 */

/**
 * 英雄战绩详情 → 卡片结构（五维、战力、最近几场）。
 *
 * @param {object} data getHeroRecordDetail 的 data
 * @param {object} [opts] fallbackName：英雄名兜底（接口没给 SzTitle 时用）
 * @returns {object} {heroName, alias（称号）, heroType, branch（分路）, skilled, total（总场次）, win, lose, winRate, best（最高连胜/最佳）, maxWin（最长连胜）, power（最新战力文本，没有给空串）, radar（五维，值为 0 的维度已剔掉）, radarSvg（雷达图 SVG，维度不足 3 个为空串）, recent（最近 HERO_RECORD_ROWS 场：{mapName,time,win,kill,dead,assist,mvp,svp,grade}）, isEmpty（一场没打）}
 */
export function parseHeroRecord (data, { fallbackName = '' } = {}) {
  const info = data?.heroInfo && typeof data.heroInfo === 'object' ? data.heroInfo : {}
  const win = Number(info.winNum) || 0
  const lose = Number(info.failNum) || 0
  const total = win + lose

  const dims = [
    ['hurhero', '输出'],
    ['survive', '生存'],
    ['kda', 'KDA'],
    ['battle', '团战'],
    ['grow', '发育']
  ]

  const radar = dims.map(([key, label]) => {
    const value = Math.max(0, Math.min(100, Number(data?.avgPerformance?.[key]) || 0))
    return { label, value, pct: value }
  }).filter(item => item.value > 0)

  const powerList = Array.isArray(data?.powerData) ? data.powerData : []
  const lastPower = powerList.length ? Number(powerList[powerList.length - 1]?.value) || 0 : 0

  const recent = (Array.isArray(data?.zjList) ? data.zjList : []).slice(0, HERO_RECORD_ROWS).map(raw => ({
    mapName: toText(raw?.mapName),
    time: toText(raw?.gametime),
    win: Number(raw?.gameresult) === 1,
    kill: Number(raw?.killcnt) || 0,
    dead: Number(raw?.deadcnt) || 0,
    assist: Number(raw?.assistcnt) || 0,
    mvp: Number(raw?.mvpcnt) > 0,
    svp: Number(raw?.losemvp) > 0,
    grade: toText(raw?.grade)
  }))

  return {
    heroName: toText(info.SzTitle) || fallbackName,
    alias: toText(info.SzAlias),
    heroType: toText(info.SzHeroType),
    branch: toText(info.SzBranchRoad),
    skilled: toText(info.skilledTitle),
    total,
    win,
    lose,
    winRate: total ? `${(win / total * 100).toFixed(1)}%` : '—',
    best: Number(info.bestCount) || 0,
    maxWin: Number(info.maxContinuousWinCnt) || 0,
    power: lastPower > 0 ? String(lastPower) : '',
    radar,
    radarSvg: radarChart(radar),
    recent,
    isEmpty: !total
  }
}

/**
 * 五维数据画成雷达图（SVG 字符串，直接内联进 hero-record.html）。
 * 维度少于 3 个画不成多边形，返回空串，模板那边退回到横条。
 *
 * @param {Array<{label: string, value: number}>} [radar] 各维度的名字与分值（0-100，超出会夹到边界）
 * @param {object} [opts] 画布与留白：width/height（像素，默认 440×400）、pad（四周留给文字的像素，默认 80）
 * @returns {string} 一整段 <svg>…</svg>；有效维度不足 3 个时给空串
 */
export function radarChart (radar = [], { width = 440, height = 400, pad = 80 } = {}) {
  const items = (Array.isArray(radar) ? radar : [])
    .map(item => ({
      label: toText(item?.label).trim(),
      value: Math.max(0, Math.min(100, Number(item?.value) || 0))
    }))
    .filter(item => item.label)

  if (items.length < 3) return ''

  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) / 2 - pad
  const labelR = radius + 28
  const step = (Math.PI * 2) / items.length
  const round = n => Number(n.toFixed(1))
  const point = (index, ratio) => {
    const angle = -Math.PI / 2 + step * index
    return [round(cx + Math.cos(angle) * radius * ratio), round(cy + Math.sin(angle) * radius * ratio)]
  }
  const xy = (index, ratio) => point(index, ratio).join(',')

  const rings = [0.25, 0.5, 0.75, 1]
    .map(ratio => `<polygon points="${items.map((_, index) => xy(index, ratio)).join(' ')}" fill="none" stroke="rgba(74,144,217,0.20)" stroke-width="1.5"/>`)
    .join('')
  const axes = items
    .map((_, index) => {
      const [x, y] = point(index, 1)
      return `<line x1="${round(cx)}" y1="${round(cy)}" x2="${x}" y2="${y}" stroke="rgba(74,144,217,0.24)" stroke-width="1.5"/>`
    })
    .join('')
  const area = `<polygon points="${items.map((item, index) => xy(index, item.value / 100)).join(' ')}" fill="rgba(59,130,246,0.28)" stroke="#3b82f6" stroke-width="2.5" stroke-linejoin="round"/>`
  const dots = items
    .map((item, index) => {
      const [x, y] = point(index, item.value / 100)
      return `<circle cx="${x}" cy="${y}" r="4.5" fill="#3b82f6" stroke="#ffffff" stroke-width="2"/>`
    })
    .join('')
  const labels = items
    .map((item, index) => {
      const [x, y] = point(index, labelR / radius)
      const anchor = x > cx + 4 ? 'start' : (x < cx - 4 ? 'end' : 'middle')
      const dy = y < cy - 12 ? -4 : (y > cy + 12 ? 20 : 6)
      return `<text x="${x}" y="${round(y + dy)}" text-anchor="${anchor}" font-size="17" fill="#33517a"><tspan font-weight="700">${escapeXml(item.label)}</tspan> ${item.value}</text>`
    })
    .join('')

  return `<svg class="k-radar-svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img">${rings}${axes}${area}${dots}${labels}</svg>`
}

/**
 * 指令「王者英雄战绩 <英雄名>」：出单个英雄的战绩卡（五维 + 战力 + 最近几场）。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<*>} 出图结果；没带英雄名、没绑定、没登录态、找不到英雄、这个号没打过时各回一句话
 */
export async function kingHeroRecord (e) {
  if (!(await kingGuard(e))) return

  try {
    const keyword = tailOf(e, /^#?王者(荣耀)?英雄战绩/)
    if (!keyword) return kingReply(e, '发「#王者英雄战绩 李白」这样，后面带英雄名')

    const { bind, account, error } = await bindTarget(e)
    if (error === 'bind') return kingReply(e, '先把营地角色绑上：「#王者绑定 <营地ID>」')
    if (error === 'auth') return kingReply(e, '还没有可用的营地登录：发「#王者QQ扫码」扫一个')

    const heroes = await fetchHeroTable()
    const hero = matchHeroKeyword(heroes, keyword)
    if (!hero) return kingReply(e, `没找到英雄「${keyword}」，名字写全一点试试`)

    /** 这个接口要的是角色 roleId（不是营地 ID），服务端还必须带 serverId 头 */
    const answer = await getHeroRecordDetail({
      roleId: bind.roleId,
      heroId: hero.ename,
      heroName: hero.name,
      serverId: toText(bind.serverId)
    }, { accountId: account.id })

    const view = parseHeroRecord(answer?.data, { fallbackName: hero.name })
    if (view.isEmpty) return kingReply(e, `这个号还没用 ${hero.name} 打过，换个英雄试试`)

    return renderKing(e, 'hero-record', {
      title: '英雄战绩',
      logoSrc: logoUri(),
      heroIcon: heroIconUri(hero.ename, hero.avatar),
      ownerText: ownerTextOf(e, bind.owner || ''),
      ...view,
      note: '算的是全部场次，不是最近 100 场。称号和战力跟着绑定角色。'
    })
  } catch (error) {
    return kingFail(e, error, '英雄战绩没拿到，晚点再试')
  }
}

/**
 * 图鉴/赛季这一组对外露出的指令入口（插件注册指令表时按这个取）。
 * @type {{kingTier: Function, kingHeroRecord: Function}}
 */
export default {
  kingTier,
  kingHeroRecord
}
