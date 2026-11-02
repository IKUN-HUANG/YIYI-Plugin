/**
 * @file Ops模块的一片实现：缓存目录的清空指令（普通 / 开机 / 指定）。
 *
 * @module models/Ops/Cache
 */
import fs from 'node:fs'
import path from 'node:path'
import { kingReply, kingFail, kingGuard, kingMasterGuard, kingLog } from '../Say.js'
import { clearRequestCache, requestCacheStats } from '../Api.js'
import { kingCacheDir } from '../Store.js'
import { toText } from '../Common.js'
import { dirSize, sizeText } from './Util/Size.js'

/**
 * 清空缓存文件夹（公开表、对局回顾、翻页记录…），下一次用到会自动重建。
 * 手动「#王者清理缓存」和每天清晨的定时清理走的是同一份逻辑。
 * @returns {{count: number, total: number}} count 删掉的文件数，total 腾出来的字节数；
 *   目录本来就空时给 {count: 0, total: 0}，不做任何删除
 */
export function sweepKingCache () {
  const before = dirSize(kingCacheDir)
  if (!before.count) return { count: 0, total: 0 }

  for (const item of fs.readdirSync(kingCacheDir, { withFileTypes: true })) {
    fs.rmSync(path.join(kingCacheDir, item.name), { recursive: true, force: true })
  }

  const after = dirSize(kingCacheDir)
  return { count: before.count, total: before.total - after.total }
}

/**
 * 定时任务：每天清晨把缓存清一遍（cron 见 config 的 cacheSweepCron）。
 * 自己不抛错：清失败只记一条 warn，让 cron 照常跑下一轮。
 * @returns {{count: number, total: number}} 与 sweepKingCache 同形状；出错时给 {count: 0, total: 0}
 */
export function kingCacheSweep () {
  try {
    const swept = sweepKingCache()
    if (!swept.count) {
      kingLog.mark('定时清缓存：目录本来就是空的')
      return swept
    }
    kingLog.mark(`定时清缓存 ${sizeText(swept.total)} / ${swept.count} 个文件`)
    return swept
  } catch (error) {
    kingLog.warn(`定时清缓存失败：${toText(error?.message) || error}`)
    return { count: 0, total: 0 }
  }
}

/**
 * 启动清缓存：插件每次载入，先把这个「删了也能自己长回来」的目录清空一遍。
 *
 * 为什么启动时也要清：缓存里有两类东西经不起跨机器/跨版本复用 ——
 * ① 卡片内联副本（`cache/King/.inline/`）里存的是 `file:///` 绝对路径，换台服务器、改个目录名全是死路；
 * ② 公开表（英雄/装备/皮肤）跟游戏版本走，旧表比没有更糟（查不到新英雄）。
 * 定时任务（`cacheSweepCron`）每天还会清一次，这里补的是「重启后第一眼就是干净的」。
 *
 * 自己不抛错：清失败只记一条 warn，让插件照常起来。
 * @returns {{count: number, total: number}} 与 sweepKingCache 同形状；出错时给 {count: 0, total: 0}
 */
export function kingBootCacheSweep () {
  try {
    const swept = sweepKingCache()
    if (swept.count) kingLog.mark(`启动清缓存 ${sizeText(swept.total)} / ${swept.count} 个文件`)
    return swept
  } catch (error) {
    kingLog.warn(`启动清缓存失败：${toText(error?.message) || error}`)
    return { count: 0, total: 0 }
  }
}

/**
 * 「#王者清理缓存」入口：内存里的接口记忆与磁盘缓存一起清（仅主人可用）。
 * 为什么两处必须一起清，见函数体里那段说明。
 * @param {object} e Yunzai 的消息事件对象
 * @returns {Promise<boolean|object>} 守卫拦下时给 false；其余给 kingReply 的回执（清了多少、还剩什么）
 */
export async function kingOpsClearCache (e) {
  if (!(await kingGuard(e))) return false
  if (!(await kingMasterGuard(e, '#王者清理缓存'))) return false

  try {
    /** 进程里还压着一层「问过什么」的记忆（Api 的请求记忆 + 归档桶），
     *  只清磁盘等于让用户白等一轮：旧数据还在内存里，清完立刻再查还是那份旧的。
     *  两处一起清、一起报数字。 */
    const memo = requestCacheStats().entries
    clearRequestCache()

    const before = dirSize(kingCacheDir)
    if (!before.count) {
      if (!memo) return kingReply(e, '缓存文件夹是空的，不用清')
      return kingReply(e, `清掉内存里 ${memo} 条接口记忆，磁盘上没有缓存文件`)
    }

    const swept = sweepKingCache()
    kingLog.mark(`清理缓存 ${sizeText(swept.total)} / ${swept.count} 个文件 / 接口记忆 ${memo} 条`)
    return kingReply(e, `清掉 ${sizeText(swept.total)}、${swept.count} 个缓存文件，另加内存里 ${memo} 条接口记忆；剩下的图与公开表下次用到会自动重建`)
  } catch (error) {
    return kingFail(e, error, '清理缓存失败，稍后再试')
  }
}
