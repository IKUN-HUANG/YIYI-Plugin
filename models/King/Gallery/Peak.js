/**
 * @file 巅峰赛近 30 天的自我数据与各分路表现（带缓存，降级只记 info）。
 *
 * @module models/King/Gallery/peak
 */
import { createLogger } from '#yiyi.utils'
import { getFightData } from '../Api.js'
import { toText } from '../Common.js'
import { PEAK_BRANCH_TTL_MS, PeakBranchCache } from './Consts.js'
import { BranchRateOf, laneShortLabel, pct } from './Util.js'

/** 这一片的日志出口（前缀与图鉴统一） */
const log = createLogger('王者图鉴')

/**
 * 近 30 天的巅峰赛自我数据（五维 + 荣誉计数），失败当没有，不打断营地卡
 *
 * @param {string} roleId 角色 ID
 * @param {object} opts 请求选项（至少带 accountId）
 * @returns {Promise<object|null>} 自我数据；没取到给 null
 */
export async function campPeakBattle (roleId, opts) {
  const id = toText(roleId)
  if (!id) return null
  try {
    const answer = await getFightData({ gameBattleType: 10, BranchType: 0, roleId: id }, opts)
    const self = answer?.data?.battleDataSelf
    return self && typeof self === 'object' ? self : null
  } catch (error) {
    log.info(`巅峰近 30 天数据失败：${toText(error?.message) || error}`)
    return null
  }
}

/**
 * 巅峰赛五路各自的表现（并发取，缓存 2 小时）
 *
 * @param {string} roleId 角色 ID
 * @param {object} opts 请求选项（至少带 accountId）
 * @returns {Promise<Array<object>>} 分路数组；一个都没取到给空数组
 */
export async function campPeakBranches (roleId, opts) {
  const id = toText(roleId)
  if (!id) return []
  const hit = PeakBranchCache.get(id)
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
      winRate: pct(item.self.winRate) || BranchRateOf({ winCnt: win, gameCnt: count })
    })
  }

  const total = rows.reduce((sum, item) => sum + (Number(item.count) || 0), 0)
  for (const item of rows) {
    item.percent = total > 0 ? Math.min(100, Math.round((Number(item.count) || 0) / total * 100)) : 0
  }
  rows.sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))

  /** 全失败（rows 为空）时不写缓存：营地偶发抽风一次就把这张卡的分路锁死半小时不划算，
     下次发指令还会再问；真打过巅峰的号才有得缓存 */
  if (rows.length) PeakBranchCache.set(id, { at: Date.now(), rows })
  return rows
}

