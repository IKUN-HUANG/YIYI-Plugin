import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryCache } from '../utils/Cache.js'
import { loadModule } from './helpers/modules.js'

const noop = () => {}
const log = { info: noop, warn: noop, error: noop, mark: noop }
const utils = {
  createLogger: () => log,
  createMemoryCache,
  httpsify: value => value.replace(/^http:/, 'https:'),
  mbText: value => String(value),
  pluginTitle: 'test',
  version: '0',
  yunzai: 'test'
}
const event = { group_id: 'group', user_id: 'user' }
const page = (number, keyword = 'song') => ({
  ok: true,
  keyword,
  page: number,
  pageCount: 20,
  perPage: 15,
  songs: [{ id: String(number), name: 'Song ' + number, artistText: 'Artist' }],
  total: 300,
  stats: { like: {}, albumAt: {} }
})

async function setup (globals = {}) {
  const config = { musicCookie: 'test-cookie', musicApiUrl: 'https://music.invalid', musicTimeout: 100, musicMaxPages: 5 }
  const music = await loadModule('models/Music.js', {
    mocks: { '#yiyi.utils': utils, '#yiyi.components': { Config: config } },
    globals
  })
  return { music, config }
}

test('showing another music page preserves prior pages for navigation', async () => {
  const { music, config } = await setup()
  const { Music } = await loadModule('apps/Music.js', {
    mocks: {
      '#yiyi.utils': utils,
      '#yiyi.components': { Config: config, render: async () => 1 },
      '#yiyi.models': {
        ...music,
        loadHelpBg: async () => '',
        persistBg: async () => {},
        extractMsgId: () => 1,
        highlightCmds: value => value
      }
    },
    globals: { plugin: class {} }
  })
  const app = new Music()
  await app.show(event, page(1))
  await app.show(event, page(2))
  const session = music.getMusicSession(event)
  assert.equal(session.page, 2)
  assert.equal(music.musicPageOf(session, 1).songs[0].id, '1')
  assert.equal(music.musicPageOf(session, 2).songs[0].id, '2')
})

test('new keyword or page size starts a separate music page cache', async () => {
  const { music } = await setup()
  music.setMusicSession(event, page(1))
  music.saveMusicPage(event, page(1))
  music.setMusicSession(event, page(2, 'another song'))
  assert.equal(music.musicPageOf(music.getMusicSession(event), 1), null)
  music.saveMusicPage(event, page(2, 'another song'))
  music.setMusicSession(event, { ...page(1, 'another song'), perPage: 10 })
  assert.equal(music.musicPageOf(music.getMusicSession(event), 2, 15), null)
})

test('changing Cookie or API invalidates music sessions', async () => {
  const { music, config } = await setup()
  music.setMusicSession(event, page(1))
  config.musicCookie = 'another-cookie'
  assert.equal(music.getMusicSession(event), null)
  music.setMusicSession(event, page(1))
  config.musicApiUrl += '/'
  assert.notEqual(music.getMusicSession(event), null)
  config.musicApiUrl = 'https://another.invalid'
  assert.equal(music.getMusicSession(event), null)
})

test('music page cache retains only the most recent eight matching pages', async () => {
  const { music } = await setup()
  for (let i = 1; i <= 10; i++) {
    music.setMusicSession(event, page(i))
    music.saveMusicPage(event, page(i))
  }
  const session = music.getMusicSession(event)
  assert.equal(Object.keys(session.pages).length, 8)
  assert.equal(music.musicPageOf(session, 2), null)
  assert.equal(music.musicPageOf(session, 3).page, 3)
  assert.equal(music.musicPageOf(session, 10).page, 10)
  assert.equal(music.saveMusicPage(event, page(11, 'stale search')), null)
})

test('music default export retains its previous public functions', async () => {
  const { music } = await setup()
  const names = [
    'MUSIC_PAGE_SIZE', 'MUSIC_MAX_KEYWORD', 'MUSIC_MAX_AUDIO', 'MUSIC_SESSION_TTL',
    'songTime', 'songDate', 'likeText', 'musicShareUrl', 'musicApiUrl',
    'normalizeCookie', 'musicCookie', 'musicCardSegment', 'isAudioBuffer',
    'fetchAudio', 'musicApi', 'normalizeSong', 'searchSongs', 'songAudio',
    'albumDate', 'songRedCount', 'musicStats', 'clearMusicCache', 'musicCardData',
    'musicSessionKey', 'musicCookieFingerprint', 'musicPageOf', 'saveMusicPage',
    'setMusicSession', 'getMusicSession', 'resetMusicSessions', 'musicSessionCount'
  ]
  assert.deepEqual(Object.keys(music.default).sort(), names.sort())
  for (const name of names) assert.equal(music[name], music.default[name])
})

test('audio download stops reading as soon as a chunk exceeds its limit', async () => {
  let reads = 0
  let cancelled = false
  let released = false
  const { music } = await setup({
    fetch: async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'audio/mpeg' }),
      body: {
        getReader: () => ({
          read: async () => { reads++; return { value: Buffer.alloc(8), done: false } },
          cancel: async () => { cancelled = true },
          releaseLock: () => { released = true }
        })
      }
    })
  })
  const result = await music.fetchAudio('https://audio.invalid/song', { maxBytes: 10 })
  assert.equal(result.ok, false)
  assert.match(result.reason, /音频太大/)
  assert.equal(reads, 2)
  assert.equal(cancelled, true)
  assert.equal(released, true)
})

test('normal streamed audio retains its bytes and type', async () => {
  const audio = Buffer.from('ID3example-audio')
  const chunks = [audio.subarray(0, 5), audio.subarray(5)]
  const { music } = await setup({
    fetch: async () => new Response(new ReadableStream({
      pull (controller) {
        if (chunks.length) controller.enqueue(chunks.shift())
        else controller.close()
      }
    }), { headers: { 'content-type': 'audio/mpeg' } })
  })
  const result = await music.fetchAudio('https://audio.invalid/song')
  assert.equal(result.ok, true)
  assert.deepEqual(result.buffer, audio)
  assert.equal(result.type, 'audio/mpeg')
})
