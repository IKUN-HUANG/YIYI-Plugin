/**
 * @file 排行榜的文案与成行：一行怎么拼、查不到时怎么说，都在这里。
 *
 * @module models/King/Rank/Text
 */
import { toText, isProfileHiddenCode } from '../Common.js'
import { cleanName, normalizeName } from '../Profile.js'
import { skipPlaceholder } from './Targets.js'

/**
 * 「没拿到榜单数据」这句话怎么说：不报营地返回码，只给结论 + 最常见的原因
 * （对方把战绩藏起来了 / 营地这会儿抽风）。
 *
 * @param {object} result 营地响应（只看 `code`）
 * @returns {string} 一句给人看的说明，永远不返回空串
 */
export function RankFailText (result) {
  const code = Number(result?.code)
  if (Number.isFinite(code) && code !== 0) {
    return isProfileHiddenCode(result)
      ? '营地这次没给数据，多半是对方把战绩藏起来了'
      : '营地这次没给数据'
  }
  return '营地这次没给数据'
}

/**
 * 把一条排行的目标与快照记录排成卡片上的一行
 *
 * @param {object} target 排行目标
 * @param {object} record 快照里这一位的记录
 * @param {object} [Flags] `{stale, hidden, failed, reason}`
 * @returns {object} 行对象
 */
export function buildRow (target, record, { stale = false, hidden = false, failed = false, reason = '' } = {}) {
  const roleId = toText(target.roleId)

  return {
    roleId,
    /**
     * 快照里可能躺着上一版写进去的「无名召唤师」（占位符），它不该盖掉绑定里记着的真名。
     */
    name: normalizeName(skipPlaceholder(record?.roleName) || target.roleName),
    qq: (target.qq || []).map(item => toText(item)).join('、'),
    campId: toText(roleId),
    roleIcon: toText(record?.roleIcon),
    RankName: cleanName(record?.RankName),
    RankStar: Number(record?.RankStar) || 0,
    RankScore: Number(record?.RankScore) || 0,
    PeakScore: Number(record?.PeakScore) || 0,
    PeakDesc: cleanName(record?.PeakDesc),
    at: Number(record?.at) || 0,
    stale,
    hidden,
    failed,
    reason: toText(reason)
  }
}

