/**
 * @file 「#王者诊断」：拿用户名下的每个登录信息去试同一个角色，看谁能查到，并把结论说清楚。
 * 找到能查的号会顺手把绑定改到那个号上。分三段：认目标 → 逐号试 → 下结论。
 *
 * @module models/King/Profile/FlowDiagnose
 */
import { kingReply, kingHint, kingGuard, kingAuthTip, kingLog } from '../Say.js'
import { getProfile } from '../Api.js'
import { resolveBind, accountForRole, accountOwnsRole, setBind, listAccounts, campAccountValueOf, queryAccountsFor } from '../Auth.js'
import { toText, maskUserId, isProfileHiddenCode, describeError, isUsableAuth } from '../Common.js'
import { DIAGNOSE_MAX } from './Consts.js'
import { mapProfile } from './Map.js'
import { resolveCampQuery } from './Resolve.js'
import { readOwnerRoleEntries } from './Entries.js'

/**
 * 「#王者诊断」：挨个拿用户名下的登录信息去试同一个角色，看谁能查到，并把结论说清楚。
 * 找到能查的号会顺手把这个角色的绑定改到那个号上（省得用户自己去切），
 * 一个都查不到就告诉用户是「主页没放开」还是「这些号都不是本人的号」。
 *
 * @param {object} e 消息事件（只看 `e.user_id`，查的就是他自己的号）
 * @returns {Promise<boolean|object>} 诊断结论回执；没过权限闸门、或名下没有登录信息时给 false / 提示文字
 */
export async function kingDiagnose (e) {
  if (!(await kingGuard(e))) return false

  const ctx = await diagnoseTarget(e)
  if ('done' in ctx) return ctx.done

  const { hit, badAuth } = await diagnoseProbe(ctx)
  return diagnoseVerdict(ctx, hit, badAuth)
}

/**
 * 认诊断目标：绑定里存的那个角色、要试的号、按哪种解读去查（角色 ID 还是营地号）。
 * 认不出来就当场给文字回执，别让后面的试号白跑。
 *
 * @param {object} e 消息事件（只看 `e.user_id`）
 * @returns {Promise<object>} `{ done }` 或诊断上下文 `{ owner, bind, campId, campSelf, queryUser, queryRole, who, tries, picked }`
 */
async function diagnoseTarget (e) {
  const owner = toText(e.user_id)
  const bind = resolveBind({ userId: owner })
  const pool = listAccounts(owner)
  const campId = toText(bind.roleId)
  if (!campId) {
    return { done: await kingReply(e, pool.length
      ? '诊断：你还没绑角色。发「#王者营地」，我按你名下的营地号认一个。'
      : '诊断：你还没绑角色，也没存过号。发「#王者QQ扫码」扫一个。') }
  }

  const tries = queryAccountsFor({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: campId, limit: DIAGNOSE_MAX })
  if (!tries.length) return { done: await kingReply(e, kingAuthTip()) }

  const who = bind.roleName || campId
  /** 后面还有诊断结果卡，这句提示走文字（一条指令最多一张图） */
  await kingHint(e, `诊断：挨个试 ${tries.length} 个号，几秒钟…`)

  /** 诊断就是来查问题的：先强制刷一遍角色名单，别信可能已经空壳的缓存 */
  try {
    await readOwnerRoleEntries(owner, { useCache: false })
  } catch (error) {
    kingLog.info(`诊断重刷角色名单失败：${toText(error?.message) || describeError(error)}`)
  }

  const query = await resolveCampQuery(campId, { owner, byUser: bind.byUser })
  const picked = accountForRole({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: campId })
  /** 绑定里存的可能就是这个营地号本身：那就查它自己的主页（拿营地号当角色 ID 只会回 -1013） */
  const campSelf = query.roleId ? '' : toText(campAccountValueOf(campId, owner))
  const queryUser = query.roleId ? query.campUserId : campSelf
  const queryRole = query.roleId || ''

  /** 连这个角色属于哪个营地号都认不出来：别拿角色ID 当营地号乱试，直接告诉他怎么办 */
  if (!queryUser) {
    return {
      done: await kingReply(e, [
        `诊断：「${who}」这个角色没认出来是哪个营地号。`,
        '用这个角色本人的号发一次「#王者QQ扫码」再试，我就能认出来。'
      ].join('\n'))
    }
  }

  return { e, owner, bind, campId, campSelf, queryUser, queryRole, who, tries, picked }
}

/**
 * 逐号试：先按「这串数字是营地号」查一轮，全砸了就按「是角色 ID」再查一轮。
 * 单号上不重试 —— 这个号不行就换下一个，重试只会让诊断更慢。
 *
 * @param {object} ctx 诊断上下文
 * @returns {Promise<object>} `{ hit, badAuth }`：能查到的号与要重新扫码的号数
 */
