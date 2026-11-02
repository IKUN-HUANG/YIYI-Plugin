/**
 * @file 营地主页的「查通」那一段：按候选账号逐个试，谁先查到就停。
 *
 * @module models/King/Profile/Camp/Query
 */
import { toText } from '../../Common.js'
import { getProfile } from '../../Api.js'
import { mapProfile } from '../Map.js'
import { isProfileHiddenCode, describeProfileDenied, describeError } from '../../Common.js'

/**
 * 挨个号试这个角色：认得出归属的按角色查，认出是营地号的按营地号查它自己，最后再猜一次。
 * 只统计「我们确实知道这个 ID 是谁」的那几路被 -10107 挡住的次数，猜的那一路不算。
 *
 * @param {{candidates: Array<object>, campSelf: string, query: object, campId: string}} params 候选账号、认出来的营地号、查询解析结果、要查的 ID
 * @returns {Promise<{account: object|null, mapped: object|null, liveCampUser: string, tried: Array<string>, ownerTried: number, ownerHidden: number}>} 查通的结果与每次尝试的说明
 */
export async function findCampProfile ({ candidates, campSelf, query, campId }) {

  const tried = []
  let account = null
  let mapped = null
  /** 查通那一次「被查的那个人的营地号」：借别人的登录态查时，`account.userId` 是**查的人的号**，
   *  不是这个角色所在的营地号，记归属必须用接口回的这个（`data.userId`） */
  let liveCampUser = ''
  /** 按「已知归属」那一路查的次数 / 其中被 -10107 挡住的次数：全部被挡才算这个号真藏了主页 */
  let ownerTried = 0
  let ownerHidden = 0

  /**
   * 同一个号要试几种「这个 ID 到底是谁」：认得出归属就按角色查；认出是营地号就按营地号查它自己；
   * 最后再把它当角色 ID、用这个号自己的营地号兜一次。
   * 兜底那一步不能省：营地对「拿角色 ID 当营地号」回的是 -10107「召唤师隐藏了主页信息」，
   * 跟真藏了主页是同一个码，只试一种就把「两种 ID 搞混」误判成「号藏了主页」了。
   */
  const targetsOf = candidate => {
    const own = toText(candidate.userId) || toText(candidate.id)
    const list = []
    const add = (userId, roleId, trusted = false) => {
      const pair = { userId: toText(userId), roleId: toText(roleId), trusted }
      if (!pair.userId) return
      if (list.some(item => item.userId === pair.userId && item.roleId === pair.roleId)) return
      list.push(pair)
    }
    if (query.roleId) add(query.campUserId, query.roleId, true)
    /** 认出来是营地号：查它自己的主页、让它自己报名下的角色（targetRoleId 不传） */
    if (campSelf) add(campSelf, '', true)
    /** 兜底：这个号自己的营地号 + 目标当角色。这一路是**猜**的（把 ID 当角色）：
     *  砸了只说明这串数字不是营地号，不能当成「对方藏了主页」去记 24 小时名单 */
    add(own, campId)
    return list
  }

  for (const candidate of candidates) {
    for (const target of targetsOf(candidate)) {
      /** 只有「我们已经认定这个 ID 是营地号/角色 ID」的那几路才计入：兜底猜测那路被挡不算数 */
      const trustedTarget = Boolean(target.trusted)
      try {
        const answer = await getProfile(target.userId, { accountId: candidate.id, targetRoleId: target.roleId })
        /** 业务码在包裹对象的 `code` 上（`returnCode` 是营地原始返回体上的字段，这里拿不到） */
        const code = Number(answer?.code)
        if (isProfileHiddenCode(answer) || (Number.isFinite(code) && code !== 0)) {
          if (trustedTarget) ownerHidden += 1
          tried.push(`${toText(candidate.id)}：${describeProfileDenied(answer)}`)
          continue
        }
        const view = mapProfile(answer)
        if (!view.role.roleId) {
          tried.push(`${toText(candidate.id)}：这个号看不到这个角色`)
          continue
        }
        account = candidate
        mapped = view
        liveCampUser = toText(answer?.data?.userId)
        break
      } catch (error) {
        tried.push(`${toText(candidate.id)}：${toText(error?.message) || describeError(error)}`)
      } finally {
        if (trustedTarget) ownerTried += 1
      }
    }
    if (mapped) break
    /** 同一个号两种试法都砸了就没必要再为它多打请求 */
    if (tried.length >= candidates.length * 2) break
  }

  return { account, mapped, liveCampUser, tried, ownerTried, ownerHidden }
}
