/**
 * @file `#伊伊设置` 的一片实现：读值、脱敏、展示、别名匹配。
 *
 * @module models/Admin/Home/Util
 */

import { Config } from '#yiyi.components'
import { ON, OFF } from './Shared.js'
import { SETTINGS, GROUP_CMDS } from './Consts.js'

/**
 * 把「开 / 开启 / 关 / 关闭」这类口语写法翻成布尔。
 *
 * @param {string} text 用户写的那一段，允许空
 * @returns {boolean|null} 认不出来回 null，由调用方去发用法回执
 */
export function boolValue (text) {
  const word = String(text ?? '').trim().toLowerCase()
  if (ON.includes(word)) return true
  if (OFF.includes(word)) return false
  return null
}

/**
 * 按别名找分组卡。
 *
 * @param {string} word 正则里 $(GROUP_CMDS.map...) 捕获到的那一段
 * @returns {object|null} 没这一组回 null
 */
export function findGroupCmd (word) {
  return GROUP_CMDS.find(g => g.alias === word) || null
}

/**
 * 入口卡要的分组索引。
 *
 * @returns {Array<object>} 每组一条，count 是该组的项数
 */
export function groupIndex () {
  return GROUP_CMDS.map(g => ({ ...g, count: SETTINGS.filter(item => item.group === g.group).length }))
}

/**
 * 按路径读当前值。
 *
 * @param {Array<string>} keys 配置键路径
 * @param {string} [file] 哪个配置文件：`config`（默认）或 `king`
 * @returns {*} 读不到回 undefined（中间断链也当 undefined）
 */
export function currentValue (keys, file = 'config') {
  return keys.reduce((acc, key) => (acc == null ? acc : acc[key]), Config.getDefOrConfig(file))
}

/**
 * 敏感项（Cookie / 接口地址）只报「是否配置」，绝不把内容亮到群里。
 *
 * @param {object} item SETTINGS 里的那一项
 * @param {*} value 当前值
 * @returns {string|null} 非敏感项回 null；敏感项回「已配置X / 未配置X」
 */
export function maskedValue (item, value) {
  if (!item.mask) return null
  const word = item.maskWord || 'API'
  return value === '' || value == null ? `未配置${word}` : `已配置${word}`
}

/**
 * 把值翻成给人看的一行；敏感项走 maskedValue，布尔写「开启 / 关闭」。
 *
 * @param {object} item SETTINGS 里的那一项
 * @param {*} value 当前值
 * @param {{empty?: string}} [opts] 空值显示成什么，默认「空」
 * @returns {string} 给人看的那一行
 */
export function displayValue (item, value, { empty = '空' } = {}) {
  const masked = maskedValue(item, value)
  if (masked) return masked
  if (item.type === 'bool') return value !== false ? '开启' : '关闭'
  if (Array.isArray(value)) return value.join('、') || empty
  if (item.allowEmpty && (value === '' || value == null)) return item.emptyText || empty
  return value === '' || value == null ? empty : String(value)
}

/**
 * `#伊伊设置抖音解析关` → `抖音解析关`。
 *
 * @param {string} msg 整条消息
 * @returns {string} 前缀之外的部分（可能是空串，代表用户只想看入口卡）
 */
export function settingRest (msg) {
  return (/^#?(?:伊伊|YIYI)(?:设置|配置|admin)([\s\S]*)$/.exec(String(msg ?? ''))?.[1] ?? '').trim()
}

/**
 * 按别名认设置项，最长别名优先 ——「插件更新间隔」不能被「插件更新」抢走。
 *
 * @param {string} rest 前缀之外的整段
 * @returns {{item: object, value: string}|null} 没认出来回 null
 */
export function matchSetting (rest) {
  const raw = String(rest ?? '')
  let hit = null

  for (const item of SETTINGS) {
    for (const alias of item.alias) {
      if (raw.slice(0, alias.length).toLowerCase() !== alias.toLowerCase()) continue
      if (!hit || alias.length > hit.len) hit = { item, len: alias.length }
    }
  }

  if (!hit) return null
  const value = raw.slice(hit.len).replace(/^[\s=:：,，]+/, '').trim()
  return { item: hit.item, value }
}
