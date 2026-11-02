/**
 * @file 「#王者营地」（`#我的营地` 同一条）：出那张 1080 宽的营地卡。分四步——认目标（`campPlan`）、
 * 查主页（`campLookup`）、把查通的事实写回去（`campHeal`）、出卡（`campCard`，在 `FlowCard.js`）。
 * 取数顺序是「绑定里的角色 → 换个号再查 → 缓存兜底」，中间任何一步查不动都退成文字提示，不会卡死。
 *
 * @module models/King/Profile/FlowCamp
 */
import { kingReply, kingGuard, kingAuthTip, kingNoBindTip, kingViewUnboundTip, kingLog } from '../Say.js'
import { resolveKingTarget } from '../Target.js'
import { findCampProfile } from './Camp/Query.js'
import { setBind, campAccountValueOf, queryAccountsFor, rememberCampUser } from '../Auth.js'
/** 角色名/区服的历史记录（成员名单缓存）：营地给的昵称是不可见字符时，用它保住已经认出来的名字 */
import { roleInfoOf } from '../Auth/Roles.js'
import { kingWhoami, kingAuthFail } from '../Account.js'
import { toText, maskUserId } from '../Common.js'
import { CAMP_ACCOUNT_MAX } from './Consts.js'
import { resolveCampQuery, campTarget } from './Resolve.js'
import { readHiddenRoles } from './Roles.js'
import { campCard } from './FlowCard.js'

/**
 * 「#我的营地」（也可带别人的 QQ / 角色 ID）：出那张 1080 宽的营地卡。
 * 取数顺序是「绑定里的角色 → 换个号再查 → 缓存兜底」，中间任何一步查不动都退成文字提示，
 * 不会把整条指令卡死；出图成功会顺手记下这次读到的角色名，下次文案里就能直接写名字。
 *
 * @param {object} e 消息事件（`e.user_id` 是谁在查，`e.msg` 里可能带着要看的人）
 * @returns {Promise<boolean|object>} 出图成功给 true；其它情况给文字回执（回执对象或 false）
 */
export async function kingMyCamp (e) {
  if (!(await kingGuard(e))) return false

  const target = await resolveKingTarget(e)
  if (target.hint) return kingReply(e, target.hint)

  const plan = campPlan(e, target)
  if ('done' in plan) return plan.done

  const { fromBind, bindAccountId, picked } = plan

  try {
    const lookup = await campLookup(e, plan)
    if ('done' in lookup) return lookup.done
    const { campSelf, found } = lookup
    const { liveRoleId, account } = found
    /** `fromBind` = 这次要查的 ID 本来就是绑定里存的那个。这里没有 `bind` 这个变量，以前手写成 `bind.roleId`，
     *  一查通就 ReferenceError，整条营地主页回「bind is not defined」 */
    const healRole = Boolean(liveRoleId) && Boolean(campSelf) && fromBind
    const healAccount = fromBind && toText(account.id) !== toText(bindAccountId || toText(picked?.id))
    await campHeal(e, plan, lookup, { healRole, healAccount })
    return await campCard(e, target, plan, lookup)
  } catch (error) {
    return kingAuthFail(e, error, `查营地ID ${plan.campId} 的主页失败，稍后再试试`)
  }
}

/**
 * 认目标：`campTarget` 挑好的号 + 它漏掉的号（缓存里记错了「这角色是谁的号」时还得能换号重查）。
 * 认不出营地号、或一个可用的号都没有，就当场把「没绑」/「没号」的文字回执带回去。
 *
 * @param {object} e 消息事件
 * @param {object} target `resolveKingTarget` 的结果
 * @returns {object} `{ done }` 或出卡上下文 `{ campId, owner, isSelf, candidates, … }`
 */
