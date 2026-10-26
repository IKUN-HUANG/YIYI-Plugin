/**
 * @file B站适配：链接识别、取数、wbi 签名、buvid3 会话、评论分页、内嵌视频代理。
 * @module models/Link/Bilibili.js
 */
import { createHash } from 'node:crypto'
import http from 'node:http'
import { Config } from '#yiyi.components'
import { createLogger, formatDuration, formatTime, httpsify, mbSize } from '#yiyi.utils'
import { COMMENT_FETCH, COMMENT_PAGES, collectCommentPages, commentFailReason } from './Comments.js'
import { sendImages, sendOverSize } from '../Message.js'
import { HTTP_TIMEOUT, HTTP_TIMEOUT_FAST, timeoutSignal } from './http.js'

const log = createLogger('B站')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const H = {
  'User-Agent': UA,
  'Referer': 'https://www.bilibili.com/',
  'Accept-Language': 'zh-CN,zh;q=0.9'
}
/** buvid3 缓存 6 小时；换新的一次性清掉 */
const BUVID_TTL = 6 * 3600 * 1000
let buvidCache = { value: '', at: 0 }

/** 分享页与接口共用的请求头：在 H 的基础上把 buvid3 塞进 Cookie。
 * 纯函数、不带状态，闸门的离线验证直接调它。
 *
 * @param {string} buvid buvid3 的值
 * @returns {object} fetch 用的请求头
 */
export function biliHeaders (buvid) {
  return { ...H, Cookie: `buvid3=${buvid}` }
}

