/** 一页歌曲的补充统计：限并发取发行日与红心数，并缓存成功结果。 */
import { createLogger, createMemoryCache } from '#yiyi.utils'
import { songDate, likeText } from './format.js'
import { musicApi, musicApiUrl, timeoutOf } from './request.js'

const log = createLogger('点歌')
const MUSIC_STATS_CONCURRENCY = 8
const MUSIC_STATS_TIMEOUT = 6000
const MUSIC_STATS_BUDGET = 6000
const albumDateCache = createMemoryCache({ max: 500 })
const redCountCache = createMemoryCache({ max: 500, ttl: 10 * 60 * 1000 })

/**
 * 清掉专辑发行日与红心数缓存（设置里换了接口地址/账号时调）。
 *
 * @returns {void} 无返回值
 */
export function clearMusicCache () {
  albumDateCache.clear()
  redCountCache.clear()
}

/** 缓存 + 打一次接口 + 取值：专辑发行日与红心数共用的同一条链路 */
async function cachedApiValue ({ cache, key, path, params, pick, label, id, quiet, timeout, apiUrl }) {
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const res = await musicApi(path, params, { apiUrl, timeout })
  if (!res.ok) {
    if (!quiet) log.warn(`取${label}失败（${id}）：${res.reason}`)
    return null
  }

  const value = pick(res.data)
  if (value === null || value === undefined || value === '') return null
  cache.set(key, value)
  return value
}

/**
 * 专辑发行日期（一张专辑只查一次，查不到就记空串不再试）。
 *
 * @param {object} [options] 专辑 id 与接口参数
 * @returns {Promise<string|null>} `YYYY-MM-DD`；查不到回 null
 */
export async function albumDate ({ albumId, apiUrl, timeout, quiet } = {}) {
  const id = String(albumId ?? '').trim()
  if (!id) return ''

  const base = musicApiUrl(apiUrl)
  const text = await cachedApiValue({
    cache: albumDateCache,
    key: `${base}|${id}`,
    path: '/album',
    params: { id },
    pick: data => songDate(data?.album?.publishTime),
    label: '专辑发行时间',
    id,
    quiet,
    timeout,
    apiUrl: base
  })
  return text || ''
}

/**
 * 歌曲红心数，按 TTL 缓存（卡片上撑门面的那个数字）。
 *
 * @param {object} [options] 歌曲 id 与接口参数
 * @returns {Promise<string|null>} `1.9万` 这类文案；查不到回 null
 */
export async function songRedCount ({ id, apiUrl, timeout, quiet } = {}) {
  const sid = String(id ?? '').trim()
  if (!sid) return null

  const base = musicApiUrl(apiUrl)
  return await cachedApiValue({
    cache: redCountCache,
    key: `${base}|${sid}`,
    path: '/song/red/count',
    params: { id: sid },
    pick: data => {
      const count = Number(data?.data?.count)
      return Number.isFinite(count) && count >= 0 ? count : null
    },
    label: '红心数',
    id: sid,
    quiet,
    timeout,
    apiUrl: base
  })
}

/** 限并发跑任务，单条失败只记一笔 */
async function mapLimit (items, limit, fn) {
  const queue = [...items]
  const worker = async () => {
    while (queue.length) {
      try {
        await fn(queue.shift())
      } catch (err) {
        log.warn(`卡片补数据出错：${err?.message || err}`)
      }
    }
  }

  const size = Math.max(1, Math.min(limit, queue.length))
  await Promise.all(Array.from({ length: size }, worker))
}

/**
 * 给一页歌补发行日与红心数：并发有上限、整批有总预算，慢接口不会拖住整页。
 *
 * @param {object} [options] 这一页的歌与接口参数
 * @returns {Promise<{albumAt: object, like: object}>} 按专辑 id / 歌曲 id 索引的两张表
 */
export async function musicStats ({ songs = [], apiUrl, timeout } = {}) {
  const list = (songs || []).filter(s => s && s.id)
  const albums = [...new Set(list.map(s => s.albumId).filter(Boolean))]
  const ms = Math.min(timeoutOf(timeout), MUSIC_STATS_TIMEOUT)

  const like = {}
  const albumAt = {}

  const jobs = [
    ...list.map(song => async () => {
      const text = likeText(await songRedCount({ id: song.id, apiUrl, timeout: ms, quiet: true }))
      if (text) like[song.id] = text
    }),
    ...albums.map(albumId => async () => {
      const date = await albumDate({ albumId, apiUrl, timeout: ms, quiet: true })
      if (date) albumAt[albumId] = date
    })
  ]

  if (!jobs.length) return { like, albumAt }

  let timer
  const budget = new Promise(resolve => { timer = setTimeout(resolve, Math.min(ms, MUSIC_STATS_BUDGET)) })
  try {
    await Promise.race([mapLimit(jobs, MUSIC_STATS_CONCURRENCY, job => job()), budget])
  } finally {
    clearTimeout(timer)
  }

  const got = Object.keys(like).length + Object.keys(albumAt).length
  if (got < jobs.length) {
    log.warn(`卡片补数据：${jobs.length - got}/${jobs.length} 项没取到（红心数 / 专辑发行时间），对应位置留空`)
  }
  return { like, albumAt }
}
