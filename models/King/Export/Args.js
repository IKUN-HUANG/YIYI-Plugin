/**
 * @file 指令参数解析：剥掉指令头、取天数与营地ID筛选
 * @module models/King/Export/Args.js
 */

import { ARCHIVE_KEEP_DAYS } from '../Archive.js'
import { toText } from '../Common.js'

/** 指令头（`#王者导出战绩 7` 里要去掉的那些词） */
const HEAD_WORDS = [
  '营地导出战绩', '王者营地导出战绩', '导出战绩', '战绩导出', '导出csv', '导出excel', '导出',
  '王者荣耀', '王者农药', '王者'
]

function stripHead (input) {
  let out = toText(input).replace(/^#+/, '').trim()

  for (let guard = 0; guard < 8; guard += 1) {
    const hit = HEAD_WORDS.find(word => out.toLowerCase().startsWith(word.toLowerCase()))
    if (!hit) break
    out = out.slice(hit.length).trim()
  }

  return out
}

/**
 * 解析 `#王者导出战绩 [营地ID|天数|全部]` 的参数（纯函数，闸门直接调）。
 *
 * 口径与上游一致，且**与顺序无关**：
 *   · 5 位以上纯数字 = 营地ID（当标签用，也用于挑归档）
 *   · 1~4 位纯数字 = 天数（超过 ARCHIVE_KEEP_DAYS 按归档上限截断；`7天` / `7日` 也认）
 *   · `全部` / `所有` / `all` / `0天` = 归档里的全部场次
 *   · 认不出来的词丢掉，不报错（用户常常顺手打「近7天战力」之类）
 *
 * @param {string} input 原始指令文本（含 `#` 也行）
 * @returns {{campId: string, days: number, all: boolean, ignored: string[]}}
 */
export function parseExportArgs (input = '') {
  const tokens = stripHead(input).split(/[\s,，、/|]+/).filter(Boolean)

  let campId = ''
  let days = 0
  let all = false
  const ignored = []

  for (const raw of tokens) {
    const token = toText(raw).replace(/^[@＠]/, '')
    if (!token) continue

    const lower = token.toLowerCase()
    if (/^(全部|所有|全量|不限|all|\*)$/.test(lower)) {
      all = true
      continue
    }

    const digits = lower.replace(/(天|日|days?|d)$/, '')
    if (!/^\d+$/.test(digits)) {
      ignored.push(token)
      continue
    }

    if (digits.length >= 5) {
      if (campId) ignored.push(token)
      else campId = digits
      continue
    }

    const num = Number(digits)
    if (num > 0) days = Math.min(num, ARCHIVE_KEEP_DAYS)
    else all = true
  }

  if (all) days = 0
  return { campId, days, all, ignored }
}
