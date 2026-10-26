/**
 * @file CHANGELOG.md → 帮助卡用的 HTML（只读文件，不写文件）。
 * @module models/Changelog
 *
 * 只做一件事：把 markdown 的**够用子集**（二～六级标题、无序列表、加粗、行内代码、链接）
 * 转成帮助卡能吃的 HTML。不引第三方 markdown 库：整份 CHANGELOG 就这几种写法，
 * 自己转一次比拖一个包进插件稳（部署目录是整目录替换，多一个依赖就多一处版本漂移）。
 *
 * 版本块切分靠 `## 1.2.3` 这类标题，`maxVer` 是「最多渲染最近几版」，
 * 卡面上只显示最近几版；调用方如果要做全量自检就传 `Number.MAX_SAFE_INTEGER`。
 */

import fs from 'node:fs'
import { createLogger } from '#yiyi.utils'

const log = createLogger('更新日志')

const HEADING_RE = /^(#{1,6})\s+(.+)$/
const ITEM_RE = /^\s*[-*]\s+(.+)$/
/** 版本块标题：`## 1.2.3`、`## [1.2.3]`、`## v1.2.3` 都算 */
const VERSION_HEAD_RE = /^##\s+(?:\[[^\]]+\]|[vV]?\d+(?:\.\d+)*)/
/** 版本标题里的版本号与日期：`[1.2.3] - 2026-10-25` */
const VERSION_TEXT_RE = /^\[?[vV]?([\d.]+)\]?(?:\s*[-–—]\s*(.+))?$/
/** 只有二级标题（`##`）才当版本块，其余标题只是普通标题 */
const VERSION_LEVEL = 2
const EMPTY_HTML = '<p class="md-empty">暂无更新日志</p>'
const FAIL_HTML = '<p class="md-empty">更新日志读取失败</p>'
const LINE_BREAK = '\n'

/**
 * 读 CHANGELOG.md，切出最近 `maxVer` 个版本并转成帮助卡 HTML。
 *
 * @param {string} file CHANGELOG.md 的绝对路径
 * @param {number} [maxVer=4] 最多渲染最近几个版本
 * @returns {string} 可直接塞进卡的 HTML；文件不在给「暂无更新日志」，读坏给「更新日志读取失败」
 */
export function loadChangelog (file, maxVer = 4) {
  if (!fs.existsSync(file)) return EMPTY_HTML

  try {
    const html = mdToHtml(recentBlocks(fs.readFileSync(file, 'utf8'), maxVer))
    return html || EMPTY_HTML
  } catch (error) {
    log.warn(`读不出 ${file}: ${error.message}`)
    return FAIL_HTML
  }
}

/**
 * 切出最近 `maxVer` 个版本块（含标题行），中间用空行隔开。
 *
 * @param {string} markdown CHANGELOG.md 原文
 * @param {number} [maxVer=4] 最多切几个版本块
 * @returns {string} markdown 片段；没有版本标题时给空串
 */
function recentBlocks (markdown, maxVer = 4) {
  const blocks = []
  let current = null
  let count = 0

  for (const line of String(markdown ?? '').split(LINE_BREAK)) {
    if (!VERSION_HEAD_RE.test(line)) {
      if (current) current.push(line)
      continue
    }

    if (current) blocks.push(current.join(LINE_BREAK))
    count += 1
    if (count > maxVer) return blocks.join(`${LINE_BREAK}${LINE_BREAK}`)
    current = [line]
  }

  if (current && count <= maxVer) blocks.push(current.join(LINE_BREAK))
  return blocks.join(`${LINE_BREAK}${LINE_BREAK}`)
}

/**
 * 只认够用的子集。列表**不嵌套**：一个条目只有一行，所以每个 `.md-ul` 的直接子元素
 * 恒为 `li`（帮助卡的 `li:last-child:nth-child(odd)` 据此算列宽，混进别的标签就会错位）。
 *
 * @param {string} markdown 局部 markdown 片段
 * @returns {string} HTML；空输入给空串
 */
function mdToHtml (markdown) {
  if (!markdown) return ''

  const out = []
  let inList = false
  const closeList = () => {
    if (!inList) return false
    out.push('</ul>')
    inList = false
    return true
  }

  for (const line of String(markdown).split(LINE_BREAK)) {
    if (!line.trim()) {
      closeList()
      continue
    }

    const heading = line.match(HEADING_RE)
    if (heading) {
      closeList()
      out.push(headingHtml(heading[1].length, heading[2].trim()))
      continue
    }

    const item = line.match(ITEM_RE)
    if (item) {
      if (!inList) {
        out.push('<ul class="md-ul">')
        inList = true
      }
      out.push(`<li>${inline(item[1])}</li>`)
      continue
    }

    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }

  closeList()
  return out.join(LINE_BREAK)
}

/**
 * 标题行转 HTML：二级标题额外拆出版本号与日期（卡面 `v1.2.3` + 日期靠右）。
 *
 * @param {number} level 标题级别 1~6
 * @param {string} text 标题文字
 * @returns {string} `<hN class="md-hN">…</hN>`
 */
function headingHtml (level, text) {
  const version = level === VERSION_LEVEL ? text.match(VERSION_TEXT_RE) : null
  if (!version) return `<h${level} class="md-h${level}">${escape(text)}</h${level}>`

  const date = version[2] ? `<span class="md-date">${escape(version[2].trim())}</span>` : ''
  return `<h${level} class="md-h${level}"><span class="md-ver">v${version[1]}</span>${date}</h${level}>`
}

/**
 * 行内标记转换：先转义再替换，顺序不能反（反了会把 `<strong>` 自己再转义一遍）。
 *
 * @param {string} text 一行 markdown
 * @returns {string} 行内 HTML
 */
function inline (text) {
  return escape(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
}

/**
 * HTML 转义，防止 CHANGELOG 里的尖括号被当标签。
 *
 * @param {string} text 原文
 * @returns {string} 转义后的文本
 */
function escape (text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
