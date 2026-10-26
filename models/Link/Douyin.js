/**
 * @file 抖音适配：分享链接取数、图集/视频归一、评论分页。
 * @module models/Link/Douyin.js
 */
import { Config } from '#yiyi.components'
import { COMMENT_FETCH, COMMENT_PAGES, collectCommentPages, commentFailReason } from './Comments.js'
import { HTTP_TIMEOUT_SLOW, timeoutSignal } from './http.js'

/** 解析服务只认这几个头，POST 一个 { url } 就回作品数据 */
async function apiJson (url, { method = 'GET', body, timeout = HTTP_TIMEOUT_SLOW } = {}) {
  const headers = { accept: 'application/json' }
  if (body) headers['Content-Type'] = 'application/json'
  if (Config.douyinApiKey) headers['X-API-Key'] = Config.douyinApiKey

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: timeoutSignal(timeout)
  })
  const text = await res.text()
  try {
    return { res, body: JSON.parse(text) }
  } catch (err) {
    throw new Error(`解析服务回了非 JSON（HTTP ${res.status}）：${err.message}`)
  }
}

function apiOrigin () {
  try {
    return new URL(Config.douyinApiUrl).origin
  } catch (err) {
    return ''
  }
}

/**
 * 走用户自己配的解析服务取抖音作品数据（抖音没有公开接口）。
 *
 * @param {string} url 分享链接
 * @returns {Promise<object>} 解析服务回的 `data`
 * @throws {Error} 没配接口地址、接口回非 JSON、或 `success` 为假
 */
export async function parseDouyin (url) {
  if (!Config.douyinApiUrl) throw new Error('未配置抖音 API 地址')

  const { body } = await apiJson(Config.douyinApiUrl, { method: 'POST', body: { url } })
  if (!body?.success) throw new Error(body?.error?.message || body?.error?.msg || 'parse failed')
  return body.data
}

/**
 * 取抖音评论，按 `cursor` / `has_more` 翻页（页大小与页数由评论模块的常量统一给）。
 *
 * @param {string} awemeId 作品 ID
 * @param {object} [options]
 * @param {number} [options.count=COMMENT_FETCH] 每页条数
 * @param {number} [options.wait=20] 接口等待秒数（同时决定超时）
 * @param {number} [options.pages=COMMENT_PAGES] 最多翻几页
 * @returns {Promise<{ok: boolean, items?: Array<object>, reason?: string}>} 成功给原始条目，失败给一句原因
 */
export async function fetchDouyinComments (awemeId, { count = COMMENT_FETCH, wait = 20, pages = COMMENT_PAGES } = {}) {
  const origin = apiOrigin()
  if (!origin) return { ok: false, reason: '没配置解析接口地址' }
  if (!awemeId) return { ok: false, reason: '没拿到作品 ID' }

  const fetchPage = async cursor => {
    const url = `${origin}/api/v1/douyin/video/comments`
      + `?aweme_id=${encodeURIComponent(awemeId)}&count=${count}&wait=${wait}`
      + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')

    try {
      const { res, body } = await apiJson(url, { timeout: (wait + 5) * 1000 })
      if (!body?.success) return { ok: false, reason: body?.error?.message || `接口返回 HTTP ${res.status}` }

      const items = body.data?.items
      if (!Array.isArray(items)) return { ok: false, reason: '评论数据格式不对' }

      const cursorNext = body.data?.cursor
      return {
        ok: true,
        items,
        cursor: cursorNext,
        hasMore: body.data?.has_more !== false && !!cursorNext
      }
    } catch (err) {
      return { ok: false, reason: commentFailReason(err) }
    }
  }

  return collectCommentPages(fetchPage, { pages })
}

/**
 * 抖音评论归一成四平台统一形状。
 *
 * @param {Array<object>} [items=[]] 接口原始条目
 * @returns {Array<{nick: string, avatar: string, text: string, like: number, replies: number}>} 归一后的评论
 */
export function normalizeDouyinComments (items = []) {
  return items.map(it => ({
    nick: it?.author?.nickname || '匿名用户',
    avatar: it?.author?.avatar?.url || '',
    text: it?.text || '',
    like: it?.digg_count ?? 0,
    replies: it?.reply_count ?? 0
  }))
}
