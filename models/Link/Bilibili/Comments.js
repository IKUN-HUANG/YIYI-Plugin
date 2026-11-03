/**
 * @file 评论区取数：分页拉取、归一化
 * @module models/Link/Bilibili/Comments.js
 */

import { createLogger, httpsify } from '#yiyi.utils'
import { COMMENT_FETCH, COMMENT_PAGES, collectCommentPages, commentFailReason } from '../Comments.js'
import { biliJson } from './Request.js'
import { wbiSign } from './Wbi.js'

const log = createLogger('B站')

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
async function fetchBiliComments ({ oid, type = 1, count = COMMENT_FETCH, pages = COMMENT_PAGES } = {}) {
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
function normalizeBiliComments (items = []) {
  return items.map(r => ({
    nick: r?.member?.uname || '匿名用户',
    avatar: httpsify(r?.member?.avatar || ''),
    text: r?.content?.message || '',
    like: r?.like ?? 0,
    replies: r?.rcount ?? 0
  }))
}

/** 对外出口：biliReply、biliReplyPage、biliReplyFirstPage、fetchBiliComments、normalizeBiliComments */
export { biliReplyFirstPage, fetchBiliComments, normalizeBiliComments }
