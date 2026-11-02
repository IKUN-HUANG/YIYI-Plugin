/**
 * @file 点歌 · 歌曲形状
 * @module models/Music/Song
 *
 * 搜索与详情两种字段形状在这里归一成一种，卡片模板只认这一份；
 * OneBot11 的 music 段也在这里生成（协议端不认时由上层退回分享链接）。
 */

import { httpsify } from '#yiyi.utils'
import { songTime } from './Format.js'

const MUSIC_ARTIST_NA = '未知歌手'

/**
 * 搜索与详情两种字段形状统一成一种，卡片模板只认这一份。
 *
 * @param {object} raw 接口返回的原始歌曲
 * @returns {object|null} 归一后的歌曲；缺 id 或名字回 null
 */
export function normalizeSong (raw) {
  if (!raw || raw.id === undefined || raw.id === null) return null

  const name = String(raw.name || '').trim()
  if (!name) return null

  const artists = (raw.ar || raw.artists || []).map(a => String(a?.name || '').trim()).filter(Boolean)
  const album = raw.al || raw.album || {}
  const fee = Number(raw.fee ?? raw.privilege?.fee ?? 0) || 0
  const dt = Number(raw.dt ?? raw.duration ?? 0) || 0
  const vip = fee === 1 || fee === 4

  return {
    id: String(raw.id),
    name,
    artists: artists.length ? artists : [MUSIC_ARTIST_NA],
    artistText: (artists.length ? artists : [MUSIC_ARTIST_NA]).join(' / '),
    album: String(album.name || '').trim(),
    albumId: String(album.id || '').trim(),
    cover: httpsify(String(album.picUrl || '')),
    duration: dt,
    durationText: songTime(dt),
    fee,
    vip,
    vipText: vip ? 'VIP' : ''
  }
}

/**
 * OneBot11 的 music 段：协议端认就直接出播放器，不认再退回分享链接。
 *
 * @param {object} song 归一后的歌曲对象
 * @returns {{type: string, data: object}|null} 音乐段；没 id 回 null
 */
export function musicCardSegment (song) {
  const id = String(song?.id ?? '').trim()
  if (!id) return null
  return { type: 'music', data: { type: '163', id } }
}
