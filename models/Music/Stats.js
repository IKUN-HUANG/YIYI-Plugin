/**
 * @file 点歌 · 卡片补数据
 * @module models/Music/Stats
 *
 * 给一页歌补发行日与红心数：限并发、有总预算，慢接口不会拖住整页；
 * 单项失败只记一笔日志，对应位置留空。
 */

import { createLogger } from '#yiyi.utils'
import { likeText } from './Format.js'
import { albumDate, songRedCount } from './Api.js'
import { timeoutOf } from './Http.js'

const log = createLogger('点歌')

/** 同时补几首 */
const MUSIC_STATS_CONCURRENCY = 8
/** 补数据时单条请求的超时上限 */
const MUSIC_STATS_TIMEOUT = 6000
/** 整批补数据的总预算，到点就不再等 */
const MUSIC_STATS_BUDGET = 6000

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