/** 本地生成的 buvid3：形状和真的一致，接口只认这个 key 在不在，不校验值 */
function localBuvid () {
  const hex = n => createHash('md5').update(`${Date.now()}-${Math.random()}-${n}`).digest('hex').slice(0, n).toUpperCase()
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}${Math.floor(Math.random() * 1e6)}infoc`
}

/** 向 B站要一个真 buvid3，拿不到就本地生成一个顶上 */
async function buvid3 (force = false) {
  if (!force && buvidCache.value && Date.now() - buvidCache.at < BUVID_TTL) return buvidCache.value

  let value = ''
  try {
    const res = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: H,
      signal: timeoutSignal(HTTP_TIMEOUT_FAST)
    })
    value = JSON.parse(await res.text())?.data?.b_3 || ''
  } catch (err) {
    log.warn(`拿 buvid3 失败，先本地生成一个顶上：${err.message}`)
  }
  buvidCache = { value: value || localBuvid(), at: Date.now() }
  return buvidCache.value
}

/** 把「状态码 + 原始返回」翻成人话：风控 / 拒绝 / 网页 / 状态码
 *
 * @param {number} status
 * @param {string} [body='']
 * @returns {string}
 */
export function explainBiliStatus (status, body = '') {
  if (status === 412) return 'B站风控拦住了（HTTP 412），过几分钟再发一次'
  if (status === 403) return 'B站拒绝访问（HTTP 403），换个网络再试'
  if (/^\s*</.test(String(body))) return 'B站返回的是网页不是数据（多半被风控拦了）'
  return `B站接口返回 HTTP ${status}`
}

/**
 * 唯一的取数通道：带 buvid3，412/403 换新的重试一次，HTML 绝不当 JSON 硬解。
 * buvid / refresh 可注入，闸门拿它做离线验证，不走网络。
 *
 * @param {string} url
 * @param {object} [params={}] 各项见下
 * @param {boolean} [params.retry] 连不上时要不要换新凭据再试一次
 * @param {number} [params.timeout] 单次请求超时（ms）
 * @param {string} [params.redirect] 'manual' 表示自己处理跳转，不自动跟随
 * @param {string} [params.buvid] 指定的 buvid3；不传就自己取一个
 * @param {Function} [params.refresh] 取不到时换新 buvid3 的回调
 * @returns {Promise<unknown>}
 */
export async function biliJson (url, { retry = true, timeout = HTTP_TIMEOUT, redirect, buvid, refresh } = {}) {
  const once = async seed => {
    const res = await fetch(url, {
      headers: biliHeaders(seed),
      redirect,
      signal: timeoutSignal(timeout)
    })
    return { res, text: await res.text() }
  }

  let one = await once(buvid || await buvid3())
  if (retry && (one.res.status === 412 || one.res.status === 403)) {
    log.warn(`接口 ${one.res.status}，换一个新的 buvid3 再试一次`)
    one = await once(await (refresh ? refresh() : buvid3(true)))
  }
  if (!one.res.ok) throw new Error(explainBiliStatus(one.res.status, one.text))
  try {
    return JSON.parse(one.text)
  } catch (err) {
    log.warn(`接口回了非 JSON（${one.text.length} 字节）：${err.message}`)
    throw new Error(explainBiliStatus(one.res.status, one.text))
  }
}

/** 要网页源码的接口（图文页）：同一套 buvid3 门，只是不进 JSON 解析 */
async function biliText (url, { timeout = HTTP_TIMEOUT } = {}) {
  const once = seed => fetch(url, {
    headers: biliHeaders(seed),
    signal: timeoutSignal(timeout)
  })
  let res = await once(await buvid3())
  if (res.status === 412 || res.status === 403) res = await once(await buvid3(true))
  const text = await res.text()
  if (!res.ok) throw new Error(explainBiliStatus(res.status, text))
  return text
}

/** 上层回给用户的那句话：认得出来就说清楚，认不出来交回通用文案
 *
 * @param {object} err
 * @returns {string}
 */
export function biliFailText (err) {
  const m = String(err?.message || err || '')
  if (/412|风控/.test(m)) return 'B站这会儿在拦（风控），过几分钟再发一次'
  if (/403|拒绝访问/.test(m)) return 'B站拒绝访问，换个网络再试'
  if (/网页不是数据/.test(m)) return 'B站返回的是网页不是数据，过几分钟再试'
  if (/超时|abort|timeout|fetch failed|ENOTFOUND|ECONN/i.test(m)) return '连不上B站（网络超时），稍后再试'
  if (/空壳|页面数据提取失败|页面数据解析失败/.test(m)) return 'B站这次没把正文发全，过一会儿再试'
  if (/视频信息获取失败|opus 接口无数据|无效B站链接|短链解析失败/.test(m)) return m
  return ''
}

/** ─────────────────────────────── 取数：视频 / 动态 / 专栏 ─────────────────────────────── */

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
export async function parseBili (u) {
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

/** ─────────────────────────────── 内嵌视频代理（手机端能直接播） ─────────────────────────────── */

let _proxy = null
let _proxyPort = 0

const proxyPort = () => Number(Config.biliProxyPort) || 8765

/**
 * 内嵌视频代理现在在不在听。
 *
 * @returns {{running: boolean, port: number}} 是否在听 + 端口号
 */
export function proxyStatus () {
  return { running: !!(_proxy && _proxy.listening), port: _proxyPort }
}

/**
 * 停掉内嵌视频代理并放掉端口（关掉 B站解析、或端口改号时调用）。
 *
 * @returns {boolean} 之前有在跑并已发起关闭为 true；本来就没跑为 false
 */
export function stopProxy () {
  if (!_proxy) return false
  const server = _proxy
  _proxy = null
  _proxyPort = 0
  server.close(err => {
    if (err) log.warn(`代理关闭时报错：${err.message}`)
  })
  return true
}

/**
 * 按配置端口把内嵌视频代理拉起来（端口没变就复用，变了先停旧的再起新的）。
 *
 * @returns {import('node:http').Server} 代理服务实例
 */
export function ensureProxy () {
  const port = proxyPort()
  if (_proxy && _proxyPort === port) return _proxy
  const switched = stopProxy()

  const server = http.createServer(async (q, s) => {
    const u = new URL(q.url, 'http://x')
    const target = u.searchParams.get('url')
    const badPath = u.pathname !== '/bili_video'
    try {
      if (badPath || !target) return s.writeHead(badPath ? 404 : 400).end()
      const r = await fetch(target, { headers: H })
      if (!r.ok) return s.writeHead(r.status).end()
      s.writeHead(200, {
        'Content-Type': r.headers.get('content-type') || 'video/mp4',
        'Content-Length': r.headers.get('content-length') || ''
      })
      for await (const chunk of r.body) if (!s.write(chunk)) await new Promise(r => s.once('drain', r))
      s.end()
    } catch (err) {
      log.warn(`代理转发失败：${err.message}`)
      s.writeHead(500).end()
    }
  })

  server.on('error', err => {
    log.error(`代理错误：${err.message}`)
    if (_proxy === server) {
      _proxy = null
      _proxyPort = 0
    }
  })

  server.listen(port, '0.0.0.0', () => log.mark(`视频代理${switched ? '已切换' : '已启动'}：${port}`))
  _proxy = server
  _proxyPort = port
  return _proxy
}

/**
 * 配置改了之后重新对一遍端口：端口没变就什么都不做。
 *
 * @returns {boolean} 真的换了端口并重启为 true；没在跑或端口没变为 false
 */
export function refreshProxy () {
  if (!_proxy) return false
  if (_proxyPort === proxyPort()) return false
  ensureProxy()
  return true
}

Config.onConfigChange(() => {
  if (!Config.isEnabled('bilibili')) {
    if (stopProxy()) log.mark('B站解析已关闭，视频代理端口已释放')
    return
  }
  refreshProxy()
})

/** ─────────────────────────────── 评论 ─────────────────────────────── */

const WBI_MIXIN = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
]

let wbiCache = { key: '', at: 0 }

async function wbiMixinKey () {
  if (wbiCache.key && Date.now() - wbiCache.at < 3600 * 1000) return wbiCache.key

  let body = null
  try {
    body = await biliJson('https://api.bilibili.com/x/web-interface/nav', { timeout: 10000 })
  } catch (err) {
    log.warn(`拿 wbi 密钥失败：${err.message}`)
    return ''
  }
  const pick = u => String(u).split('/').pop().split('.')[0]
  const img = pick(body?.data?.wbi_img?.img_url || '')
  const sub = pick(body?.data?.wbi_img?.sub_url || '')
  if (!img || !sub) return ''

  const key = WBI_MIXIN.map(i => (img + sub)[i] || '').join('').slice(0, 32)
  if (!key) return ''
  wbiCache = { key, at: Date.now() }
  return key
}

/** wbi 签名：参数按名字排序 + 时间戳 + 密钥取 md5（签名只算一次，翻页复用同一把密钥）
 *
 * @param {object} [params={}]
 * @returns {Promise<string>}
 */
export async function wbiSign (params = {}) {
  const key = await wbiMixinKey()
  if (!key) return ''

  const all = { ...params, wts: Math.floor(Date.now() / 1000) }
  const query = Object.keys(all).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(all[k])}`)
    .join('&')
  const wRid = createHash('md5').update(query + key).digest('hex')
  return `${query}&w_rid=${wRid}`
}

