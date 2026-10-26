/**
 * @file 表情包 · 识别（纯逻辑）
 * @module models/Memes/lookup
 *
 * 一条群消息到底是哪个表情、后面跟的是文案还是参数、里面有没有 QQ 号 —— 全在这里算。
 * 算完交给 apps/Memes.js 去取图：这里不发请求、不写文件、不出图。
 */
import { createLogger, qqAllRe } from '#yiyi.utils'
import { Config } from '#yiyi.components'
import { loadMemeData, memeParams, isMemeDisabled } from './store.js'
import { memeArgHints } from './args.js'

const log = createLogger('表情包')

/** 关键词最长的合理长度：再长就不像在叫表情了，是普通聊天 */
const MEME_LOOKUP_MAX = 60

/** 同一个人最近处理过的消息 id（防重复回复；接口重投同一张图时会撞） */
const HANDLED_KEEP = 3
const handled = new Map()

/**
 * 文案尾部「摘 QQ 号」：带图表情支持「摸头 123456」这种顺手 @ 的数字。
 * 只在第一个 `#`/`|` 之前找，参数区里的数字是参数，不是人。
 */
function cutTailQqs (tail) {
  const textPart = String(tail || '').split(/[#|]/)[0]
  const hits = [...textPart.matchAll(qqAllRe())]
  if (!hits.length) return null

  const qqs = [...new Set(hits.map(m => m[0]))]
  let rest = tail
  for (const m of [...hits].reverse()) rest = rest.slice(0, m.index) + rest.slice(m.index + m[0].length)

  return { qqs, rest }
}

/**
 * 消息 → 表情调用。长关键词优先（「摸头亲亲」比「摸头」贴得准），大小写不敏感但保留用户写法；
 * 关键词后面直接粘字算不算一次调用，看这个表情要不要文案以及后缀是不是白名单里的「详情」之类。
 *
 * @param {string} msg 群消息原文（未去前缀，本函数自己按关键词匹配）
 * @returns {{code: string, keyword: string, args: Record<string, string>, raw: string, qqs: string[]}|null} 命中返回调用信息；不是叫表情回 null
 */
export function lookupMeme (msg) {
  const { keyMap, lower, keys, lowerKeys } = loadMemeData()
  const text = String(msg ?? '').trim().replace(/^#/, '')
  if (!text || text.length > MEME_LOOKUP_MAX) return null

  const plain = text.toLowerCase()
  let keyword = keys.find(key => text.startsWith(key)) || null

  const loose = lowerKeys.find(item => plain.startsWith(item.low))
  if (loose && (!keyword || loose.low.length > keyword.toLowerCase().length)) keyword = loose.key

  if (!keyword) return null

  const code = keyMap[keyword] || keyMap[lower.get(keyword.toLowerCase())]
  if (!code || isMemeDisabled(code)) return null

  const params = memeParams(code) || {}
  const rest = text.slice(keyword.length)
  const tail = rest.trim()
  const separated = !tail || /^[\s/#|]/.test(rest) ||
    (params.min_texts || 0) >= 1 ||
    (Config.memesDetailArgs || []).includes(tail)

  const cut = (params.max_images || 0) > 0 ? cutTailQqs(tail) : null
  if (!separated && !cut) return null

  const raw = cut ? cut.rest.trim() : tail
  return { code, keyword, args: raw.replace(/^[#|]+/, ''), raw, qqs: cut ? cut.qqs : [] }
}

/**
 * 文字版详情（不带图），给「详情」后缀在没有图片通道时兜底。
 *
 * @param {string} code 表情代码
 * @returns {string} 多行文字详情；未知代码回空串
 */
export function memeDetail (code) {
  const { infos } = loadMemeData()
  const info = infos[code]
  if (!info) return `未找到表情「${code}」`

  const p = memeParams(code) || {}
  const keywords = info.keywords || []
  const lines = [
    `「${keywords[0] || code}」表情详情`,
    `代码：${code}`,
    `关键词：${keywords.join('、') || code}`,
    `图片数量：${p.min_images ?? 0} ~ ${p.max_images ?? 0}`,
    `文本数量：${p.min_texts ?? 0} ~ ${p.max_texts ?? 0}`
  ]

  if (p.default_texts?.length) lines.push(`默认文本：${p.default_texts.join('、')}`)

  const hints = memeArgHints(code, keywords[0] || code)
  if (hints.length) {
    lines.push('可调参数：')
    for (const hint of hints) {
      const extra = [hint.values ? `（${hint.values}）` : '', hint.desc].filter(Boolean).join(' ')
      lines.push(`  ${hint.example}${extra ? ` ${extra}` : ''}`)
    }
  }

  lines.push(`用法：发送「${keywords[0] || code}」并附带图片 / 文字`)

  return lines.join('\n')
}

/**
 * 接口上的预览图地址：本地没落盘时当兜底，省一次生成。
 *
 * @param {string} code 表情代码
 * @returns {string} 预览图 URL；接口没配或码不认识回空串
 */
export function memePreviewUrl (code) {
  return `${Config.memesApiUrl}/memes/${code}/preview`
}

/**
 * 同一条消息是不是刚处理过（接口重投同一张图时会撞，撞了就别再回一遍）。
 *
 * @param {string|number} userId QQ 号
 * @param {string|number} msgId 消息 id
 * @returns {boolean} true = 重投，跳过
 */
export function isMemeRepeated (userId, msgId) {
  if (!msgId) return false
  return (handled.get(String(userId)) || []).includes(String(msgId))
}

/**
 * 记下「这个人刚处理过这条消息」，只留最近几条，不会无限涨内存。
 *
 * @param {string|number} userId QQ 号
 * @param {string|number} msgId 消息 id
 * @returns {void} 无返回值
 */
export function markMemeHandled (userId, msgId) {
  if (!msgId) return
  const key = String(userId)
  const list = (handled.get(key) || []).filter(id => id !== String(msgId))
  list.push(String(msgId))
  handled.set(key, list.slice(-HANDLED_KEEP))
  if (handled.size > 500) handled.delete(handled.keys().next().value)
}
