/**
 * @file 账号列表、角色切换、隐藏恢复与诊断指令。
 */
import { toText, describeError, maskUserId, isProfileHiddenCode, isUsableAuth } from '../Common.js'
import { kingAuthTip, kingNoBindTip, kingLog, kingReply, kingGuard, kingHint } from '../Say.js'
import { getProfile, CAMP_REFERER } from '../Api.js'
import { resolveBind, accountForUser, accountForRole, ownAccounts, queryAccountsFor, setBind, accountOwnsRole, listAccounts, campAccountValueOf } from '../Auth.js'
import { mapProfile } from './map.js'
import { resolveCampQuery } from './query.js'
import { readHiddenRoles, readOwnerRoleEntries, campRolePool, readAccountRoles, cachedRoleEntries, campRoleView, writeHiddenRoles } from './roles.js'
import { CAMP_ACCOUNT_MAX, OPEN_IDS, DIAGNOSE_MAX } from './consts.js'
import { renderKing, imageUris } from '../Card.js'
import { kingWhoami, accountText, accountCardView, paintAccountAvatars } from '../Account.js'
import { rankFaceOf } from '../Face.js'

function roleArgs (msg, cmd) {
  const text = toText(msg)
  const at = text.indexOf(cmd)
  const rest = at >= 0 ? text.slice(at + cmd.length) : text
  const found = (rest.match(/\d+/g) || []).map(item => Number(item)).filter(item => item > 0)
  return [...new Set(found)]
}

function roleLines (pool) {
  return pool.map(item => `${item.index}. ${item.roleName}（${item.serverName || '—'}${item.roleLevel ? ` · ${item.roleLevel} 级` : ''}）#${item.roleId}`)
}

async function ownRolePool (e) {
  const owner = toText(e.user_id)
  const bind = resolveBind({ userId: owner })
  const accounts = queryAccountsFor({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: bind.roleId, limit: CAMP_ACCOUNT_MAX })
  const account = accounts[0] || accountForRole({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: bind.roleId }) || accountForUser(owner)
  if (!account) return { error: kingAuthTip() }

  /** 没绑角色又没扫码存过号时别去查别人的主页，直接让他先看说明 */
  const campId = toText(bind.roleId) || (ownAccounts(owner).length ? toText(account.userId) : '')
  if (!campId) return { error: kingNoBindTip() }
  const hidden = readHiddenRoles(owner)
  const query = await resolveCampQuery(campId, { owner, byUser: bind.byUser })
  const ids = [query.campUserId, toText(account.userId), toText(bind.roleId)].filter(Boolean)
  for (const target of [...new Set(ids)]) {
    try {
      const result = await getProfile(target, { accountId: account.id, targetRoleId: target === query.campUserId ? query.roleId : '' })
      const mapped = mapProfile(result)
      if (!mapped.role.roleId) continue
      const ownRoles = await readAccountRoles(account, target, mapped.roles)
      const entries = await readOwnerRoleEntries(owner, { currentId: toText(account.id), currentRoles: ownRoles })
      const pool = campRolePool(entries, mapped.role.roleId)
      if (pool.length) return { owner, account, pool, entries, hidden, currentId: mapped.role.roleId }
    } catch (error) {
      kingLog.warn(`查账号下的角色失败：${toText(error?.message) || describeError(error)}`)
    }
  }

  /** 营地这会儿查不动：拿缓存里存过的角色凑一份，编号跟平时还是对得上的 */
  const entries = cachedRoleEntries(owner)
  const pool = campRolePool(entries, toText(bind.roleId))
  if (pool.length) return { owner, account, pool, entries, hidden, currentId: toText(bind.roleId), cached: true }
  return { error: `这个登录信息查不到角色，先把营地角色绑定一次再试（发 #王者营地 看看当前绑的是谁）` }
}

/**
 * 「#王者账号」：角色池 + 营地账号池单独一张卡。
 * 营地卡只说这个号自己的事（段位/赛季/皮肤），角色和账号这种「号下面还有什么」的东西放这张卡；
 * 谁发这条指令就查谁的，不借别人的号看。
 *
 * @param {object} e 消息事件（`e.user_id` 是谁在发，`e.runtime.render` 决定能不能出图）
 * @returns {Promise<boolean|object>} 出一张角色与账号卡（出不了图就退成文字）；没过权限闸门给 false
 */
