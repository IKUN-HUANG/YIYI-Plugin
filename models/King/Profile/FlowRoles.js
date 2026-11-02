/**
 * @file 换 / 藏 / 恢复角色：三条都只动「营地卡上显示哪个角色」这条绑定与隐藏名单，不碰账号池。
 *
 * @module models/King/Profile/FlowRoles
 */
import { kingReply, kingGuard } from '../Say.js'
import { setBind } from '../Auth.js'
import { readHiddenRoles } from './Roles.js'
import { writeHiddenRoles } from './Roles.js'
import { roleArgs } from './Roles.js'
import { roleLines } from './Roles.js'
import { ownRolePool } from './Roles.js'

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

