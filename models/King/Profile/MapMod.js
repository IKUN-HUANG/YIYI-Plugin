/**
 * @file 主页 mod 列表的取用与拆分：按 modId / stype 找那一格，把「1234 / 5678」拆成主体与单位。
 *
 * @module models/King/Profile/MapMod
 */
import { toText } from '#yiyi.utils'
import { PROFILE_COMBAT_ID, PROFILE_COMBAT_STYPE } from './Consts.js'
import { cleanName, parseModParam } from './Names.js'

/**
 * 把「1234 / 5678」这种复合数值拆成主体与单位两段（模板要分开排版）
 *
 * @param {string} content mod 的文本，可能是复合数值
 * @returns {{main: string, unit: string}} `main` 是主体，`unit` 是后半段；不是复合数值时 `unit` 给空串
 */
export function splitStat (content) {
  const text = cleanName(content)
  const matched = text.match(/^(\d+(?:\.\d+)?)\s*([/.]\s*\d+(?:\.\d+)?.*)$/)
  if (!matched) return { main: text, unit: '' }
  return { main: matched[1], unit: matched[2].replace(/\s+/g, '') }
}

/**
 * 从主页 mod 列表里按 modId 取纯数字文本（战力、天数这类）
 *
 * @param {Array<object>} mods 主页的 mod 数组
 * @param {number} modId 要取的 mod id
 * @returns {string} 纯数字文本；没有或为 0 给空串
 */
export function modText (mods, modId) {
  const mod = mods.find(item => Number(item?.modId) === modId)
  const digits = cleanName(mod?.content).replace(/[^\d]/g, '')
  return digits && Number(digits) > 0 ? digits : ''
}

/**
 * 从主页 mod 列表里按 modId 取图标地址
 *
 * @param {Array<object>} mods 主页的 mod 数组
 * @param {number} modId 要取的 mod id
 * @returns {string} 图标地址；没有给空串
 */
export function modIcon (mods, modId) {
  const mod = mods.find(item => Number(item?.modId) === modId)
  return toText(mod?.icon)
}

/**
 * 把一个统计 mod 整理成卡片要的四件：名字、数值主体、单位、图标
 *
 * @param {object} mod 主页里的一个 mod 节点
 * @returns {{name: string, main: string, unit: string, icon: string}} 缺值用「—」
 */
export function statCell (mod) {
  const name = cleanName(mod?.name)
  const param = parseModParam(mod?.param1)
  const raw = cleanName(mod?.content) || cleanName(param?.desc) || cleanName(param?.content)
  const value = splitStat(raw || '—')
  return { name, main: value.main, unit: value.unit, icon: toText(mod?.icon) }
}

/**
 * 挑出战斗数据那一块 mod：先按 stype 认，认不出再按 modId 认
 *
 * @param {Array<object>} mods 主页的 mod 数组
 * @returns {object|null} 战斗数据 mod；都没有给 null
 */
export function pickCombat (mods) {
  return mods.find(item => Number(item?.stype) === PROFILE_COMBAT_STYPE) ||
    mods.find(item => Number(item?.modId) === PROFILE_COMBAT_ID) ||
    null
}

