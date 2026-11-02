/**
 * @file Trend模块的一片实现。
 *
 * @module models/Trend/View
 */
import { toText } from '../Common.js'

import { ARCHIVE_KEEP_DAYS, getArchiveRange } from '../Archive.js'

import { logoUri } from '../Card.js'
import { ownerTextOf } from '../Context.js'
import { toInt } from '#yiyi.utils'
import { shortDay } from './Util.js'

/**
 * 趋势卡的地基：标题、副标题、点数、空态都从这里出
 *
 * @param {*} args 解析好的参数
 * @param {*} points 取好点的数组
 * @returns {object} 视图对象
 */
export function baseView ({ isPeak, days, pile, ctx }) {
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
    RankName: '',
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
    HeroRows: [],
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

