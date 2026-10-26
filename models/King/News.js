/**
 * @file 公告资讯卡——营地公告列表与详情，翻页游标落缓存，详情按 id 记忆，避免同一篇反复取。
 * @module models/King/News
 */
import { kingReply, kingFail, kingGuard, kingLog } from './Say.js'
import { renderKing, logoUri, imageUris, timeText, pageInfo } from './Card.js'
import { fetchNewsList, fetchNewsDetail, PVP_NEWS_CHANNELS } from './External.js'
import { readCache, writeCache } from './Store.js'
import { toText } from './Common.js'

const log = kingLog

const PAGE_SIZE = 8
const CACHE_FILE = 'news-last.yaml'

function channelText (id) {
  return PVP_NEWS_CHANNELS[Number(id)] || ''
}

function plainText (html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

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

function remember (e, items, page = 0) {
  const key = String(e.user_id || e.group_id || 'default')
  const store = readCache(CACHE_FILE, {})
  store[key] = {
    at: Date.now(),
    page: Number(page) || 0,
    items: items.map(item => ({ id: item.id, title: item.title, time: item.time, channel: item.channel }))
  }
  const keys = Object.keys(store)
  if (keys.length > 40) {
    keys.sort((a, b) => (store[a]?.at || 0) - (store[b]?.at || 0))
    keys.slice(0, keys.length - 40).forEach(old => { delete store[old] })
  }
  writeCache(CACHE_FILE, store)
}

/**
 * 指令「王者公告 [页码|下一页|上一页]」：出版本公告列表卡（每页 PAGE_SIZE = 8 条）。
 * 最近一页的条目记在 news-last.yaml 里，供「#王者公告 3」按条号看正文。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<boolean>} 发出去了给 true；没权限、没更多公告、拉取失败时回一句话并给 false
 */
export async function kingNews (e) {
  if (!(await kingGuard(e))) return false

  /** 翻页：「#王者公告列表 2」直接点名页码，「#王者公告 下一页 / 上一页」按上一次看到的那页走 */
  const msg = String(e.msg)
  const asked = /(\d+)/.exec(msg.replace(/(列表|下一页|上一页|下页|上页)/g, ''))?.[1]
  const store = readCache(CACHE_FILE, {})
  const key = String(e.user_id || e.group_id || 'default')
  const last = Math.max(1, Number(store[key]?.page) || 1)
  let page = Math.max(1, Number(asked) || 1)
  if (!asked) {
    if (/下一页|下页/.test(msg)) page = last + 1
    else if (/上一页|上页/.test(msg)) page = Math.max(1, last - 1)
  }
  const start = (page - 1) * PAGE_SIZE

  try {
    const data = await fetchNewsList({ chanid: 1762, limit: PAGE_SIZE, start })
    if (!data.items.length) return kingReply(e, page > 1 ? '没有更多公告了' : '暂时没取到公告，稍后再试试')

    remember(e, data.items, page)

    const covers = await imageUris(data.items.map(item => item.cover), { limit: 4, width: 380, height: 216, quality: 80 })
    const info = pageInfo({ total: data.total, limit: PAGE_SIZE, start })

    await renderKing(e, 'news', {
      title: '王者荣耀 · 版本公告',
      logoSrc: logoUri(),
      channelName: '版本公告',
      total: data.total,
      genTime: new Date().toLocaleString('zh-CN', { hour12: false }),
      items: data.items.map((item, index) => ({
        index: start + index + 1,
        title: item.title,
        time: timeText(item.time),
        channelName: channelText(item.channel),
        cover: covers[index] || ''
      })),
      page: info.page,
      pages: info.pages,
      hasPrev: info.hasPrev,
      hasNext: info.hasNext
    })

    kingLog.info(`公告列表第 ${page} 页，共 ${info.pages} 页`)
    return true
  } catch (error) {
    return kingFail(e, error, '获取王者荣耀公告失败，稍后再试试')
  }
}

/**
 * 指令「王者公告 <条号>[-<页号>]」：出单篇公告卡（正文配图搬过来，太长自动分页）。
 * 渲染器没配或出图失败都退回纯文字，不让用户看到报错。
 *
 * @param {object} e 云崽消息事件对象
 * @returns {Promise<boolean>} 发出去了给 true；条号没给、编号过期、取正文失败时回一句话并给 false
 */
export async function kingNewsDetail (e) {
  if (!(await kingGuard(e))) return false

  /**
   * 续页写法是「条号-页号」（#王者公告3-2）：先把结尾的「-页号」摘下来，
   * 剩下的才是条号。这样「#王者公告-2」（只给了页号没给条号）会掉进用法提示，
   * 而空格写法「#王者公告3 2」还认。
   */
  const raw = String(e.msg)
  const pageSuffix = /\s*-\s*(\d+)\s*$/.exec(raw)
  const head = pageSuffix ? raw.slice(0, raw.length - pageSuffix[0].length) : raw
  const nums = head.match(/\d+/g) || []
  const index = Number(nums[0]) || 0
  const wantPage = Math.max(1, Number(pageSuffix?.[1] || nums[1]) || 1)
  if (index < 1) return kingReply(e, '用法：「#王者公告 3」看第 3 条；太长会分页，第 2 页发「#王者公告3-2」（条号-页号）')

  const key = String(e.user_id || e.group_id || 'default')
  const store = readCache(CACHE_FILE, {})
  const cached = store[key]?.items?.[index - 1]
  if (!cached) return kingReply(e, '这条公告的编号过期了，先发一次「#王者公告」再试')

  try {
    const detail = await fetchNewsDetail(cached.id)
    const content = plainText(detail.content)
    /** 正文与配图一起搬：配图拉不到就只出文字，不耽误看公告 */
    const urls = newsImages(detail.content)
    let images = []
    if (urls.some(item => toText(item?.url))) {
      try {
        images = await newsImageUris(urls)
      } catch (error) {
        log.info(`公告配图取失败，卡片只出文字：${toText(error?.message)}`)
      }
    }
    const body = portNewsBody(detail.content, images)

    /** 公告太长就切页：一张卡片只搬一页，不然图都生成不出来 */
    const pages = pageNewsBody(body || '这条公告没有正文')
    const total = pages.length
    const page = Math.min(wantPage, total)
    /** 回执里的续页写法一律用「条号-页号」，跟用户输入的空格写法区分开，省得看混 */
    const cmd = String(e.msg).replace(/[\d\s-]+$/, '').trim() || '#王者公告'

    const head = [
      `【${detail.title || cached.title}】`,
      [timeText(detail.time || cached.time), channelText(cached.channel)].filter(Boolean).join(' · ')
    ].filter(Boolean)

    const text = [...head, '', content || '这条公告没有正文'].join('\n')

    const carried = urls.length
      ? `正文与 ${images.filter(Boolean).length} 张配图照官网公告搬运，未做删减`
      : '正文照官网公告原样搬运，未做删减'
    const note = total > 1
      ? `${carried}；太长切成 ${total} 页，${page < total ? `发「${cmd}${index}-${page + 1}」看下一页` : '这是最后一页'}`
      : carried

    if (!e?.runtime?.render) return kingReply(e, text)

    try {
      return await renderKing(e, 'news-detail', {
        logoSrc: logoUri(),
        title: toText(detail.title) || toText(cached.title) || '王者荣耀公告',
        channelName: channelText(cached.channel),
        time: timeText(detail.time || cached.time),
        cover: toText(detail.cover),
        body: pages[page - 1] || '这条公告没有正文',
        pageText: total > 1 ? `第 ${page} / ${total} 页` : '',
        genTime: new Date().toLocaleString('zh-CN', { hour12: false }),
        note
      })
    } catch (error) {
      log.info(`公告详情卡片没出图，改用文字：${toText(error?.message)}`)
      return kingReply(e, text)
    }
  } catch (error) {
    return kingFail(e, error, '获取公告正文失败，稍后再试试')
  }
}
