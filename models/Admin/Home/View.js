/**
 * @file `#伊伊设置` 的一片实现：设置面板的行数据。
 *
 * @module models/Admin/Home/View
 */

import { cmdOf } from './Shared.js'
import { SETTINGS } from './Consts.js'
import { currentValue, displayValue } from './Util.js'

/**
 * 模板要的 rows：label / value / state / desc / cmd / next，按 group 分桶。
 *
 * @param {string} [group] 只要这一组；不传则出全部（入口卡）
 * @returns {Array<{group: string, list: Array<object>}>} 分组后的行；每组 list 非空
 */
export function settingsGroups (group) {
  const groups = []

  for (const item of SETTINGS) {
    if (group && item.group !== group) continue

    let bucket = groups.find(g => g.group === item.group)
    if (!bucket) {
      bucket = { group: item.group, list: [] }
      groups.push(bucket)
    }

    const raw = currentValue(item.path, item.file)
    const empty = raw === '' || raw == null
    const shown = displayValue(item, raw, { empty: '（空）' })

    bucket.list.push({
      label: item.label,
      value: shown,
      state: item.type === 'bool' ? (raw !== false ? 'on' : 'off') : (item.mask ? (empty ? 'off' : 'on') : 'text'),
      desc: item.desc || '',
      cmd: cmdOf(item),
      next: item.type === 'bool'
        ? '开启/关闭'
        : (item.mask ? ` <${item.example || '新值'}>` : ` ${shown}`)
    })
  }

  return groups
}
