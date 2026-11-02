/**
 * @file 点歌 · 默认导出
 * @module models/Music/Default
 *
 * 旧版 `models/Music.js` 的默认导出是一张「同名同序」的表（有人 `import music from` 就靠它），
 * 拆开以后照样给一份，名字与顺序都不动。
 */

import { MUSIC_MAX_AUDIO, MUSIC_MAX_KEYWORD, MUSIC_PAGE_SIZE, MUSIC_SESSION_TTL } from './Consts.js'
import { isAudioBuffer, likeText, musicShareUrl, songDate, songTime } from './Format.js'
import { albumDate, clearMusicCache, musicApi, musicApiUrl, musicCookie, musicCookieFingerprint, normalizeCookie, songRedCount } from './Api.js'
import { musicCardSegment, normalizeSong } from './Song.js'
import { searchSongs } from './Search.js'
import { musicCardData } from './Card.js'
import { getMusicSession, musicPageOf, musicSessionCount, musicSessionKey, resetMusicSessions, saveMusicPage, setMusicSession } from './Session.js'
import { musicStats } from './Stats.js'
import { fetchAudio, songAudio } from './Audio.js'

/** 默认导出：与旧版同名同序的一张表（有人 `import music from` 就靠它） */
export default {
  MUSIC_PAGE_SIZE,
  MUSIC_MAX_KEYWORD,
  MUSIC_MAX_AUDIO,
  MUSIC_SESSION_TTL,
  songTime,
  songDate,
  likeText,
  musicShareUrl,
  musicApiUrl,
  normalizeCookie,
  musicCookie,
  musicCardSegment,
  isAudioBuffer,
  fetchAudio,
  musicApi,
  normalizeSong,
  searchSongs,
  songAudio,
  albumDate,
  songRedCount,
  musicStats,
  clearMusicCache,
  musicCardData,
  musicSessionKey,
  musicCookieFingerprint,
  musicPageOf,
  saveMusicPage,
  setMusicSession,
  getMusicSession,
  resetMusicSessions,
  musicSessionCount
}
