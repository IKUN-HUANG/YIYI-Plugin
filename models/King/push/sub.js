/**
 * @file 订阅的补建与游标初始化（单独一个文件是为了断开 commands→tick→groups→commands 的环）
 * @module models/King/push/sub
 */
import { toText } from '#yiyi.utils'
import { parseBattleTime } from '../Archive.js'
import { resolveBind } from '../Auth.js'
import { groupPushOn, isGroupPushMuted } from '../GroupPush.js'
import { campRoleName, cleanName, normalizeName, resolveCampQuery } from '../Profile.js'
import { pushAccountFor } from '../auth/roles.js'
import { HIDDEN } from './consts.js'
import { fetchLatest } from './fetch.js'
import { getSub, isFlagOn, loadPushData, savePushData, setSubFlag } from './store.js'

/**
 * 推送订阅的「补订阅」与「起播游标」。
 * 单独一个文件是为了断开 commands ⇄ groups ⇄ tick 的循环依赖：
 * 这两件事本质是订阅表的写入，跟指令入口没关系。
 */
/**
 * 默认开启：给某个人在本群补一份推送订阅（两个开关都打开）。
 * 群总开关关掉、或本人自己关过推送时不动。
 *
 * @param {string} qq QQ 号
 * @param {string} groupId
 * @param {object} [opts]
 * @returns {object 订阅记录}
 */
export async function ensureSubForUser (qq, groupId, opts = {}) {
  const id = toText(qq)
  const gid = toText(groupId)
  if (!id || !gid) return { ok: false, reason: 'no-group' }
  if (!groupPushOn(gid)) return { ok: false, reason: 'group-off' }
  if (isGroupPushMuted(gid, id)) return { ok: false, reason: 'muted' }

  const data = loadPushData()
  const current = getSub(data, id)
  if (current && toText(current.group) === gid && isFlagOn(current, 'battle') && isFlagOn(current, 'online')) {
    return { ok: true, already: true }
  }

  const bind = opts.bind || resolveBind({ userId: id })
  /** 推送类只认这个人自己扫码存的登录信息，不去借别人的号：查得频繁，借号容易把人家的登录信息搞异常 */
  const account = opts.account || pushAccountFor({ accountId: bind.accountId, owner: id, roleId: bind.roleId })
  if (!account) return { ok: false, reason: 'no-account' }

  const campId = toText(bind.roleId) || toText(account.userId)
  if (!campId) return { ok: false, reason: 'no-role' }

  const query = await resolveCampQuery(campId, { owner: id, byUser: bind.byUser })
  const base = {
    group: gid,
    campId,
    campUserId: query.campUserId,
    roleId: query.roleId,
    roleName: normalizeName(cleanName(bind.roleName) || campRoleName(id, campId)),
    accountId: toText(account.id),
    byUser: toText(bind.byUser)
  }
  setSubFlag(data, id, 'battle', true, base)
  setSubFlag(data, id, 'online', true, base)
  if (!savePushData(data)) return { ok: false, reason: 'save' }

  await seedCursor(id, campId, account.id, query.campUserId)
  return { ok: true, added: true, roleName: normalizeName(cleanName(bind.roleName) || campRoleName(id, campId)) || campId }
}

/**
 * 新订阅把游标对齐到「现在」：否则第一圈会把历史对局全当新的推一遍
 *
 * @param {string} qq QQ 号
 * @param {string} campId 营地号
 * @param {string} [accountId=""] 用哪个号查
 * @param {string} [campUserId=""] 营地用户 ID
 * @returns {Promise<boolean> 游标有没有写进存档}
 */
export async function seedCursor (qq, campId, accountId = '', campUserId = '') {
  const info = await fetchLatest(campId, accountId, campUserId, qq)
  if (!info || info === HIDDEN || typeof info !== 'object') return false

  const list = Array.isArray(info.list) ? info.list : []
  if (!list.length) return false

  const data = loadPushData()
  const sub = getSub(data, qq)
  if (!sub) return false

  sub.lastGameSeq = toText(list[0].gameSeq)
  sub.lastGameTime = String(parseBattleTime(list[0]))
  sub.skipTicks = 0
  sub.idleSince = ''
  data.pushList[toText(qq)] = sub
  return savePushData(data)
}