async function biliReply ({ url, query = '', cursor = false }) {
  try {
    const body = await biliJson(query ? `${url}?${query}` : url, { timeout: 10000 })
    if (body?.code !== 0) return { ok: false, reason: body?.message || '接口没返回数据' }

    const replies = body.data?.replies
    if (!Array.isArray(replies)) return { ok: false, reason: '评论数据格式不对' }
    if (!cursor) return { ok: true, items: replies }

    const cur = body.data?.cursor || {}
    return {
      ok: true,
      items: replies,
      cursor: cur.next,
      hasMore: !cur.is_end && Number(cur.next) > 0
    }
  } catch (err) {
    return { ok: false, reason: commentFailReason(err) }
  }
}

async function biliReplyPage ({ oid, type, next = 0, ps = COMMENT_FETCH }) {
  const query = await wbiSign({ oid, type, mode: 3, next, ps, web_location: '333.788' })
  if (!query) return { ok: false, reason: '没拿到 wbi 签名密钥' }
  return biliReply({ url: 'https://api.bilibili.com/x/v2/reply/wbi/main', query, cursor: true })
}

/** 签名这条路走不通时的老接口（要的少、不要签名） */
async function biliReplyFirstPage ({ oid, type, count }) {
  const url = `https://api.bilibili.com/x/v2/reply?type=${type}&oid=${encodeURIComponent(oid)}`
    + `&sort=2&ps=${count}&pn=1`
  return biliReply({ url })
}

