/**
 * @file `#伊伊设置` 的一片实现：带独立命令的列表项（详情后缀 / 禁用表情 / 反制 / 反制表情）的别名正则与查表。
 *
 * @module models/Admin/Home/Cmd
 */

import { SETTINGS } from './Consts.js'

/** 有独立命令的列表项（详情后缀 / 禁用表情 / 反制 / 反制表情）：它们有自己的一条规则 */
const LIST_SETTINGS = SETTINGS.filter(item => item.cmd)

const LIST_ALIASES = LIST_SETTINGS.flatMap(item => item.alias).sort((a, b) => b.length - a.length)

/** `#伊伊禁用表情 摸头` 这类带独立命令的列表项；别名一样最长优先 */
export const LIST_CMD_RE = new RegExp(`^#?(?:伊伊|YIYI)(${LIST_ALIASES.join('|')})([\\s\\S]*)$`)

/**
 * 按别名找带独立命令的列表项。
 *
 * @param {string} label LIST_CMD_RE 捕获到的那一段
 * @returns {object|null} 没这一项回 null
 */
export function findListCmd (label) {
  return LIST_SETTINGS.find(item => item.alias.includes(label)) || null
}
