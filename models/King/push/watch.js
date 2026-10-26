/**
 * @file 推送里的观战：开启开关、被拒记录、轮询排期
 * @module models/King/push/watch
 */
import { createLogger, sleep, toText } from '#yiyi.utils'
import { normalizeName } from '../Profile.js'
import { kingGuard, kingReply } from '../Say.js'
/** 拆分时漏掉的导入：缺了它一进错误分支/日志行就 ReferenceError */
import { describeError, maskUserId } from '../Common.js'
import { readUserPart, writeUserPart } from '../core/store.js'
import { lockWatcher, probeFriend, watchStream } from '../watch/engine.js'
import { publicLink } from '../watch/link.js'

const log = createLogger('推送')

const WATCH_PART = 'watch'

/**
 * 「开局卡后面要不要跟观战链接」是个人设置，缺省是开的
 *
 * @param {string} qq QQ 号
 * @returns {boolean 是否开着}
 */
export function watchLinkOn (qq) {
  const part = readUserPart(toText(qq), WATCH_PART)
  return part && typeof part === 'object' ? part.on !== false : true
}

/**
 * 改观战链接开关
 *
 * @param {string} qq QQ 号
 * @param {boolean} on 开还是关
 * @returns {boolean 改后的状态}
 */
export function setWatchLinkOn (qq, on) {
  const id = toText(qq)
  if (!id) return false
  return writeUserPart(id, WATCH_PART, { on: Boolean(on) })
}

/**
 * `#王者观战开启` / `#王者观战关闭`：个人设置，关掉之后开局卡照发、只是不再跟链接
 *
 * @param {object} e 框架事件
 * @returns {Promise<void>}
 */
export async function kingWatchSwitch (e) {
  if (!(await kingGuard(e))) return false

  const on = !/关/.test(toText(e?.msg))
  if (!setWatchLinkOn(e?.user_id, on)) return kingReply(e, '这个设置没写进你的数据文件，过一会儿再试一次')

  return kingReply(e, [
    `观战链接已经${on ? '开启' : '关闭'}`,
    on
      ? '以后群里有人开局，我会挨个用存着的号去跟营地问这一局的直播流；问到了就转成短链，跟在开局卡后面'
      : '以后开局卡照发，但不跟观战链接了',
    '这是个人设置（默认开着），只影响你自己发起的推送'
  ].join('\n'))
}

/** 开局后跟几次观战链接：0 / 60 / 120 / 180 秒，正好是「开局后三分钟、头尾四次」 */
export const WATCH_POLL_AT = [0, 60, 120, 180]

/** 同一个群同一局只跟一条轮询链：key = 群 + 营地角色 + 这一局的开局时间 */
export const watchPolls = new Map()

/**
 * 营地明确回「不允许被观战」（-1003）之后，这个营地角色在这段时间里不再起轮询链。
 * 只放内存：进程重启就清空；对方把营地的观战开关打开后，最迟这么久也会自动恢复重试。
 * 为什么值得记一笔：他只要没开这个开关，之后每开一局都会白跑 4 次请求。
 */
export const WATCH_DENY_HOURS = 6

/** campUserId → 到期时间戳（毫秒） */
const watchDenied = new Map()

/**
 * 营地回「不允许被观战」就记一下，WATCH_DENY_HOURS 小时内别再排轮询
 *
 * @param {string} campUserId 营地用户 ID
 * @returns {void}
 */
export function markWatchDenied (campUserId, { now = Date.now } = {}) {
  const id = toText(campUserId)
  if (!id) return 0
  const until = now() + WATCH_DENY_HOURS * 3600 * 1000
  watchDenied.set(id, until)
  return until
}

/**
 * 还剩多久（毫秒）；0 = 没记过，或者已经过期
 *
 * @param {string} campUserId 营地用户 ID
 * @returns {number 剩余静默时间，毫秒}
 */
export function watchDeniedLeft (campUserId, { now = Date.now } = {}) {
  const id = toText(campUserId)
  if (!id) return 0
  const until = watchDenied.get(id) || 0
  if (!until) return 0
  const left = until - now()
  if (left <= 0) {
    watchDenied.delete(id)
    return 0
  }
  return left
}

/**
 * 排查 / 测试用：清掉这个角色的记忆（不传就全清）
 *
 * @param {string} [campUserId=""] 营地用户 ID
 * @returns {void}
 */
export function clearWatchDenied (campUserId = '') {
  const id = toText(campUserId)
  if (id) watchDenied.delete(id)
  else watchDenied.clear()
}

/** 轮询里的等待：unref 掉，测试进程跑完 push 不会被这条链挂住 */
function watchSleep (ms) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

/**
 * 卡片上真出现「开始对局的群友」、而且他自己没关观战链接，才起一条轮询链。
 * 返回 null 表示这一轮不用跟链接（没有开局行 / 关了开关）。
 *
 * @param {string} [groupId=""]
 * @param {string} [qq=""]
 * @param {string} [campId=""]
 * @param {string} [campUserId=""]
 * @param {Array<object>} [rows]
 * @param {object} [patch]
 * @returns {object|null 轮询计划；没有可播链接时回 null}
 */
export function watchJobOf ({ groupId = '', qq = '', campId = '', campUserId = '', rows = [], patch = {} } = {}) {
  const group = toText(groupId)
  const role = toText(campId)
  if (!group || !role) return null
  if (!watchLinkOn(qq)) return null
  if (!rows.some(row => toText(row?.kind) === 'gaming')) return null

  const started = toText(patch?.lastGamingStart) || toText(patch?.lastGaming) || toText(patch?.roleName)
  return {
    key: `${group}:${role}:${started || 'live'}`,
    groupId: group,
    campId: role,
    campUserId: toText(campUserId) || role,
    who: normalizeName(patch?.roleName) || '群友'
  }
}