async function diagnoseProbe (ctx) {
  const { campSelf, queryUser, queryRole, campId, tries } = ctx
  const hit = []
  let badAuth = 0
  for (const account of tries) {
    const id = toText(account.id)
    if (!isUsableAuth(account)) {
      badAuth += 1
      continue
    }
    try {
      /** 逐号试的时候别在单号上重试：这个不行就换下一个号，重试只会让「诊断」更慢 */
      const result = await getProfile(queryUser, { accountId: id, targetRoleId: queryRole, retry: 0 })
      /** 业务码在包裹对象的 `code` 上（`returnCode` 只存在于营地原始返回体） */
      const code = Number(result?.code)
      if (isProfileHiddenCode(result) || (Number.isFinite(code) && code !== 0)) continue
      const mapped = mapProfile(result)
      if (!mapped.role.roleId) continue
      hit.push({ account, roleId: toText(mapped.role.roleId) })
    } catch (error) {
      kingLog.info(`诊断试号失败（${maskUserId(id)}）：${toText(error?.message) || describeError(error)}`)
    }
  }

  /**
   * 第一轮全砸了再换一种解读试一轮：营地回 -10107 有两种来源 —— 他真关了主页可见，
   * 或者这串数字根本不是营地号（是角色 ID / 抄错一位）。只报第一种就会让人白折腾。
   */
  if (!hit.length && campSelf) {
    for (const account of tries) {
      const id = toText(account.id)
      if (!isUsableAuth(account)) continue
      try {
        const own = toText(account.userId) || id
        const result = await getProfile(own, { accountId: id, targetRoleId: campId, retry: 0 })
        const code = Number(result?.code)
        if (isProfileHiddenCode(result) || (Number.isFinite(code) && code !== 0)) continue
        const mapped = mapProfile(result)
        if (!mapped.role.roleId) continue
        hit.push({ account, roleId: toText(mapped.role.roleId) })
      } catch (error) {
        kingLog.info(`诊断（当角色 ID 再试一次）失败（${maskUserId(id)}）：${toText(error?.message) || describeError(error)}`)
      }
    }
  }

  return { hit, badAuth }
}

/**
 * 下结论：一个都查不到就说清 -10107 的两种来源；查到了但当前绑定的号就能查，就让人重发一次（营地偶尔抽风）。
 *
 * @param {object} ctx 诊断上下文
 * @param {object[]} hit 能查到的号
 * @param {number} badAuth 要重新扫码的号数
 * @returns {Promise<object>} 诊断结论回执
 */
async function diagnoseVerdict (ctx, hit, badAuth) {
  const { e, owner, bind, campId, campSelf, who, tries, picked } = ctx
  if (!hit.length) {
    return kingReply(e, [
      `诊断：「${who}」的主页读不到，试了 ${tries.length} 个号${badAuth ? `（${badAuth} 个号要重新扫一次）` : ''}。`,
      '营地回的是 -10107「召唤师隐藏了主页信息」：要么他真关了「主页可见范围」，要么这串数字不是营地号（角色 ID 也一样长，抄错一位也是这个结果）。',
      '先在营地 App 里核对 ID（我的 → 点头像 → 复制营地ID）；对得上就让他本人发一次「#王者QQ扫码」。'
    ].join('\n'))
  }

  const right = hit.find(item => accountOwnsRole(item.account, campId, owner)) || hit[0]
  const rightId = toText(right.account.id)
  const liveRoleId = toText(right.roleId) || toText(campId)
  /** 只有「换号才查得到」或「绑定里存的是营地号」才需要改绑定，好好的绑定别乱动 */
  if ((rightId === toText(picked?.id) && !campSelf) || bind.from !== 'user') {
    return kingReply(e, `诊断：现在用的号就能查到「${who}」，营地偶尔抽风，再发一次「#王者营地」就好。`)
  }

  const saved = setBind(owner, {
    roleId: liveRoleId,
    roleName: bind.roleName,
    serverName: bind.serverName,
    accountId: rightId,
    byUser: owner
  })
  kingLog.mark(`营地诊断：角色 ${maskUserId(campId)} 的登录信息改成 ${maskUserId(rightId)}`)
  if (!saved?.ok) {
    return kingReply(e, `诊断：账号 ${rightId} 查得到「${who}」，但改绑定没存上，发「#王者切换角色n」手动换一个。`)
  }
  return kingReply(e, campSelf
    ? `诊断：绑定里存的是营地号 ${campId}，已经换成角色 ${liveRoleId}（账号 ${rightId}），再发一次「#王者营地」。`
    : `诊断：「${who}」换成账号 ${rightId} 才查得到，已经改过来了，再发一次「#王者营地」。`)
}
