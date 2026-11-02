/**
 * @file `#伊伊设置` 的一片实现：校验入参、按类型落盘、生成回执。
 *
 * @module models/Admin/Home/Flow
 */

import { Config } from '#yiyi.components'
import { splitList, normClock } from '#yiyi.utils'
import { cmdOf, CLEAR_WORDS, LIST_DEL_HEADS, LIST_ADD_HEADS } from './Shared.js'
import { boolValue, currentValue, displayValue } from './Util.js'

/**
 * 列表项的一次改动：加 / 删 / 清空 / 已经有了。
 *
 * @param {object} item SETTINGS 里的列表项
 * @param {string} value 用户写的原文（可能带 + / - 前缀）
 * @param {Array<string>} [current] 现在的值，默认现读配置
 * @returns {{ok: boolean, value?: Array<string>, action?: string, items?: Array<string>, reason?: string}}
 *   ok:false 时 reason 直接发进群
 */
export function resolveListValue (item, value, current = currentValue(item.path, item.file)) {
  const now = Array.isArray(current) ? current : []
  const text = String(value ?? '').trim()

  if (CLEAR_WORDS.includes(text.toLowerCase())) return { ok: true, value: [], action: 'clear', items: [...now] }

  let action = 'add'
  let body = text
  const delHead = LIST_DEL_HEADS.find(head => text.startsWith(head))
  const addHead = LIST_ADD_HEADS.find(head => text.startsWith(head))
  if (delHead) {
    action = 'del'
    body = text.slice(delHead.length)
  } else if (addHead) {
    body = text.slice(addHead.length)
  }

  const items = splitList(body)
  if (!items.length) {
    return { ok: false, reason: `「${item.label}」要填内容，例：${item.example ? `${cmdOf(item)} ${item.example}` : `${cmdOf(item)} 值`}` }
  }

  if (action === 'del') {
    const gone = items.filter(v => now.includes(v))
    if (!gone.length) {
      return { ok: false, reason: `「${item.label}」里没有 ${items.join('、')}（现在：${now.join('、') || '空'}）` }
    }
    return { ok: true, value: now.filter(v => !items.includes(v)), action, items: gone }
  }

  const fresh = items.filter(v => !now.includes(v))
  if (!fresh.length) return { ok: true, value: now, action: 'have', items }

  return { ok: true, value: [...now, ...fresh], action, items: fresh }
}

/**
 * 按 type 校验后写回 config.yaml。
 *
 * @param {object} item SETTINGS 里的那一项
 * @param {*} value 用户写的原文
 * @returns {{ok: boolean, value?: *, action?: string, items?: Array<string>|null, reason?: string}}
 *   ok:false 时 reason 直接发进群；action 为 set / clear / add / del / have
 */
export function writeSetting (item, value) {
  let action = 'set'
  let items = null

  if (item.type === 'bool') {
    const flag = boolValue(value)
    if (flag === null) return { ok: false, reason: `${item.label} 只能填 开启 / 关闭（也可以只写 开 / 关）` }
    value = flag
  } else if (item.type === 'enum') {
    if (!item.values.includes(value)) return { ok: false, reason: `${item.label} 只能填 ${item.values.join(' / ')}` }
  } else if (item.type === 'number') {
    if (item.allowEmpty && CLEAR_WORDS.includes(String(value ?? '').trim().toLowerCase())) {
      Config.setYaml(item.file || 'config', item.path, '')
      return { ok: true, value: '', action: 'clear' }
    }
    const num = Number(value)
    if (!Number.isFinite(num)) return { ok: false, reason: `${item.label} 需要填数字` }
    if (item.min != null && num < item.min) return { ok: false, reason: `${item.label} 不能小于 ${item.min}` }
    if (item.max != null && num > item.max) return { ok: false, reason: `${item.label} 不能大于 ${item.max}` }
    value = num
  } else if (item.type === 'time') {
    const clock = normClock(value)
    if (!clock) return { ok: false, reason: `${item.label} 要填 HH:MM，例：${item.example || '02:30'}` }
    value = clock
  } else if (item.type === 'list') {
    const ret = resolveListValue(item, value)
    if (!ret.ok) return ret
    value = ret.value
    action = ret.action
    items = ret.items
  } else if (item.type === 'text') {
    const text = String(value ?? '').trim()
    if (CLEAR_WORDS.includes(text.toLowerCase())) {
      value = ''
      action = 'clear'
    } else {
      value = text
    }
  }

  Config.setYaml(item.file || 'config', item.path, value)
  return { ok: true, value, action, items }
}

/**
 * 只写了项目名没写值 → 教怎么用。
 *
 * @param {object} item SETTINGS 里的那一项
 * @returns {string} 多行用法文本（含当前值）
 */
export function settingUsage (item) {
  const cmd = cmdOf(item)
  const now = displayValue(item, currentValue(item.path, item.file))

  if (item.type === 'bool') {
    return [
      '用法：',
      `${cmd}开启　/　${cmd}关闭　→ 也可以只写 开 / 关`,
      `当前值：${now}`
    ].join('\n')
  }

  if (item.type === 'list') {
    return [
      '用法：',
      `${cmd} ${item.example || '值1,值2'}　→ 添加（逗号分隔可加多个）`,
      `${cmd}-${item.example || '值'}　→ 删除`,
      `${cmd}清空　→ 全部清掉`,
      `当前值：${now}`
    ].join('\n')
  }

  if (item.type === 'text') {
    return [
      '用法：',
      `${cmd}<${item.example || '值'}>　→ 设置`,
      `${cmd}清空　→ 清空（回到默认）`,
      `当前值：${now}`
    ].join('\n')
  }

  if (item.allowEmpty) {
    return [
      '用法：',
      `${cmd}<值>　→ 设置`,
      `${cmd}清空　→ ${item.emptyText || '用默认值'}`,
      `当前值：${now}`
    ].join('\n')
  }

  return `用法：${cmd}<值>\n当前值：${now}`
}

/**
 * 改完之后的文字回执（面板出得来时不用它，出不来才兜这一句）。
 *
 * @param {object} item SETTINGS 里的那一项
 * @param {*} value 改完之后的值
 * @param {{action?: string, items?: Array<string>|null}} [state] writeSetting 的结果
 * @returns {string} 一行回执
 */
export function settingApplied (item, value, { action = 'set', items = null } = {}) {
  const text = displayValue(item, value)

  if (action === 'clear') {
    return item.allowEmpty
      ? `已清空「${item.label}」，现在${item.emptyText || '用默认值'}`
      : `已清空「${item.label}」（现在是空的）`
  }
  if (action === 'have') return `「${item.label}」里已经有 ${items.join('、')} 了（现在：${text}）`
  if (action === 'add' || action === 'del') {
    const verb = action === 'add' ? '添加' : '删除'
    return `已${verb}「${item.label}」：${items.join('、')}（现在：${text}）`
  }

  const act = Array.isArray(value) && !value.length ? '清空' : '设置'
  return `已${act}「${item.label}」：${text}${item.restart ? '，重启后生效' : ''}`
}