function campPlan (e, target) {
  const { campId, fromBind, bindBy, bindName, bindServer, bindAccountId, account: picked, accounts: triedAccounts, owner, isSelf } = campTarget(e, target)
  const viewE = isSelf ? e : { user_id: owner, group_id: '' }
  if (!campId) {
    return { done: kingReply(e, isSelf ? [kingNoBindTip(), '', ...kingWhoami(viewE)].join('\n') : kingViewUnboundTip(owner)) }
  }

  /** 候选先按 campTarget 挑好的那批（轮换取号的顺序已经算在里面了），
   *  再把它漏掉的号补在后面：缓存里记错了「这角色是谁的号」时，还得能换到别的号上重查 */
  const candidates = (() => {
    const head = Array.isArray(triedAccounts) ? triedAccounts : []
    const wide = queryAccountsFor({ accountId: picked?.id, owner, byUser: bindBy, roleId: campId, limit: CAMP_ACCOUNT_MAX })
    const merged = [...head]
    for (const one of wide) {
      if (!merged.some(item => toText(item?.id) === toText(one?.id))) merged.push(one)
    }
    return merged.slice(0, CAMP_ACCOUNT_MAX)
  })()
  if (!candidates.length) {
    return { done: kingReply(e, isSelf ? [kingAuthTip(), '', ...kingWhoami(viewE)].join('\n') : kingViewUnboundTip(owner)) }
  }

  return { campId, fromBind, bindBy, bindName, bindServer, bindAccountId, picked, owner, isSelf, viewE, candidates }
}

/**
 * 查主页：先认这串数字是营地号还是角色 ID，再挨个号试。全被 -10107 挡住就把「对方可能关了主页」说清楚，
 * 并在确实知道归属时记进隐藏主页名单（定时任务 24 小时内不再白跑）。
 *
 * @param {object} e 消息事件
 * @param {object} plan 出卡上下文
 * @returns {Promise<object>} `{ done }` 或 `{ query, campSelf, found }`
 */
async function campLookup (e, plan) {
  const { campId, owner, bindBy, candidates } = plan
  const query = await resolveCampQuery(campId, { owner, byUser: bindBy })
  /** 认一下这个 ID 到底是营地号还是角色 ID：营地号当角色 ID 去查一律回 -1013，看着像被藏了 */
  const campSelf = query.roleId ? '' : toText(campAccountValueOf(campId, owner))
  const found = await findCampProfile({ candidates, campSelf, query, campId })
  const { account, mapped, liveCampUser, tried, ownerTried, ownerHidden } = found

  if (!mapped) {
    /** 每个号都被 -10107 挡住 → 记进隐藏主页名单，定时任务那边 24 小时内不再白跑。
     *  只在我们确实知道这个角色属于谁（营地说清是它自己藏的）才记，认错的号不记。 */
    if ((query.roleId || campSelf) && ownerTried && ownerHidden === ownerTried) {
      try {
        const { markProfileHidden } = await import('./Exchange.js')
        markProfileHidden(campId, toText(e?.sender?.card) || '')
      } catch (error) {
        kingLog.warn(`记录隐藏主页名单失败：${error.message}`)
      }
    }
    const why = tried.length ? tried.join('；') : '没有可用的号'
    kingLog.warn(`营地主页 ${maskUserId(campId)} 拿不到数据：${why}`)
    /** 回话里只讲人话，每个号的具体返回码留在日志与「#王者诊断」里。
     *  -10107 不能一口咬定「对方关了主页」：拿角色 ID 当营地号查，营地回的也是这个码 */
    return {
      done: kingReply(e, [
        `营地ID ${campId} 的主页读不到。`,
        '营地这次回的是「召唤师隐藏了主页信息」（-10107）：要么这个号在营地关了「主页可见范围」，',
        '要么这串数字不是营地号 —— 角色 ID 和营地号都是 9～10 位，看着一样。',
        '先核对一下 ID（营地 App → 我的 → 复制营地ID），或者发「#王者诊断」，我把每个号试出来的返回码列给你。'
      ].join('\n'))
    }
  }

  return { query, campSelf, found }
}

/**
 * 查通之后把事实写回去：撤掉误记的隐藏名单、记住「这个角色在这个营地号下」、绑定档自愈
 * （存的是营地号就改成真查到的角色 ID，换了号才查通就把绑定改到能查的号上）。
 * `healRole` / `healAccount` 由 `kingMyCamp` 算好传进来：只有那里知道这次查的是不是绑定里存的那个 ID。
 *
 * @param {object} e 消息事件
 * @param {object} plan 出卡上下文
 * @param {object} lookup 查主页结果
 * @param {object} Flags `{ healRole, healAccount }`：要不要改角色 ID / 改绑定上的号
 * @returns {Promise<void>} 只写绑定与名单，不产出回执
 */