/**
 * 取 B站评论：优先走 wbi 签名的 `x/v2/reply/wbi/main`（能翻页），签名拿不到再退老接口第一页。
 *
 * @param {object} [params={}] 见下
 * @param {string} [params.oid] 评论对象 ID（视频是 aid，动态/专栏是 comment_id_str）
 * @param {number} [params.type=1] 评论区类型（1 视频，11 动态，12 专栏）
 * @param {number} [params.count=COMMENT_FETCH] 每页条数
 * @param {number} [params.pages=COMMENT_PAGES] 最多翻几页
 * @returns {Promise<{ok: boolean, items?: Array<object>, reason?: string}>} 成功给原始条目，失败给一句原因
 */
export async function fetchBiliComments ({ oid, type = 1, count = COMMENT_FETCH, pages = COMMENT_PAGES } = {}) {
  if (!oid) return { ok: false, reason: '没拿到评论对象 ID' }

  const ret = await collectCommentPages(
    cursor => biliReplyPage({ oid, type, next: cursor || 0, ps: count }),
    { pages }
  )
  if (ret.ok) return ret
  log.warn(`签名接口没拿到评论，改走老接口：${ret.reason}`)
  return biliReplyFirstPage({ oid, type, count })
}

/**
 * B站评论归一成四平台统一形状（昵称/头像/正文/点赞/回复数）。
 *
 * @param {Array<object>} [items=[]] 接口原始条目
 * @returns {Array<{nick: string, avatar: string, text: string, like: number, replies: number}>} 归一后的评论
 */
export function normalizeBiliComments (items = []) {
  return items.map(r => ({
    nick: r?.member?.uname || '匿名用户',
    avatar: httpsify(r?.member?.avatar || ''),
    text: r?.content?.message || '',
    like: r?.like ?? 0,
    replies: r?.rcount ?? 0
  }))
}

/** ─────────────────────────────── 内嵌视频 / 图文（平台自己的发法） ─────────────────────────────── */

/**
 * B站视频没法直接把地址丢给 QQ（要 Referer，直连 403），所以走本机代理转一手；
 * 图文笔记就是一组图片，交给共用的 sendImages。返回的函数由流水线调用。
 *
 * @param {unknown} D
 * @returns {unknown}
 */
export function biliMedia (D) {
  if (D.type !== 'video') {
    return async (e, pack, log) => {
      if (!D.images.length) return false
      log.mark(`图文 ${D.author}_${D.time}: ${D.images.length}张.`)
      return sendImages(e, { images: D.images, label: 'B站图文解析.', author: D.author, pack })
    }
  }

  return async (e, pack, log, url) => {
    const mb = mbSize(D.video_size)
    log.mark(`视频 ${D.author}_${D.time}: ${mb.toFixed(2)}MB.`)
    if (mb > Config.mbMax) return sendOverSize(e, pack, mb, url)

    const play = `http://${Config.biliProxyHost}:${Config.biliProxyPort}/bili_video`
      + `?url=${encodeURIComponent(D.video_url)}`
    return pack ? pack.video(play) : e.reply(segment.video(play))
  }
}
