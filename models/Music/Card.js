/**
 * @file 点歌 · 预览卡视图数据
 * @module models/Music/Card
 *
 * 只把一页歌拼成模板要的形状：全局序号、前三名标记、发行日与红心数，
 * 再加上页码、进度条与操作提示。不碰网络。
 */

import { MUSIC_PAGE_SIZE } from './Consts.js'

/**
 * 预览卡的视图数据：补上全局序号、前三名标记、发行日与红心数。
 *
 * @param {object} [options] 关键词、这一页的歌与统计表
 * @returns {object} 卡片数据（items / 页码 / 进度条 / 操作提示）
 */
export function musicCardData ({ keyword, songs, page = 1, pageCount = 1, total = 0, perPage = MUSIC_PAGE_SIZE, stats } = {}) {
  const items = songs.map((song, i) => {
    const index = (page - 1) * perPage + i + 1
    return {
      ...song,
      index,
      top3: page === 1 && index <= 3,
      albumAt: stats?.albumAt?.[song.albumId] || '',
      likeText: stats?.like?.[song.id] || ''
    }
  })

  const first = (page - 1) * perPage + 1
  const last = first + items.length - 1
  const rangeText = items.length > 1 ? `${first} ~ ${last}` : `${first}`

  return {
    title: '网易云点歌',
    subtitle: `「${keyword}」共 ${total} 首 · 本页第 ${rangeText} 首`,
    items,
    page,
    pages: pageCount,
    total,
    perPage,
    rangeText,
    percent: Math.round((page / Math.max(pageCount, 1)) * 100),
    totalText: `共 ${total} 首 · 每页 ${perPage} 首`,
    hint: page < pageCount
      ? `发送「#听1」~「#听${items.length}」选歌，发「#听下页」翻页`
      : `发送「#听1」~「#听${items.length}」选歌`
  }
}
