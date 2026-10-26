/**
 * @file 四平台共用的评论卡：取评论、分页去重、截断、出卡。
 * @module models/Link/Comments.js
 */
import { createLogger, fetchImage, fmtNum, iconBase64, nowTime } from '#yiyi.utils'
import { Config, render } from '#yiyi.components'

const log = createLogger('评论截图')

/** 一条评论最多多少字（超了打省略号） */
export const COMMENT_TEXT_MAX = 90
/** 每页抓多少条 */
export const COMMENT_FETCH = 20
/** 默认翻几页 */
export const COMMENT_PAGES = 5
/** 评论头像要带站方 Referer，不然 CDN 直接 403 */
export const COMMENT_REFERERS = {
  douyin: 'https://www.douyin.com/',
  bilibili: 'https://www.bilibili.com/'
}

const PLATFORM_NAMES = {
  douyin: '抖音',
  bilibili: 'B站'
}

const PLATFORM_ICONS = {
  douyin: 'douyin.png',
  bilibili: 'bili.png'
}

/** 总开关 + 分平台开关都开着才出评论卡
 *
 * @param {string} platform
 * @returns {boolean}
 */
export function commentEnabled (platform) {
  return Config.commentCard && Config.commentCards?.[platform] === true
}

/** 失败原因说人话：超时单独一句，其余用原始信息
 *
 * @param {object} err
 * @returns {string}
 */
export function commentFailReason (err) {
  return err?.name === 'TimeoutError' ? '评论接口超时' : (err?.message || '请求失败')
}

/** 压平空白 + 按字数截断（正好 90 字不截）
 *
 * @param {string} text
 * @param {number} [max=COMMENT_TEXT_MAX]
 * @returns {string}
 */
export function cutCommentText (text, max = COMMENT_TEXT_MAX) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return flat.slice(0, max - 1) + '…'
}

/**
 * 翻页汇总。fetchPage(cursor) 回 { ok, items, cursor, hasMore } 或 { ok:false, reason }。
 * 第一页可以由调用方先拉好（first），并发拉取时省一次请求；
 * 中途某页失败就用已经拿到的，一页都没拿到才算失败。
 *
 * @param {unknown} fetchPage
 * @param {object} [params={}] 各项见下
 * @param {number} [params.pages=COMMENT_PAGES] 最多翻几页
 * @param {object} [params.first=null] 首页响应；给了就省一次请求
 * @returns {Promise<object>}
 */
export async function collectCommentPages (fetchPage, { pages = COMMENT_PAGES, first = null } = {}) {
  const all = []
  let cursor = ''
  let pending = first

  for (let i = 0; i < pages; i++) {
    const ret = pending || await fetchPage(cursor)
    pending = null

    if (!ret?.ok) {
      if (!all.length) return ret
      log.warn(`第 ${i + 1} 页取失败，用已拿到的 ${all.length} 条：${ret?.reason || '原因不明'}`)
      break
    }

    const items = ret.items || []
    all.push(...items)

    const next = ret.cursor
    if (!ret.hasMore || !items.length || next === undefined || next === null || next === '' || next === 0) break
    cursor = next
  }

  return { ok: true, items: all }
}

/** 按点赞降序取前 N 条，空评论丢掉
 *
 * @param {Array} [list=[]]
 * @param {number} [limit=Config.commentLimit]
 * @returns {object}
 */
export function topComments (list = [], limit = Config.commentLimit) {
  return list
    .filter(c => cutCommentText(c?.text))
    .sort((a, b) => (b.like || 0) - (a.like || 0))
    .slice(0, limit)
}

/** 评论卡模板数据（头像统一转 data URI，模板不碰网络）
 *
 * @param {object} [params={}] 各项见下
 * @param {string} [params.platform] 平台标识（bilibili/douyin/kuaishou/xiaohongshu）
 * @param {string} [params.link] 原链接，卡片脚注里回贴
 * @param {Array<object>} [params.comments=[]] 已归一化的评论列表
 * @returns {Promise<object>}
 */
export async function buildCommentData ({ platform, link, comments = [] }) {
  const referer = COMMENT_REFERERS[platform] || COMMENT_REFERERS.douyin
  const list = comments.slice(0, Config.commentLimit)
  const avatars = await Promise.all(list.map(c => fetchImage(c.avatar, referer)))

  return {
    platform,
    icon: iconBase64(PLATFORM_ICONS[platform] || PLATFORM_ICONS.douyin),
    title: `${PLATFORM_NAMES[platform] || ''}热评`,
    link: link || '',
    genTime: nowTime(),
    comments: list.map((c, i) => ({
      nick: c.nick || '匿名用户',
      avatarSrc: avatars[i]?.base64 || '',
      likeFmt: c.like > 0 ? fmtNum(c.like) : '',
      likeIcon: iconBase64('like.png'),
      text: cutCommentText(c.text),
      more: c.replies > 0 ? `共 ${c.replies} 条回复` : ''
    }))
  }
}

/**
 * 出评论卡。load() 通常在作品卡之前就并发拉好了，这里只 await 结果。
 * 拿不到 / 没有可用评论就静默跳过，绝不影响作品卡。
 *
 * @param {object} e
 * @param {object} [params={}] 各项见下
 * @param {string} [params.platform] 平台标识（bilibili/douyin/kuaishou/xiaohongshu）
 * @param {string} [params.link] 原链接，卡片脚注里回贴
 * @param {Function} [params.load] 取评论的回调，回 { ok, items, hasMore, total, reason }
 * @param {Function} [params.normalize] 把平台原始评论折成统一形状
 * @param {object} [params.pack] 合并转发的包；没有就直接发
 * @returns {Promise<unknown>}
 */
export async function sendCommentCard (e, { platform, link, load, normalize, pack }) {
  try {
    const ret = await load()
    if (!ret?.ok) {
      log.warn(`评论卡跳过（${platform}）：${ret?.reason || '拉取失败'}`)
      return false
    }

    const comments = topComments(normalize(ret.items || []))
    if (!comments.length) {
      log.mark(`评论卡跳过（${platform}）：没有可展示的评论`)
      return false
    }

    const data = await buildCommentData({ platform, link, comments })

    if (pack) {
      const base64 = await render('Link/comments', data, { e, retType: 'base64' })
      pack.image(base64)
    } else {
      await render('Link/comments', data, { e })
    }

    log.mark(`评论卡已发（${platform}）：${comments.length} 条`)
    return true
  } catch (err) {
    log.error('评论卡渲染失败', err)
    return false
  }
}
