/**
 * @file News模块的一片实现：正文切块与按预算分页。
 *
 * @module models/News/Pages
 */
import { plainText } from './Util/Text.js'

/** 每页预算：正文字数，配图按 NEWS_COST_IMG 折算 */
const NEWS_PAGE_COST = 2400

const NEWS_COST_IMG = 520

/** 每页最多几张配图 */
const NEWS_PAGE_IMG = 4

/** 最多切成几页 */
const NEWS_PAGE_MAX = 12

const NEWS_VOID_TAGS = new Set(['img', 'br', 'hr'])

/**
 * 正文按顶层块切开：h / p / ul / table 各算一块，配图单独一块（块内不再切）。
 * 切块是分页的前提——正文再长也不能一股脑塞进一张卡片。
 *
 * @param {string} html 卡片内 HTML（portNewsBody 的产物）
 * @returns {string[]} 从上到下的块，每块一段 HTML；空块会被丢掉，没有内容给空数组
 */
export function newsBlocks (html) {
  const text = String(html || '')
  const blocks = []
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
  let depth = 0
  let start = 0
  let match = null

  while ((match = tagRe.exec(text))) {
    const closing = match[1] === '/'
    const name = match[2].toLowerCase()
    const lead = text.slice(start, match.index)

    if (NEWS_VOID_TAGS.has(name)) {
      if (depth === 0) {
        if (lead.trim()) blocks.push(lead.trim())
        blocks.push(match[0])
        start = tagRe.lastIndex
      }
      continue
    }

    if (!closing) {
      if (depth === 0) {
        if (lead.trim()) blocks.push(lead.trim())
        start = match.index
      }
      depth += 1
      continue
    }

    depth = Math.max(0, depth - 1)
    if (depth === 0) {
      blocks.push(text.slice(start, tagRe.lastIndex))
      start = tagRe.lastIndex
    }
  }

  const tail = text.slice(start).trim()
  if (tail) blocks.push(tail)
  return blocks.filter(block => block.trim())
}

/**
 * 把正文切成若干页，返回每页的 HTML 片段。
 * 单块超过一页预算的（超长表格之类）也自己占一页，不会被切碎。
 *
 * @param {string} html 卡片内 HTML（portNewsBody 的产物）
 * @returns {string[]} 逐页的 HTML 片段：正文按字数预算 NEWS_PAGE_COST=2400 累加、配图按 NEWS_COST_IMG=520 折算且每页最多 NEWS_PAGE_IMG=4 张；最多 NEWS_PAGE_MAX=12 页，多的截掉；传空串时给 ['']（总有一页）
 */
export function pageNewsBody (html) {
  const source = String(html || '')
  const pages = []
  let current = []
  let cost = 0
  let imgs = 0

  const flush = () => {
    if (!current.length) return
    pages.push(current.join(''))
    current = []
    cost = 0
    imgs = 0
  }

  for (const block of newsBlocks(source)) {
    const isImg = /^<img\b/i.test(block)
    const blockCost = isImg ? NEWS_COST_IMG : plainText(block).length + 60
    const overflow = cost > 0 && (cost + blockCost > NEWS_PAGE_COST || (isImg && imgs >= NEWS_PAGE_IMG))
    if (overflow) flush()
    current.push(block)
    cost += blockCost
    if (isImg) imgs += 1
  }
  flush()

  const list = pages.length ? pages : [source]
  return list.slice(0, NEWS_PAGE_MAX)
}