/**
 * 开局后 3 分钟内轮询 4 次（0 / 60 / 120 / 180 秒）：
 * 第一次先锁定「跟他是好友的公共号」——锁不到就说明这一局永远拿不到流，直接放弃；
 * 锁定之后 4 次都只用这个号重试；4 次都没拿到流就静默放弃。
 * 两种「不用再轮询」的情况立刻收手，不占满 4 次：对局已经结束（-1005 / -1006），
 * 以及营地明确回「不允许被观战」（-1003）——后者还会记一笔，这个角色 6 小时内不再起轮询链。
 *
 * 卡片是图、链接只能靠文字发，所以拿到流以后单独发一条「观战 · 谁：短链」。
 * 返回 { ok, rounds, link, denied } —— 不 await 调用，后台跑完就散。
 *
 * @param {object} job 轮询计划
 * @param {Function} send 发文字的函数
 * @returns {Promise<object> 结果 {ok, rounds, link?, denied?}}
 */
export async function runWatchPoll (job, send, { now = Date.now, sleep: wait = watchSleep } = {}) {
  if (!job?.key) return { ok: false, rounds: 0, reason: '没有观战任务' }
  if (typeof send !== 'function') return { ok: false, rounds: 0, reason: '没有发送接口' }
  if (watchPolls.has(job.key)) return { ok: false, rounds: 0, reason: '这一局已经在跟了' }

  /** 营地刚才说过「不允许被观战」：这一局连问都不用问（真机上 4 次轮询全是同一句拒绝） */
  const deniedLeft = watchDeniedLeft(job.campUserId, { now })
  if (deniedLeft) {
    const mins = Math.max(1, Math.ceil(deniedLeft / 60000))
    log.info(`观战 ${job.who}：对方拒观战，${mins} 分钟后重试`)
    return { ok: false, rounds: 0, denied: true, reason: '对方关了「允许观战」' }
  }

  watchPolls.set(job.key, true)
  const began = now()
  let rounds = 0

  try {
    let watcher = null
    let battleId = ''

    for (let index = 0; index < WATCH_POLL_AT.length; index += 1) {
      const due = began + WATCH_POLL_AT[index] * 1000
      if (due > now()) await wait(due - now())
      rounds = index + 1

      if (!watcher) {
        const locked = await lockWatcher({ campId: job.campId, campUserId: job.campUserId })
        if (!locked.ok) {
          /** 营地说了不让观战：记一笔，这个人接下来的几局不再白跑 4 次（0.1.7） */
          if (locked.denied) markWatchDenied(job.campUserId, { now })
          log.info(`观战 ${job.who}：${locked.reason}，${locked.denied ? '不再试' : '本局放弃'}`)
          return { ok: false, rounds, denied: Boolean(locked.denied), reason: locked.reason }
        }
        watcher = locked.watcher
        battleId = toText(locked.battleId)
        log.info(`观战 ${job.who}：第 1/${WATCH_POLL_AT.length} 次锁定 ${maskUserId(watcher.id)}${battleId ? '' : '，无对局ID'}`)
      } else {
        const probe = await probeFriend({ campId: job.campId, campUserId: job.campUserId, accountId: watcher.id })
        if (probe.ok && probe.friend) battleId = toText(probe.battleId) || battleId
        log.info(`观战 ${job.who}：第 ${index + 1}/${WATCH_POLL_AT.length} 次${battleId ? '，有对局ID' : '，无对局ID'}`)
      }

      if (!battleId) {
        /** 刚开局时 battleprofile 往往还没登记对局ID，下一分钟再来 */
        if (index === WATCH_POLL_AT.length - 1) break
        continue
      }

      const got = await watchStream({ campId: job.campId, campUserId: job.campUserId, watcherId: watcher.id, battleId })
      if (got.ok) {
        let short = got.play
        try {
          short = (await publicLink(got.play, `观战 · ${job.who}`)) || got.play
        } catch (error) {
          log.info(`短链转换失败，改发直链：${toText(error?.message) || '短链服务不可用'}`)
        }
        const text = `观战 · ${job.who}：${short}`
        let sent = false
        let failed = false
        try {
          sent = await send(job.groupId, text)
        } catch (error) {
          failed = true
          log.warn(`群 ${job.groupId} 观战链接发送失败：${toText(error?.message) || describeError(error)}`)
        }
        /** mark 只给「真发出去」的里程碑；没发出去（抛错或返回空）都不许记成功日志 */
        if (sent) log.mark(`观战链接已发 ${job.who}：${short}`)
        else if (!failed) log.warn(`群 ${job.groupId} 观战链接没发出去：发送接口返回空`)
        return { ok: sent, rounds, link: { ...got, short } }
      }

      if (got.denied) {
        /** 对方关了「允许观战」：这一局后面几次、以及接下来的几局都不再问 */
        markWatchDenied(job.campUserId, { now })
        log.info(`观战 ${job.who}：${got.reason}，${WATCH_DENY_HOURS} 小时内不再跟`)
        return { ok: false, rounds, denied: true, reason: got.reason }
      }

      if (got.finish) {
        log.info(`观战 ${job.who}：对局已结束（${got.reason}）`)
        return { ok: false, rounds, reason: got.reason }
      }
      log.info(`观战 ${job.who}：第 ${index + 1}/${WATCH_POLL_AT.length} 次无流（${got.reason}）`)
    }

    log.info(`观战 ${job.who}：${WATCH_POLL_AT.length} 次无流，放弃`)
    return { ok: false, rounds, reason: '4 次都没问到' }
  } finally {
    watchPolls.delete(job.key)
  }
}
