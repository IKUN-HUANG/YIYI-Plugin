/** 点歌门面：保留既有具名导出与默认导出，实现按请求、统计、音频、视图和会话分开。 */
import { songTime, songDate, likeText, isAudioBuffer, musicShareUrl } from './Music/format.js'
import { MUSIC_PAGE_SIZE, MUSIC_MAX_KEYWORD, MUSIC_SESSION_TTL, MUSIC_MAX_AUDIO } from './Music/constants.js'
import { normalizeCookie, musicApiUrl, musicCookie, musicCookieFingerprint, musicApi } from './Music/request.js'
import { clearMusicCache, albumDate, songRedCount, musicStats } from './Music/stats.js'
import { fetchAudio, songAudio } from './Music/audio.js'
import { normalizeSong, searchSongs } from './Music/search.js'
import { musicCardSegment, musicCardData } from './Music/view.js'
import { musicSessionKey, setMusicSession, getMusicSession, musicPageOf, saveMusicPage, resetMusicSessions, musicSessionCount } from './Music/session.js'

export { songTime, songDate, likeText, isAudioBuffer, musicShareUrl } from './Music/format.js'
export { MUSIC_PAGE_SIZE, MUSIC_MAX_KEYWORD, MUSIC_SESSION_TTL, MUSIC_MAX_AUDIO } from './Music/constants.js'
export { normalizeCookie, musicApiUrl, musicCookie, musicCookieFingerprint, musicApi } from './Music/request.js'
export { clearMusicCache, albumDate, songRedCount, musicStats } from './Music/stats.js'
export { fetchAudio, songAudio } from './Music/audio.js'
export { normalizeSong, searchSongs } from './Music/search.js'
export { musicCardSegment, musicCardData } from './Music/view.js'
export { musicSessionKey, setMusicSession, getMusicSession, musicPageOf, saveMusicPage, resetMusicSessions, musicSessionCount } from './Music/session.js'

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
