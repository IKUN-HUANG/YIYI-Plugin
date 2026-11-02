/**
 * @file 「#王者账号」：角色池 + 营地账号池单独一张卡——号下面还有什么角色、哪些被藏起来了、怎么切。
 *
 * @module models/King/Profile/FlowAccount
 */
import { kingReply, kingGuard, kingAuthTip, kingLog } from '../Say.js'
import { renderKing, imageUris } from '../Card.js'
import { CAMP_REFERER } from '../Api.js'
import { kingWhoami, accountText, accountCardView, paintAccountAvatars } from '../Account.js'
import { toText, describeError } from '../Common.js'
import { RankFaceOf } from '../Face.js'
import { OPEN_IDS } from './Consts.js'
import { campRoleView } from './Roles.js'
import { cachedRoleEntries } from './Entries.js'
import { ownRolePool } from './Roles.js'

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
      const faces = await imageUris(roleView.roles.map(role => RankFaceOf(role.roleId)), { width: 64, height: 64, limit: 8, referer: CAMP_REFERER })
      roleView.roles = roleView.roles.map((role, index) => ({ ...role, avatar: faces[index] || '' }))
    } catch (error) {
      /** 头像拿不到不影响整张卡：这里降级成占位，不往上抛 */
      kingLog.warn(`营地卡头像没取到：${error?.message || error}`)
    }
  }

  const text = `${accountText(owner, { mask: false, maskOwner: false })}\n\n想看完整的（带主页数据）：发「#我的营地」`
  if (!e?.runtime?.render) return kingReply(e, text)

  try {
    return await renderKing(e, 'Account', {
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

