/**
 * @file 视频、动态、专栏的解析：短链跟跳、网页 __INITIAL_STATE__ 与各接口的字段归拢
 * @module models/Link/Bilibili/Parse.js
 */

import { createLogger, formatDuration, formatTime, httpsify } from '#yiyi.utils'
import { biliJson, biliText } from './Request.js'
import { biliHeaders, buvid3 } from './Client.js'

const log = createLogger('B站')

const extractParas = ps => (ps || []).reduce((r, p) => {
  if (p.para_type === 1) r.text.push((p.text?.nodes || []).map(n => n.word?.words || '').join('').trim())
  if (p.para_type === 2) (p.pic?.pics || []).forEach(pic => pic.url && r.images.push(httpsify(pic.url)))
  return r
}, { text: [], images: [] })

async function parseVideo (bvid) {
  const v = (await biliJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)).data
  if (!v) throw new Error('B站视频信息获取失败')

  const [p, o] = await Promise.all([
    biliJson(`https://api.bilibili.com/x/player/playurl?avid=${v.aid}&cid=${v.cid}&qn=64&type=mp4&platform=html`),
    biliJson(`https://api.bilibili.com/x/player/online/total?aid=${v.aid}&cid=${v.cid}`)
  ])
  const d = p.data?.durl?.[0] || {}

  return {
    type: 'video',
    bvid,
    aid: v.aid,
    uid: v.owner.mid,
    title: v.title,
    cover: v.pic,
    desc: v.desc,
    author: v.owner.name,
    avatar: v.owner.face,
    like: v.stat.like,
    reply: v.stat.reply,
    collect: v.stat.favorite,
    share: v.stat.share,
    coin: v.stat.coin,
    danmaku: v.stat.danmaku,
    online: o.data?.total || 0,
    time: formatTime(v.ctime),
    res: `${v.dimension.width}x${v.dimension.height}`,
    dur: formatDuration(v.duration * 1000),
    video_url: d.url || '',
    video_size: d.size || 0
  }
}

async function parseOpusApi (id) {
  const r = await biliJson(
    `https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/detail?timezone_offset=-480&id=${id}`
  )
  const modules = r?.data?.item?.modules
  if (r?.code !== 0 || !modules?.length) throw new Error(r?.message || 'opus 接口无数据')
  return parseOpusState({ detail: { modules, basic: r?.data?.item?.basic } })
}

async function parseOpusHtml (id) {
  const url = String(id).startsWith('cv')
    ? `https://www.bilibili.com/read/${id}`
    : `https://www.bilibili.com/opus/${id}`

  /**
   * 正文在 window.__INITIAL_STATE__ 里，但 B站有的节点只回空壳（3KB 左右），两个节点交替命中：
   * 同一篇连着要三次，几乎每次都能拿到一份带正文的
   */
  let html = ''
  let m = null
  for (let i = 0; i < 3 && !m; i++) {
    html = await biliText(url)
    m = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\(function/)
    if (!m) log.warn(`页面只回了空壳（第 ${i + 1} 次，${html.length} 字节），再要一次`)
  }
  if (!m) throw new Error('页面只回了空壳，没拿到正文')

  let state = null
  try {
    state = JSON.parse(m[1])
  } catch (err) {
    log.warn(`页面数据解析失败：${err.message}`)
    throw new Error('页面数据解析失败')
  }
  if (state.readInfo) return parseArticleState(state)
  if (state.detail?.modules) return parseOpusState(state)
  throw new Error('未知页面类型')
}

function parseOpusState (state) {
  const m = state.detail.modules || []
  const find = t => m.find(x => x.module_type === t)
  const a = find('MODULE_TYPE_AUTHOR')?.module_author || {}
  const s = find('MODULE_TYPE_STAT')?.module_stat || {}
  const b = state.detail.basic || {}
  const { text, images } = extractParas(find('MODULE_TYPE_CONTENT')?.module_content?.paragraphs)
  const title = find('MODULE_TYPE_TITLE')?.module_title?.text || text[0] || '动态'

  return {
    type: 'article',
    uid: a.mid,
    comment_oid: b.comment_id_str || '',
    comment_type: b.comment_type ?? 11,
    title,
    desc: title === text[0] ? text.slice(1).join('\n') : text.join('\n'),
    cover: images[0] || '',
    author: a.name || '',
    avatar: httpsify(a.face || ''),
    like: s.like?.count || 0,
    reply: s.comment?.count || 0,
    collect: s.favorite?.count || 0,
    time: formatTime(a.pub_ts),
    images
  }
}

function parseArticleState (state) {
  const ri = state.readInfo || {}
  const a = ri.author || {}
  const s = ri.stats || {}
  const { images } = extractParas(ri.opus?.content?.paragraphs)

  if (!images.length) {
    const re = /<img[^>]+src="([^"]+)"/g
    let m
    while ((m = re.exec(ri.content || ''))) images.push(m[1].startsWith('//') ? 'https:' + m[1] : m[1])
  }

  return {
    type: 'article',
    uid: a.mid,
    comment_oid: String(ri.id || ''),
    comment_type: 12,
    title: ri.title || '专栏',
    desc: ri.summary || '',
    cover: ri.banner_url || images[0] || '',
    author: a.name || '',
    avatar: httpsify(a.face || ''),
    like: s.like || 0,
    reply: s.reply || 0,
    collect: s.favorite || 0,
    time: formatTime(ri.publish_time),
    images
  }
}

/** 短链只取一次跳转，省掉一整轮网页请求 */
async function followShort (url) {
  const res = await fetch(url, { headers: biliHeaders(await buvid3()), redirect: 'manual' })
  return res.headers.get('location') || ''
}

/**
 * 解析 B站链接：BV 号走视频接口，cv 号 / opus 号走专栏与动态（接口拿不到就退回网页解析）。
 * 短链只取一次跳转，别把整页拉下来。
 *
 * @param {string} u 链接、BV 号或 cv 号
 * @returns {Promise<object>} 统一取数结果（`type` 为 `video` 或 `article`）
 * @throws {Error} 无效链接、短链解析失败、接口与网页都拿不到数据
 */
async function parseBili (u) {
  let bvid = u.match(/BV[A-Za-z0-9]+/)?.[0]
  let cv = u.match(/cv([0-9]+)/)?.[1]
  let opus = u.match(/opus\/([0-9]+)/)?.[1]

  if (!bvid && !cv && !opus) {
    const short = u.match(/(?:b23\.tv|bili2233\.cn)\/[A-Za-z0-9]+/)?.[0]
    if (!short) throw new Error('无效B站链接')
    const loc = await followShort(`https://${short}`)
    bvid = loc.match(/BV[A-Za-z0-9]+/)?.[0]
    cv = loc.match(/cv([0-9]+)/)?.[1]
    opus = loc.match(/opus\/([0-9]+)/)?.[1]
    if (!bvid && !cv && !opus) throw new Error('短链解析失败')
  }

  if (opus) {
    try {
      return await parseOpusApi(opus)
    } catch (err) {
      log.warn(`opus 接口失败，改用网页解析：${err.message}`)
      return await parseOpusHtml(opus)
    }
  }
  return cv ? await parseOpusHtml('cv' + cv) : await parseVideo(bvid)
}

/** 对外出口：extractParas、parseVideo、parseOpusApi、parseOpusHtml、parseOpusState、parseArticleState、followShort、parseBili */
export { extractParas, parseVideo, parseOpusApi, parseOpusHtml, parseOpusState, parseArticleState, followShort, parseBili }
