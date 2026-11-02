/**
 * @file 点歌 · 搜索
 * @module models/Music/Search
 *
 * 关键词与页码先校验，再按接口给的总数算页数；结果只取当前页，翻页由会话层缓存。
 */

import { createLogger } from '#yiyi.utils'
import { Config } from '#yiyi.components'
import { MUSIC_MAX_KEYWORD, MUSIC_PAGE_SIZE } from './Consts.js'
import { musicApi } from './Api.js'
import { normalizeSong } from './Song.js'

const log = createLogger('点歌')

/** 接口允许的最大单页数量，翻页再大也不越过它 */
const MUSIC_MAX_PAGE_SIZE = 30

/**
 * 搜歌：只取当前页，关键词与页码都先校验，再按接口给的总数算页数。
 *
 * @param {object} [options] 关键词、页码、每页数量与接口参数
 * @returns {Promise<object>} `{ok:true, keyword, songs, total, page, pageCount, hasMore}` 或 `{ok:false, reason}`
 */
export async function searchSongs ({ keyword, page = 1, perPage = MUSIC_PAGE_SIZE, maxPages, apiUrl, timeout } = {}) {
  const kw = String(keyword ?? '').trim()
  if (!kw) return { ok: false, reason: '要搜什么呢？发「#点歌 歌名」或「#点歌 歌手」试试' }
  if (kw.length > MUSIC_MAX_KEYWORD) {
    return { ok: false, reason: `关键词太长了（最多 ${MUSIC_MAX_KEYWORD} 个字）` }
  }

  const size = Math.min(Math.max(Math.floor(Number(perPage)) || MUSIC_PAGE_SIZE, 1), MUSIC_MAX_PAGE_SIZE)
  const current = Math.max(Math.floor(Number(page)) || 1, 1)
  const offset = (current - 1) * size

  const res = await musicApi('/cloudsearch', { keywords: kw, limit: size, offset, type: 1 }, { apiUrl, timeout })
  if (!res.ok) return { ok: false, reason: res.reason }

  const result = res.data?.result || {}
  const songs = (result.songs || []).map(normalizeSong).filter(Boolean)

  if (!songs.length) {
    return {
      ok: false,
      reason: current > 1
        ? `「${kw}」没有更多结果了`
        : `没有搜到「${kw}」相关的歌，换个关键词试试`
    }
  }

  const total = Math.max(Number(result.songCount) || 0, offset + songs.length)
  const cap = Number(maxPages) > 0 ? Number(maxPages) : Config.musicMaxPages
  const pageCount = Math.max(1, Math.min(Math.ceil(total / size), cap))

  log.mark(`搜索「${kw}」第 ${current}/${pageCount} 页：本页 ${songs.length} 首 / 共 ${total} 首`)

  return {
    ok: true,
    keyword: kw,
    songs,
    total,
    page: current,
    perPage: size,
    pageCount,
    hasMore: current < pageCount,
    more: total > current * size
  }
}
