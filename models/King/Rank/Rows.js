/**
 * @file 排行榜的成行：把每个目标的取数结果摊成一张表的行，负责缓存、隐藏与失败标记。
 *
 * @module models/King/Rank/Rows
 */
import { toText, maskUserId, isProfileHiddenCode, describeError } from '../Common.js'
import { getProfile } from '../Api.js'
import { campQueryOf, accountsOwningRole } from '../Auth.js'
import { kingLog } from '../Say.js'
import { RANK_HIDDEN_TTL, RANK_SNAPSHOT_TTL } from './Consts.js'
import { hasRankPayload, loadSnapshot, saveSnapshot } from './Snapshot.js'
import { extractRankInfo } from './Sort.js'
import { RankAccountList } from './Targets.js'
import { buildRow, RankFailText } from './Text.js'

/**
 * 查一批角色的段位榜数据：先用快照里没过期的，过期的现去营地查，查完把整份快照落盘。
 * 被营地判定「战绩隐藏」的角色会记下时间戳，24 小时内不再白试一遍；
 * 查不到的角色不踢出榜，而是带着「旧数据 + 失败原因」照旧给一行，卡片上看得出来是旧的。
 *
 * @param {object} [options] 可选参数
 * @param {Array<object>} [options.targets] 要查的角色（`expandRankTargets` 出来的）
 * @param {boolean} [options.force=false] 忽略快照、全部重查（「#王者排行榜刷新」走这条）
 * @returns {Promise<object>} `{rows, fetched, failed, hidden, at}`：
 *   rows 是给卡片的行，fetched/failed/hidden 分别是新查到 / 失败 / 战绩隐藏的个数，at 是这次的时间戳
 */
export async function collectRankRows ({ targets = [], force = false } = {}) {
  const snapshot = loadSnapshot()
  const now = Date.now()
  const rows = []
  let fetched = 0
  let failed = 0
  let hidden = 0

  for (const target of targets) {
    const roleId = toText(target.roleId)
    if (!roleId) continue

    const saved = snapshot.rows[roleId]
    const hiddenAt = Number(snapshot.hidden[roleId]) || 0
    const fresh = hasRankPayload(saved) && now - Number(saved?.at || 0) < RANK_SNAPSHOT_TTL
    const hiddenRecent = hiddenAt > 0 && now - hiddenAt < RANK_HIDDEN_TTL

    if (!force && (fresh || hiddenRecent)) {
      if (hiddenRecent) hidden += 1
      rows.push(buildRow(target, saved, { stale: !fresh, hidden: hiddenRecent }))
      continue
    }

    const accounts = RankAccountList(target)
    if (!accounts.length) {
      failed += 1
      rows.push(buildRow(target, saved, { stale: true, failed: true, reason: 'no-auth' }))
      continue
    }

    let done = false
    let sawHidden = false
    let reason = ''
    const qq = toText(target.qq?.[0]) || toText(target.byUser)
    const query = campQueryOf(roleId, qq)
    const owners = accountsOwningRole(roleId, qq)

    for (const account of accounts) {
      const who = maskUserId(account.id)

      try {
        const result = await getProfile(query.campUserId, { accountId: account.id, targetRoleId: query.roleId })

        if (isProfileHiddenCode(result)) {
          sawHidden = true
          reason = RankFailText(result)
          if (!owners.length || owners.includes(toText(account.id))) {
            break
          }
          kingLog.warn(`排行榜查 ${maskUserId(roleId)} 用 ${who} 的登录信息被营地拒了（${reason}），换这个角色自己的号再试`)
          continue
        }

        const record = { at: now, ...extractRankInfo(result) }

        if (hasRankPayload(record)) {
          snapshot.rows[roleId] = record
          delete snapshot.hidden[roleId]
          fetched += 1
          rows.push(buildRow(target, record))
          done = true
          break
        }

        reason = RankFailText(result)
        kingLog.warn(`排行榜查 ${maskUserId(roleId)} 没拿到段位数据（${who}）：${reason}`)
      } catch (error) {
        reason = toText(error?.message) || describeError(error)
        kingLog.warn(`排行榜查询失败 ${maskUserId(roleId)}（${who}）：${reason}`)
      }
    }

    if (!done && sawHidden) {
      snapshot.hidden[roleId] = now
      hidden += 1
      rows.push(buildRow(target, saved, { stale: true, hidden: true }))
      continue
    }

    if (!done) {
      failed += 1
      rows.push(buildRow(target, saved, { stale: true, failed: true, reason: reason || '这次没查到' }))
    }
  }

  snapshot.updatedAt = now
  saveSnapshot(snapshot)

  return { rows, fetched, failed, hidden, at: now }
}