async function campHeal (e, plan, lookup, Flags) {
  const { campId, owner, isSelf, fromBind, bindBy, bindName, bindServer, picked } = plan
  const { campSelf, query, found } = lookup
  const { account, mapped, liveCampUser } = found
  const { healRole, healAccount } = Flags
  /** 这会儿查通了：如果之前被误记成「隐藏主页」（多半是认错号时记的），把记录撤掉，推送那边别再跳过它 */
  if (readHiddenRoles(owner).includes(toText(campId))) {
    try {
      const { clearHiddenProfile } = await import('./Exchange.js')
      if (clearHiddenProfile(campId)) kingLog.mark(`营地主页 ${maskUserId(campId)} 又能查了，从隐藏名单里撤掉`)
    } catch (error) {
      kingLog.info(`撤隐藏名单失败：${error.message}`)
    }
  }

  /**
   * 查通了就把「这个角色就在这个营地号下」记下来（12 小时有效）：
   * 以后认归属不用再挨个试号，也不会因为名单被写脏又把它算到陌生账号上。
   * 用主页回的 roleId 记键（传进来的值有时是营地号、有时是角色 ID）。
   */
  const liveRoleId = toText(mapped.role.roleId)
  /** 归属里要写的是「这个角色在谁的名下」，不是借来查的那个号的营地号：
   *  绑定值本来就是营地号时，那个号就是答案；否则认命中的那个号的营地号（缓存认错归属时，
   *  能查通的这个号才是真的，`query.campUserId` 反而是错的那条）。
   *  营地自己回了 `userId` 就优先信它。 */
  const campAccount = campSelf || liveCampUser || toText(account.userId) || toText(account.id)
  if (liveRoleId && campAccount) rememberCampUser(owner, liveRoleId, campAccount)

  if (toText(account.id) !== toText(picked.id)) {
    kingLog.warn(`营地主页 ${maskUserId(campId)} 换用 ${maskUserId(account.id)} 的登录信息查到了（原来的 ${maskUserId(picked.id)} 查不到）`)
  }

  /**
   * 绑定档自愈：绑定里存的是「营地号」（不是角色 ID）就改成这次真查到的角色 ID ——
   * 不然后面每次查都拿营地号当角色 ID 去撞 -1013，推送、诊断、在线卡全都跟着瞎。
   * 换号查通了也顺手把绑定改到能查的号上（下次直接挑它）。
   */
  /**
   * 名字和区服只往「更清楚」的方向改：营地给的昵称可能是一串不可见字符（真的是特殊符号名），
   * mapProfile 会把它清成占位「召唤师」。这时候别拿占位去覆盖绑定里、成员名单缓存里已经存好的名字，
   * 不然一次查通反而把「女神初心负」之类的旧名字糊掉了。
   */
  const usableName = value => {
    const text = toText(value)
    return Boolean(text) && text !== '召唤师'
  }
  const cachedRole = liveRoleId ? roleInfoOf(liveRoleId) : {}
  const nextName = [mapped.role.roleName, bindName, cachedRole.roleName].find(usableName) || toText(mapped.role.roleName)
  /** 区服是不会变的东西：绑定里、名单缓存里存着更准的「安卓手Q186区」，就别拿接口那个粗的「手Q安卓」顶掉 */
  const nextServer = [bindServer, cachedRole.serverName, toText(mapped.role.areaName), toText(mapped.role.roleText)].find(value => Boolean(toText(value))) || ''
  if (isSelf && liveRoleId && (healRole || healAccount)) {
    const saved = setBind(owner, {
      roleId: liveRoleId,
      roleName: nextName,
      serverName: nextServer,
      /** 绑定里的 accountId 是「这个角色在哪个营地号名下」，不是这次借来查的那个号的 ID：
       *  存成借号的话，下次查它就拿着别人的营地号去查，-1013/-10107 全跟着来 */
      accountId: campAccount || toText(account.id),
      byUser: bindBy || owner
    })
    if (healRole && campSelf && saved?.ok) {
      kingLog.mark(`营地主页：绑定里存的是营地号 ${maskUserId(campId)}，已改成角色 ${maskUserId(liveRoleId)}`)
    }
  }
}
