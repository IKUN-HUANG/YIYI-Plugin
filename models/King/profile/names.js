/**
 * @file 角色名清洗与名称缓存，名称记录不表示角色归属。
 */
import { cleanText, toText } from '../Common.js'
import { readUserPart, writeUserPart } from '../Store.js'
import { CAMP_ROLES_PART, CAMP_ROLE_NAMES_PART } from './consts.js'

/**
 * 洗净营地回来的名字：规则本身在 `Common.cleanText`（账号卡也要用，不能只住在这儿）。
 * 为什么要有这一层：营地偶尔在昵称里夹零宽空格、方向控制符（⁨⁩）或私用区方块码，
 * 直接贴进卡片要么变成一个方块，要么两个名字看着一模一样却对不上。
 *
 * @param {*} value 营地字段的原始值（字符串居多，也可能是数字、null、undefined）
 * @returns {string} 洗干净的字符串；什么都没剩下就给空串（不做「无名召唤师」兜底，那个归 normalizeName）
 */
export function cleanName (value) {
  return cleanText(value)
}

/**
 * 昵称兜底：洗干净还空着就写成「无名召唤师」，卡片上不出现空白标题。
 *
 * @param {*} value 营地字段的原始名字
 * @returns {string} 干净的名字；取不到给「无名召唤师」
 */
export function normalizeName (value) {
  return cleanName(value) || '无名召唤师'
}

/**
 * 角色名的兜底来源：绑定记录里常常只有 roleId（扫码绑定时写不进去名字），
 * 但营地主页读过的角色列表都缓存在 campRoles 里，从那儿把名字捞回来，
 * 免得群里出现一堆「无名召唤师」。
 *
 * @param {string} owner 发指令的 QQ（角色名缓存按 QQ 分桶存）
 * @param {string} roleId 营地角色 ID
 * @returns {string} 查到的角色名；两处缓存里都没有就给空串
 */
export function campRoleName (owner, roleId) {
  const key = toText(owner)
  const id = toText(roleId)
  if (!key || !id) return ''

  const cache = readUserPart(key, CAMP_ROLES_PART) || {}
  for (const entry of Object.values(cache)) {
    for (const role of Array.isArray(entry?.roles) ? entry.roles : []) {
      if (toText(role?.roleId) !== id) continue
      const name = cleanName(role?.roleName)
      if (name) return name
    }
  }

  /** 角色名单里没有（比如查的是别人的号）就翻名字表：那里只存名字，不代表任何归属 */
  const names = readUserPart(key, CAMP_ROLE_NAMES_PART) || {}
  return cleanName(names?.[id]?.roleName) || ''
}

/**
 * 现刷到角色名就记下来，下次绑定记录空名字时顶上。
 *
 * ⚠️ **只记名字，不动归属**。把角色顺手塞进「当时用的那个号」的桶里，就会
 * 查别人的角色时认领了别人的角色 → 角色名单被写脏 →
 * 「角色 → 营地号」算到陌生账号上 → 营地回 -1013/-10107 → 卡片一片「没查到」。
 * 归属只走 `rememberRoles`（账号自己主页读到的角色表）和 `rememberCampUser`（现查验证过的）。
 *
 * @param {string} owner 发指令的 QQ
 * @param {string} roleId 营地角色 ID
 * @param {object} [options] 这次读到的角色信息，可整体省略
 * @param {string} [options.roleName] 现刷到的角色名，空着就什么都不做
 * @param {string} [options.accountId] 在哪个登录信息下读到的（只作记录，不写归属）
 * @param {string} [options.serverName] 区服名，空着就沿用名字表里的旧值
 * @returns {boolean} 名字或区服确实变了并写进缓存给 true；名字为空、或跟缓存一模一样给 false
 */
export function rememberCampRoleName (owner, roleId, { roleName = '', accountId = '', serverName = '' } = {}) {
  const key = toText(owner)
  const id = toText(roleId)
  const name = cleanName(roleName)
  if (!key || !id || !name) return false

  const names = readUserPart(key, CAMP_ROLE_NAMES_PART)
  const table = names && typeof names === 'object' ? { ...names } : {}
  const old = table[id] || {}
  const server = toText(serverName) || toText(old.serverName)
  if (cleanName(old.roleName) === name && toText(old.serverName) === server) return false
  table[id] = { roleName: name, serverName: server, at: Date.now() }
  writeUserPart(key, CAMP_ROLE_NAMES_PART, table)

  /** 角色名单里本来就有这个角色，顺手把空着的名字/区服补上（不新增角色，不认领） */
  const cache = readUserPart(key, CAMP_ROLES_PART) || {}
  let touched = false
  const next = { ...cache }
  for (const [bucketId, bucket] of Object.entries(cache)) {
    const roles = Array.isArray(bucket?.roles) ? bucket.roles : []
    const index = roles.findIndex(role => toText(role?.roleId) === id)
    if (index < 0) continue
    const saved = roles[index]
    if (cleanName(saved?.roleName) && (!server || cleanName(saved.serverName) === cleanName(server))) continue
    next[bucketId] = {
      ...bucket,
      roles: roles.map((role, i) => (i === index
        ? { ...role, roleName: name, serverName: toText(server) || toText(role?.serverName) }
        : role))
    }
    touched = true
  }
  if (touched) writeUserPart(key, CAMP_ROLES_PART, next)
  return true
}
