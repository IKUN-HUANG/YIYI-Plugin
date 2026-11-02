/**
 * @file 点歌 · 封面预取
 * @module models/Music/Cover
 *
 * 卡片上每首歌一张封面，模板里直接把地址塞进 `<img>` 的话，Chromium 出图时要现场
 * 连十次网易云图床（每张都要 DNS + TLS + 下载），赶上图床慢，整张卡就卡在等图上。
 *
 * 这里先用插件的 `fetchImage` 把封面取回来做成 data URI（有缓存、限并发、有总预算），
 * 取不到的**保留原地址**，让 Chromium 自己兜底 —— 不会因为一张图没回来就少了封面。
 */

import { createLogger, createMemoryCache, fetchImage, withTimeout } from '#yiyi.utils'
import { MUSIC_PAGE_SIZE } from './Consts.js'

const log = createLogger('点歌')

/** 封面同时抓几张：跟一页的数量绑死（一页 15 首就并发 15 张） */
const COVER_CONCURRENCY = MUSIC_PAGE_SIZE
/** 单张封面的超时：图床慢就不等它，直接留原地址 */
const COVER_TIMEOUT = 1500
/** 整批封面的总预算，到点没抓完的就交给 Chromium */
const COVER_BUDGET = 1800

/** 封面缓存：URL → data URI（30 分钟，换专辑也不必重抓） */
const coverCache = createMemoryCache({ max: 300, ttl: 30 * 60 * 1000 })

/** 限并发跑任务，单条失败只记一笔 */
async function mapLimit (items, limit, fn) {
  const queue = [...items]
  const worker = async () => {
    while (queue.length) {
      try {
        await fn(queue.shift())
      } catch (err) {
        log.warn(`封面预取出错：${err?.message || err}`)
      }
    }
  }

  const size = Math.max(1, Math.min(limit, queue.length))
  await Promise.all(Array.from({ length: size }, worker))
}

/**
 * 把一页歌的封面换成 data URI；取不到的保持原地址。
 *
 * @param {object[]} [items] 这一页的歌（`cover` 是远端地址）
 * @returns {Promise<object[]>} 新的歌列表（不修改入参）
 */
export async function withCovers (items = []) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return list

  const out = list.map(item => ({ ...item }))
  const jobs = out.filter(item => typeof item.cover === 'string' && /^https?:\/\//i.test(item.cover))

  for (const item of out) {
    if (typeof item.cover !== 'string' || !/^https?:\/\//i.test(item.cover)) continue
    const hit = coverCache.get(item.cover)
    if (hit) item.cover = hit
  }

  const todo = jobs.filter(item => !String(item.cover).startsWith('data:'))
  if (!todo.length) return out

  let timer
  const budget = new Promise(resolve => { timer = setTimeout(resolve, COVER_BUDGET) })
  try {
    await Promise.race([
      mapLimit(todo, COVER_CONCURRENCY, async item => {
        const url = item.cover
        const remote = await withTimeout(async () => await fetchImage(url), COVER_TIMEOUT, '封面')
        if (!remote?.base64) return
        coverCache.set(url, remote.base64)
        item.cover = remote.base64
      }),
      budget
    ])
  } finally {
    clearTimeout(timer)
  }

  return out
}