export async function kingAccount (e) {
  if (!(await kingGuard(e))) return false

  const owner = toText(e.user_id)
  /** 头像要等下面拿到每个号名下的角色再画，先别让 accountCardView 按扫码人 QQ 头像铺一遍 */
  const view = await accountCardView(owner, { avatars: false })
  if (!view.total) return kingReply(e, kingAuthTip())

  const got = await ownRolePool(e).catch(error => ({ error: toText(error?.message) || describeError(error) }))
  const roleView = got.pool
    ? campRoleView(got.pool, got.hidden || [], { who: '你', isSelf: true })
    : { roles: [], rolesHead: '', rolesNote: '', empty: got.error || '这次没查到你名下的角色，先绑一次营地角色再试' }

  /** 账号 → 名下角色（第一个就是默认角色）。查不到就退回缓存里的，至少别写「还没绑」 */
  const entries = got.entries && got.entries.length ? got.entries : cachedRoleEntries(owner)
  const rolesByAccount = new Map((entries || []).map(entry => [toText(entry?.account?.id), Array.isArray(entry?.roles) ? entry.roles : []]))
  const listed = view.rows.map(row => ({ ...row, roleCount: (rolesByAccount.get(toText(row.id)) || []).length }))

  let rows = listed
  try {
    rows = await paintAccountAvatars(listed, { rolesByAccount })
  } catch (error) {
    kingLog.warn(`角色与账号卡片头像没拿到：${toText(error?.message)}`)
  }

  /** 角色格子也带一张排行头像：跟账号行同一张图，一眼能对上 */
  if (roleView.roles?.length) {
    try {
      const faces = await imageUris(roleView.roles.map(role => rankFaceOf(role.roleId)), { width: 64, height: 64, limit: 8, referer: CAMP_REFERER })
      roleView.roles = roleView.roles.map((role, index) => ({ ...role, avatar: faces[index] || '' }))
    } catch (error) {
      /** 头像拿不到不影响整张卡：这里降级成占位，不往上抛 */
      kingLog.warn(`营地卡头像没取到：${error?.message || error}`)
    }
  }

  const text = `${accountText(owner, { mask: false, maskOwner: false })}\n\n想看完整的（带主页数据）：发「#我的营地」`
  if (!e?.runtime?.render) return kingReply(e, text)

  try {
    return await renderKing(e, 'account', {
      ...view,
      rows,
      roles: roleView.roles,
      rolesHead: roleView.rolesHead,
      rolesNote: roleView.rolesNote,
      rolesEmpty: roleView.empty || '',
      statusLines: kingWhoami(e, OPEN_IDS),
      note: '★ 是默认号。角色编号对应「#王者切换角色n」，账号编号对应「#王者切换账号 n」。'
    })
  } catch (error) {
    kingLog.warn(`角色与账号卡片没出图，改用文字：${toText(error?.message)}`)
    return kingReply(e, text)
  }
}

/**
 * 「#王者切换角色n」：把营地卡上显示的角色换成编号 n 那个（n 就是 `#王者账号` 里列的编号）。
 * 不带 n 就把编号列出来给用户挑；换成了把绑定写回数据文件，下次查营地卡直接用它。
 *
 * @param {object} e 消息事件（从 `e.msg` 里取编号，`e.user_id` 是谁在换）
 * @returns {Promise<boolean|object>} 换好/列编号的回执；没过权限闸门、或编号不在池里给 false 或文字提示
 */
export async function kingSwitchRole (e) {
  if (!(await kingGuard(e))) return false

  const wanted = roleArgs(e.msg, '切换角色')
  const got = await ownRolePool(e)
  if (!got.pool) return kingReply(e, got.error)

  const { owner, account, pool } = got
  const labels = pool.map(item => `${item.index} 号`)
  if (!wanted.length) {
    return kingReply(e, ['「#王者切换角色n」换营地卡片上显示的那个角色，n 是编号（也可以用 #王者隐藏角色n 把角色收起来）：', ...roleLines(pool)].join('\n'))
  }

  const miss = wanted.filter(n => !pool.some(item => item.index === n))
  const pick = pool.find(item => item.index === wanted[0])
  if (!pick) {
    return kingReply(e, `这个 QQ 存下的账号一共 ${pool.length} 个角色，编号是 ${labels.join('、')}，发 #王者营地 看一眼`)
  }

  const saved = setBind(owner, {
    roleId: pick.roleId,
    roleName: pick.roleName,
    serverName: pick.serverName,
    accountId: pick.accountId || account.id,
    byUser: owner
  })
  if (!saved?.ok) return kingReply(e, `换角色没存上（${saved?.reason || '保存失败'}），稍后再试一次`)

  return kingReply(e, [
    `营地卡片换成 ${pick.index} 号「${pick.roleName}」了`,
    miss.length ? `${miss.join('、')} 号没有，跳过了` : '',
    '发 #王者营地 看看新卡片'
  ].filter(Boolean).join('\n'))
}

/**
 * 「#王者隐藏角色n」：把指定编号的角色从营地卡上收起来（数据没了不删，只是不再显示）。
 * 不带 n 就列出当前藏了哪些、能藏哪些；编号跟 `#王者账号` 里列的一致。
 *
 * @param {object} e 消息事件（从 `e.msg` 里取编号，`e.user_id` 是谁在藏）
 * @returns {Promise<boolean|object>} 藏好/列清单的回执；没过权限闸门给 false，记录没写进文件也会给文字提示
 */
