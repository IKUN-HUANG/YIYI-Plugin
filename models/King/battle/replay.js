/**
 * @file 对局回顾请求与缓存有效期。
 */
import { toText, describeError } from '../Common.js'
import { Config } from '#yiyi.components'
import { num } from './format.js'
import { kingLog } from '../Say.js'
import { getBattleReplay } from '../Api.js'
import { readCache, writeCache } from '../Store.js'

function replayCacheName (gameSeq) {
  return `replay-${toText(gameSeq)}.yaml`
}

function replayFresh (at) {
  const hours = Config.kingReplayCacheHours
  if (!hours) return false
  return Date.now() - num(at) < hours * 3600 * 1000
}

export async function readReplayBody (account, item, mapped) {
  const playerId = toText(mapped.me?.playerId)
  if (!playerId) return null

  const cacheName = replayCacheName(item.gameSeq)
  const cached = await readCache(cacheName, null)
  if (cached && replayFresh(cached.at)) {
    return { body: cached.raw, playerId: cached.playerId || playerId }
  }

  try {
    const replay = await getBattleReplay({
      gameSeq: item.gameSeq,
      gameSvr: item.gameSvrId,
      relaySvr: item.relaySvrId,
      playerId
    }, { accountId: account.id })

    const body = replay?.data
    await writeCache(cacheName, { at: Date.now(), gameSeq: item.gameSeq, playerId, raw: body })
    return { body, playerId }
  } catch (error) {
    kingLog.warn(`查对局走势失败：${toText(error?.message) || describeError(error)}`)
    return null
  }
}
