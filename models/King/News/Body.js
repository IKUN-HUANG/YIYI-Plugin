/**
 * @file News模块的一片实现：正文清洗、配图抽取与图片地址。
 *
 * @module models/News/Body
 */
import { imageUris } from '../Card.js'
import { toText } from '../Common.js'
import { plainText } from './Util/Text.js'

/** 卡片内容区宽度，大横幅按这个缩 */
const NEWS_IMG_MAX = 660

/** 比这窄的算行内小图（标签 / 小徽章），保持原尺寸跟文字排 */
const NEWS_IMG_INLINE = 320

const NEWS_KEEP_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th'])

/** 官网的红字重点认出来；黑 / #323235 / windowtext 这些正文色直接丢掉 */
function newsRedClass (attrs) {
  const color = String(/color\s*:\s*([^;"]+)/i.exec(attrs || '')?.[1] || '').trim().toLowerCase()
  if (!color) return ''
  if (/red/.test(color)) return 'k-news-red'
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(color)?.[1]
  if (!hex) return ''
  const full = hex.length === 3 ? [...hex].map(ch => ch + ch).join('') : hex
  const [r, g, b] = [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16))
  return r > 140 && r > g * 1.6 && r > b * 1.6 ? 'k-news-red' : ''
}

/** 公告正文里先去掉注释、脚本、样式表：后面按 <img> 顺序配图，几处清洗必须完全一致 */
function newsClean (html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[\s\S]*?(<\/\1\s*>|$)/gi, '')
}

/**
 * 把官网公告正文搬进卡片：图片用 images（按正文出现顺序）里的 data URI 顶上，
 * 拉不到的图整张丢掉但下标照涨，后面的图不会串位。
 *
 * @param {string} html 官网公告正文 HTML（可以带脚本、内联样式）
 * @param {string[]} [images] 按正文 <img> 出现顺序排好的 dataURI（newsImageUris 的返回值）
 * @returns {string} 只留白名单标签（标题/段落/列表/表格/重点/红字）的卡片内 HTML；一张图都没配上时图标签整段消失；正文全是脚本这类怪东西时退回一段纯文字；都没有给空串
 */
export function portNewsBody (html, images = []) {
  let text = newsClean(html)

  let index = 0
  text = text.replace(/<img\b[^>]*>/gi, tag => {
    const uri = String(images[index] || '')
    const width = Number(/width\s*=\s*["']?(\d+)/i.exec(tag)?.[1]) || 0
    index += 1
    if (!uri) return ''
    const inline = width > 0 && width < NEWS_IMG_INLINE
    return `<img class="k-news-img${inline ? ' is-inline' : ''}" src="${uri}"${inline ? ` width="${width}"` : ''} alt="">`
  })

  text = text.replace(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g, (all, closing, rawName, attrs) => {
    const name = rawName.toLowerCase()
    if (name === 'img') return all
    if (name === 'br') return '<br>'
    if (NEWS_KEEP_TAGS.has(name)) return closing ? `</${name}>` : `<${name}>`
    if (name === 'strong' || name === 'b') return closing ? '</strong>' : '<strong>'
    if (name === 'em' || name === 'i') return closing ? '</em>' : '<em>'
    if (name === 'span') {
      if (closing) return '</span>'
      const red = newsRedClass(attrs)
      return red ? `<span class="${red}">` : '<span>'
    }
    /** 链接 / 下划线 / 字体标签：脱掉标签留文字 */
    return ''
  })

  text = text.replace(/<(p|h1|h2|h3|h4|h5|h6)\b[^>]*>([\s\S]*?)<\/\1>/gi, (all, rawTag, inner) => {
    const tag = rawTag.toLowerCase()
    const body = inner.trim()
    const plain = body.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').trim()
    const hasImg = /<img\b/i.test(body)
    /** 官网拿 &nbsp; 空段落当间距，卡片自己有段距 */
    if (!plain && !hasImg) return ''
    if (tag === 'p') return `<p class="k-news-p${plain ? '' : ' is-media'}">${body}</p>`
    const level = tag === 'h1' ? '1' : tag === 'h2' ? '2' : '3'
    return `<h${level} class="k-news-h${level}">${body}</h${level}>`
  })

  const ported = text
    .replace(/[ \t]*\r?\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (ported) return ported

  /** 正文全是脚本之类的怪东西时，退回纯文字（转义后放进段落里） */
  const plain = plainText(html)
  return plain ? `<p class="k-news-p">${plain.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch])}</p>` : ''
}

/**
 * 正文里配图的原始地址与标注宽度，按出现顺序（跟 portNewsBody 的下标一一对应）。
 *
 * @param {string} html 官网公告正文 HTML
 * @returns {Array<{url: string, width: number}>} 每张图一条：url 是原图地址，width 是标注宽度（像素，没标注给 0）；没有图给空数组
 */
export function newsImages (html) {
  return [...newsClean(html).matchAll(/<img\b[^>]*>/gi)].map(match => ({
    url: /\bsrc\s*=\s*["']([^"']+)["']/i.exec(match[0])?.[1] || '',
    width: Number(/\bwidth\s*=\s*["']?(\d+)/i.exec(match[0])?.[1]) || 0
  }))
}

/**
 * 正文配图：大横幅缩到卡片宽度并压成 JPEG（官网横幅多是带透明通道的大 PNG，
 * 原样搬进来一条公告能有十几 MB），行内小图标不动，保持原来的 PNG 透明底。
 *
 * @param {Array<{url: string, width: number}>} [items] newsImages 的返回值（行内小图按 width < NEWS_IMG_INLINE=320 判）
 * @returns {Promise<string[]>} 与入参等长等序的 dataURI 数组，拉不到的位子给空串；同一组最多取 4 张（limit: 4）
 */
export async function newsImageUris (items = []) {
  const list = Array.isArray(items) ? items : []
  const out = new Array(list.length).fill('')
  const small = []
  const big = []

  list.forEach((item, index) => {
    const url = toText(item?.url)
    if (!url) return
    const width = Number(item?.width) || 0
    if (width > 0 && width < NEWS_IMG_INLINE) small.push({ index, url })
    else big.push({ index, url })
  })

  const fill = async (group, opts) => {
    if (!group.length) return
    const uris = await imageUris(group.map(item => item.url), opts)
    group.forEach((item, i) => { out[item.index] = uris[i] || '' })
  }

  await Promise.all([
    fill(small, { limit: 4 }),
    fill(big, { limit: 4, width: NEWS_IMG_MAX, quality: 82, format: 'jpeg' })
  ])

  return out
}