export async function kingHideRole (e) {
  if (!(await kingGuard(e))) return false

  const wanted = roleArgs(e.msg, '隐藏角色')
  const got = await ownRolePool(e)
  if (!got.pool) return kingReply(e, got.error)

  const { owner, pool } = got
  const hidden = readHiddenRoles(owner).filter(id => pool.some(item => item.roleId === id))
  if (!wanted.length) {
    if (!hidden.length) {
      return kingReply(e, ['现在没有藏起来的角色。想藏哪个发「#王者隐藏角色n」（n 是编号）：', ...roleLines(pool)].join('\n'))
    }
    return kingReply(e, [
      '这些角色已经从营地卡片上收起来了：',
      ...pool.filter(item => hidden.includes(item.roleId)).map(item => `${item.index} 号 ${item.roleName}（#${item.roleId}）`),
      '想放回来就发「#王者恢复角色n」'
    ].join('\n'))
  }

  const miss = wanted.filter(n => !pool.some(item => item.index === n))
  const hits = wanted.map(n => pool.find(item => item.index === n)).filter(Boolean)
  if (!hits.length) {
    return kingReply(e, `这个 QQ 存下的账号一共 ${pool.length} 个角色，编号 1 到 ${pool.length}，发 #王者营地 看一眼`)
  }

  const already = hits.filter(item => hidden.includes(item.roleId))
  const next = [...new Set([...hidden, ...hits.map(item => item.roleId)])]
  if (!writeHiddenRoles(owner, next)) return kingReply(e, '藏角色的记录没存上，稍后再试一次')

  return kingReply(e, [
    `${hits.map(item => `${item.index} 号「${item.roleName}」`).join('、')}已经从营地卡片上收起来了`,
    already.length ? `${already.map(item => item.index).join('、')} 号本来就藏着` : '',
    miss.length ? `${miss.join('、')} 号没有，跳过了` : '',
    '想看藏了哪些发「#王者隐藏角色」，想放回来发「#王者恢复角色n」'
  ].filter(Boolean).join('\n'))
}

/**
 * 「#王者恢复角色n」：把之前藏起来的角色放回营地卡。只能恢复藏过的，没藏过的会提示先藏。
 *
 * @param {object} e 消息事件（从 `e.msg` 里取编号，`e.user_id` 是谁在恢复）
 * @returns {Promise<boolean|object>} 恢复结果逐条回执；没过权限闸门给 false，记录没写进文件也会给文字提示
 */
export async function kingRestoreRole (e) {
  if (!(await kingGuard(e))) return false

  const wanted = roleArgs(e.msg, '恢复角色')
  const got = await ownRolePool(e)
  if (!got.pool) return kingReply(e, got.error)

  const { owner, pool } = got
  const hidden = readHiddenRoles(owner).filter(id => pool.some(item => item.roleId === id))
  if (!wanted.length) {
    if (!hidden.length) return kingReply(e, '现在没有藏起来的角色，不用恢复')
    return kingReply(e, [
      '这些角色还被藏着（要先藏过才能恢复）：',
      ...pool.filter(item => hidden.includes(item.roleId)).map(item => `${item.index} 号 ${item.roleName}`),
      '发「#王者恢复角色n」把要的那个放回卡片'
    ].join('\n'))
  }

  const lines = []
  const next = [...hidden]
  for (const n of wanted) {
    const hit = pool.find(item => item.index === n)
    if (!hit) {
      lines.push(`${n} 号没有，跳过了`)
      continue
    }
    if (!hidden.includes(hit.roleId)) {
      lines.push(`${n} 号没被藏起来过，先发 #王者隐藏角色${n} 藏起来再说`)
      continue
    }
    next.splice(next.indexOf(hit.roleId), 1)
    lines.push(`${n} 号「${hit.roleName}」放回卡片了`)
  }

  if (next.length !== hidden.length && !writeHiddenRoles(owner, next)) {
    return kingReply(e, '恢复的记录没存上，稍后再试一次')
  }
  return kingReply(e, [...lines, '发 #王者营地 看看'].join('\n'))
}

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

  const owner = toText(e.user_id)
  const bind = resolveBind({ userId: owner })
  const pool = listAccounts(owner)
  const campId = toText(bind.roleId)
  if (!campId) {
    return kingReply(e, pool.length
      ? '诊断：你还没绑角色。发「#王者营地」，我按你名下的营地号认一个。'
      : '诊断：你还没绑角色，也没存过号。发「#王者QQ扫码」扫一个。')
  }

  const tries = queryAccountsFor({ accountId: bind.accountId, owner, byUser: bind.byUser, roleId: campId, limit: DIAGNOSE_MAX })
  if (!tries.length) return kingReply(e, kingAuthTip())

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
    return kingReply(e, [
      `诊断：「${who}」这个角色没认出来是哪个营地号。`,
      '用这个角色本人的号发一次「#王者QQ扫码」再试，我就能认出来。'
    ].join('\n'))
  }

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
