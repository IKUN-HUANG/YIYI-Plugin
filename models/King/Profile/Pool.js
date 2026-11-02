/**
 * @file 角色名单的池化：把「当前角色 + 其它角色」排成一份可展示的顺序，隐藏的剔掉。
 *
 * @module models/King/Profile/Pool
 */
import { toText } from '#yiyi.utils'
import { cleanName } from './Names.js'

/**
 * 一批角色 → 卡片和文字里共用的编号池：按出现顺序从 1 重新编号，同一个角色 ID 只留一个，
 * 顺手标出当前卡片用的是哪个。编号就是用户发「#王者切换角色n」时那个 n。
 *
 * @param {Array<object>} roles 角色数组（营地或缓存给的，认 roleId / roleName / serverName / roleLevel）
 * @param {string} currentId 当前卡片用的角色 ID，用来打 `current` 标记
 * @returns {Array<object>} `{index, roleId, roleName, serverName, roleLevel, accountId, accountTag, current}` 组成的数组
 */
export function rolePool (roles, currentId) {
  const seen = new Set()
  const pool = []
  for (const item of Array.isArray(roles) ? roles : []) {
    const roleId = toText(item?.roleId)
    if (!roleId || seen.has(roleId)) continue
    seen.add(roleId)
    pool.push({
      index: pool.length + 1,
      roleId,
      roleName: cleanName(item.roleName) || '召唤师',
      serverName: toText(item.serverName) || toText(item.areaName),
      roleLevel: toText(item.roleLevel) || toText(item.gameLevel),
      accountId: toText(item.accountId),
      accountTag: toText(item.accountTag),
      current: roleId === toText(currentId)
    })
  }
  return pool
}
