/**
 * @file 观战的纯函数：判定码、解析深链、协议归一
 * @module models/King/watch/stream
 */
import { Config } from '#yiyi.components'
import { toText } from '#yiyi.utils'
import { WATCH_TYPE } from './consts.js'

/**
 * 营地「不允许被观战」的业务码；碰到就别再排轮询
 */
export const WATCH_DENIED_CODE = '-1003'

/** 这次失败是不是「别再试了」（营地 -1003）；营地的码偶尔带空格、偶尔是数字，统一转成字符串再比 *
 * @param {string} code 营地的返回码
 * @returns {boolean 是不是被拒}
 */
export function isWatchDenied (code) {
  return toText(code).trim() === WATCH_DENIED_CODE
}

const DEEPLINK_HEAD_RE = /^\s*(?:smobagamehelper|gamehelper):\/\/[^?]*\?/i

/** 从 watchBattleUrl 深链里抠出对局 ID 与营地角色；不是深链就回 null *
 * @param {string} url 观战地址或深链
 * @returns {{battleId: string, userId: string, roleId: string, raw: string}|null}
 */
export function parseWatchUrl (url) {
  const text = toText(url)
  if (!text) return null

  const query = DEEPLINK_HEAD_RE.test(text) ? text.replace(DEEPLINK_HEAD_RE, '') : ''
  if (!query) return null

  let params = null
  try {
    params = new URLSearchParams(query)
  } catch {
    return null
  }

  const battleId = toText(params.get('battle_id')) || toText(params.get('battleId'))
  if (!battleId) return null

  return {
    battleId,
    userId: toText(params.get('battle_user_id')) || toText(params.get('user_id')),
    roleId: toText(params.get('role_id')) || toText(params.get('roleId')),
    deeplinkType: toText(params.get('type')),
    liveCenterType: toText(params.get('live_center_type')),
    raw: text
  }
}

/** 从战绩列表里挑出「正在打」的条目，顺手把观战三元组解出来 *
 * @param {Array<object>} [list] 对局列表
 * @returns {Array<object> 对局中条目（带三元组）}
 */
export function pickWatching (list = []) {
  const out = []
  for (const item of Array.isArray(list) ? list : []) {
    if (!item) continue
    const slot = parseWatchUrl(item.watchBattleUrl)
    if (!slot) continue
    out.push({
      item,
      slot,
      /** 营地给的 canBeWatch 最可信，其次是 isGaming，最后才是「有深链就算」 */
      rank: Boolean(item.canBeWatch) ? 0 : (Boolean(item.isGaming) ? 1 : 2)
    })
  }
  return out.sort((a, b) => a.rank - b.rank)
}

/** 判定直播流协议：营地可能给 rtmp / flv / hls，能不能在网页里放完全看这个 *
 * @param {string} url 流地址
 * @returns {string flv / hls / rtmp / 空串}
 */
