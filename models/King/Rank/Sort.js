/**
 * @file Rank模块的一片实现。
 *
 * @module models/rank/Sort
 */
import { cleanName, parseModParam } from '../Profile.js'
import { toText } from '../Common.js'
import { KING_WEIGHT, RANK_MOD_PEAK, RANK_MOD_RANK, ROMAN_OF, TIER_WEIGHT } from './Consts.js'


/**
 * 段位名 + 星数 → 一个能直接比大小的排序权重。
 * 口径：王者固定压在所有大段之上（KING_WEIGHT），其它大段按 TIER_WEIGHT 排，
 * 同一大段里 I 比 II 高，最后再加上星数。认不出来的段位名只按星数算，
 * 所以「段位名空着」就是 0，排最后。
 *
 * @param {*} RankName 营地给的段位名（如「至尊星耀III」「最强王者」）
 * @param {number} [RankStar=0] 这个段位上的星数
 * @returns {number} 权重，越大越靠前；段位名洗完为空给 0
 */
export function calcRankSort (RankName, RankStar = 0) {
  const name = cleanName(RankName)
  const star = Math.max(0, Number(RankStar) || 0)
  if (!name) return 0

  let weight = name.includes('王者') ? KING_WEIGHT : 0
  if (!weight) {
    for (const [tier, value] of Object.entries(TIER_WEIGHT)) {
      if (name.includes(tier)) {
        weight = value
        break
      }
    }
  }

  if (!weight) return star

  const roman = name.match(/(III|IV|V|II|I)\s*$/)
  const sub = roman ? 6 - (ROMAN_OF[roman[1]] || 0) : 0

  return weight * 100000 + sub * 1000 + star
}

/**
 * 营地主页响应 → 一行榜单要的字段：角色名/头像、段位名、星数、排序权重、巅峰分与档位说明。
 * 只看 `data.roleList` 与 `data.head.mods` 里的 701（排位）、702（巅峰）两项，
 * 名字一律洗干净，认不出来的段位就是空串、星数与巅峰分给 0。
 *
 * @param {object} result 营地 profile 响应
 * @returns {object} `{roleId, roleName, roleIcon, roleText, RankName, RankStar, RankScore, PeakScore, PeakDesc}`；
 *   roleName 取不到时是**空串**（留给 `buildRow` 用绑定里记的名字兜底、最后才写「无名召唤师」），其余缺项为空串或 0
 */
export function extractRankInfo (result) {
  const data = result?.data || {}
  const roles = Array.isArray(data.roleList) ? data.roleList : []
  const targetRoleId = toText(data.targetRoleId)
  const role = roles.find(item => toText(item?.roleId) === targetRoleId) || roles[0] || {}
  const mods = Array.isArray(data.head?.mods) ? data.head.mods : []
  const RankMod = mods.find(item => Number(item?.modId) === RANK_MOD_RANK)
  const PeakMod = mods.find(item => Number(item?.modId) === RANK_MOD_PEAK)
  const RankParam = parseModParam(RankMod?.param1)
  const PeakParam = parseModParam(PeakMod?.param1)
  const RankName = cleanName(RankMod?.name)
  const RankStar = Number(toText(RankParam?.rankingStar ?? RankParam?.RankingStar).replace(/[^\d-]/g, '')) || 0
  const PeakScore = Number(toText(PeakMod?.content).replace(/[^\d]/g, '')) || 0

  return {
    roleId: toText(role.roleId) || targetRoleId,
    /**
     * 这里**不能**直接吐「无名召唤师」：榜单每行还有绑定里记下的名字可用，
     * 一旦在这里兜了底，`buildRow` 的 `record.roleName || target.roleName` 就永远选中占位符 ——
     * 2026-10-28 端到端走查就是这样，一整张榜单全是「无名召唤师」。
     */
    roleName: cleanName(role.roleName),
    roleIcon: toText(role.roleIcon),
    roleText: cleanName(role.roleText),
    RankName,
    RankStar,
    RankScore: calcRankSort(RankName, RankStar),
    PeakScore,
    PeakDesc: cleanName(PeakParam?.desc)
  }
}