export function protocolOf (url) {
  const text = toText(url).toLowerCase()
  if (!text) return ''
  if (text.startsWith('rtmp')) return 'rtmp'
  if (/\.flv(?:[?#]|$)/.test(text) || /(?:^|[?&])format=flv(?:&|$)/.test(text)) return 'flv'
  if (/\.m3u8(?:[?#]|$)/.test(text)) return 'hls'
  if (/\.mp4(?:[?#]|$)/.test(text)) return 'mp4'
  return text.startsWith('http') ? 'http' : 'other'
}

/**
 * 协议在回执里的中文名
 *
 * @param {string} protocol 协议标识
 * @returns {string 中文名}
 */
export function protocolName (protocol) {
  switch (protocol) {
    case 'rtmp': return 'RTMP'
    case 'flv': return 'HTTP-FLV'
    case 'hls': return 'HLS'
    case 'mp4': return 'MP4'
    case 'http': return 'HTTP'
    default: return '未知'
  }
}

/**
 * 把营地给的 RTMP 地址换成浏览器／手机能直接点开的 HTTP-FLV 地址。
 * 营地给的是 rtmp 协议、`/live/<名字>?txSecret=…&txTime=…` 这种路径，
 * 把协议换成 http、路径补上 `.flv` 就同一个签名可播（实测 200 + video/x-flv；
 * 200 + video/x-flv；注意不能走 https，那个域名的证书对不上）。
 * 不是 rtmp 的地址原样返回，别乱改。
 *
 * @param {string} url 流地址
 * @returns {string 可播地址或空串}
 */
export function playableUrl (url) {
  const text = toText(url)
  if (!text || !/^rtmp:\/\//i.test(text)) return text

  const body = text.slice(7)
  const at = body.indexOf('?')
  const rawPath = at < 0 ? body : body.slice(0, at)
  const query = at < 0 ? '' : body.slice(at)
  const path = rawPath.toLowerCase().endsWith('.flv') ? rawPath : `${rawPath}.flv`
  return `http://${path}${query}`
}

/** 把 /game/watchBattle 的返回归一成「能播 / 不能播 + 为什么」 *
 * @param {object} result 接口返回
 * @returns {{ok: boolean, finish?: boolean, denied?: boolean, url?: string, reason?: string}}
 */
export function normalizeStream (result) {
  const code = toText(result?.code)
  /**
   * -1003 单列一支：finish 与 denied 一起为真，认得出「对方不让看」的调用方
   * 就不用管 finish 那个「对局已结束」的说法了。
   */
  if (isWatchDenied(code)) {
    const msg = toText(result?.raw?.returnMsg) || toText(result?.data?.returnMsg) || '该用户不允许被观战'
    return { ok: false, finish: true, denied: true, reason: `对方不让看这局（营地 ${code}：${msg}）` }
  }
  if (code === '-1005' || code === '-1006') {
    return { ok: false, finish: true, reason: '对局已经结束了（营地 -1005/-1006）' }
  }
  if (code && code !== '0') {
    const msg = toText(result?.raw?.returnMsg) || toText(result?.data?.returnMsg) || '取流失败'
    return { ok: false, finish: false, reason: `营地返回 ${code}：${msg}` }
  }

  /**
   * 没拿到 stream 不等于对局结束：开局第 1 分钟营地本来就不给流，
   * 判成结束就只问一次就收手。只有 -1005/-1006 才算结束。
   */
  const stream = result?.data?.stream || null
  if (!stream) return { ok: false, finish: false, reason: '营地还没给直播流（对局可能刚开始）' }
  if (stream.success === false) return { ok: false, finish: false, reason: '营地还没给直播流（stream.success = false）' }

  /** 流地址在 data.stream.stream.liveStreamUrl（比预期深一层），两层都认 */
  const inner = stream.stream && typeof stream.stream === 'object' ? stream.stream : stream
  const url = toText(inner.liveStreamUrl) || toText(stream.liveStreamUrl)
  if (!url) return { ok: false, finish: Boolean(stream.finish), reason: 'stream 里没有 liveStreamUrl' }

  return { ok: true, finish: Boolean(stream.finish), url, inner, stream }
}

/** 十人阵容（营地 battleInfo 的 camp1/camp2 结构） *
 * @param {object} info battleInfo
 * @returns {Array<object> 十个人}
 */
export function lineupOf (info) {
  const team = list => (Array.isArray(list) ? list : [])
    .map(one => toText(one?.roleInfo?.roleName) || toText(one?.roleName))
    .filter(Boolean)
  return { camp1: team(info?.camp1), camp2: team(info?.camp2) }
}

/**
 * 观战接口的 type 参数（照抄客户端发的 8）
 * @returns {number 固定的 8}
 */
export function watchType () {
  const value = Number(Config.kingWatchType)
  return Number.isFinite(value) && value > 0 ? value : WATCH_TYPE
}
