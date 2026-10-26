/**
 * @file 出图前的「生成中」提示：指令一触发就回一句引用，卡片发出去之后自己撤回。
 * @module models/King/Ack
 *
 * 副作用：会起两个定时器（都 unref 过，不挡进程退出）——一个「稍等再发」的宽限计时器，
 * 一个「卡片迟迟不来」的兜底撤回计时器。
 */
import { Config } from '#yiyi.components'
import { createLogger, toText } from '#yiyi.utils'
import { isBlacklisted } from './Blacklist.js'

const log = createLogger('王者卡片')

/**
 * 宽限多久才真的把提示发出去，单位 ms。
 *
 * 为什么不是 0：纯文字指令（开关、黑名单、指路这类）一秒内就回完了，先喊一句「生成图片中」
 * 再立刻撤掉纯属噪音。宽限期内指令自己回完话就直接不发；超过这个时间说明在等接口，立刻发。
 * 300ms 是「手感上等于瞬时」与「别为 200ms 的回应刷一句提示」之间的折中。
 */
export const ACK_GRACE_MS = 300

/**
 * 提示最多挂多久，单位 ms。
 * 正常情况下卡片一发出去就被 `dropKingAck` 撤掉；这个只兜「出图中途炸了、卡片永远不来」，
 * 免得一句「请稍候」在群里挂一整天。
 */
export const ACK_HOLD_MS = 30000

/**
 * 拼「生成图片中」那句提示。
 * 名字取基础设置里的，空着就退回「人家」——否则整句会读成「生成图片中」，看不出是谁在生成。
 *
 * @returns {string} 可直接发给用户的一句提示
 */
export function ackText () {
  const name = toText(Config.name).trim() || '人家'
  return `${name}生成图片中，请稍候~`
}

function msgIdOf (ret) {
  if (ret === null || ret === undefined) return ''
  if (typeof ret === 'number' || typeof ret === 'string') return String(ret)
  const data = ret.data || ret
  const id = data.message_id ?? data.messageId ?? data.msg_id ?? data.seq ?? data.id ?? ret.message_id ?? ret.seq ?? ret.id
  return String(id ?? '')
}

async function recallMsg (e, id) {
  if (!id) return false
  /** 不同适配器把 recallMsg 挂在 group / friend / raw / bot 上，挨个试；最后还有 delete_msg 兜底 */
  const target = e?.group || e?.friend
  const holders = [target, target?.raw, e?.bot].filter(holder => typeof holder?.recallMsg === 'function')
  for (const holder of holders) {
    try {
      await holder.recallMsg(id)
      return true
    } catch {
      continue
    }
  }
  if (typeof e?.bot?.sendApi === 'function') {
    try {
      await e.bot.sendApi('delete_msg', { message_id: id })
      return true
    } catch (error) {
      log.info(`撤回生成提示失败：${toText(error?.message)}`)
    }
  }
  return false
}

/**
 * 真的把提示发出去（宽限期到了才走到这里）。
 * 取到消息 ID 之后挂兜底撤回；期间卡片已经发完（`dropped`）的话，立刻把这条撤掉。
 *
 * @param {object} e Yunzai 消息事件
 * @param {object} state `kingAck` 留下的提示状态
 * @returns {Promise<void>} 发不出去只记日志
 */
async function sendAck (e, state) {
  state.graceTimer = null
  if (state.dropped) return
  try {
    const ret = await e.reply(ackText(), true)
    const id = msgIdOf(ret)
    if (!id) return
    state.id = id
    if (state.dropped) {
      await recallMsg(e, id)
      return
    }
    state.timer = setTimeout(() => { recallMsg(e, id).catch(() => {}) }, ACK_HOLD_MS)
    if (typeof state.timer?.unref === 'function') state.timer.unref()
  } catch (error) {
    /** 提示只是锦上添花：发不出去也照常出图 */
    log.info(`生成提示没发出去：${toText(error?.message)}`)
  }
}

/**
 * 指令一触发就先排一句「生成图片中」提示：不等接口、不阻塞指令本身。
 *
 * 只对用户主动发的指令生效：自动推送那种假事件没有 reply，直接跳过；
 * `e.__kingAck` 是防重标记，一条指令里多个分支都调也只提示一次。
 * 提示状态留在 `e.__kingAckState` 上，`dropKingAck` 才能把那句提示撤掉。
 *
 * 这个函数**不该被当成「提示已发出」来 await**：排完计时器就返回，
 * 调用方紧接着就能去取数——这正是「触发即回提示、不拖慢出图」的关键。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<void>} 立即返回，真正的发送交给计时器
 */
export async function kingAck (e) {
  if (!e || e.__kingAck || typeof e.reply !== 'function') return
  /** 功能关着 / 人在黑名单：模型会先说清楚原因再退出，这里别抢在前面喊「生成图片中」 */
  if (!Config.kingEnable || isBlacklisted(e.user_id)) return
  e.__kingAck = true

  const state = { id: '', timer: null, graceTimer: null, dropped: false }
  e.__kingAckState = state
  state.graceTimer = setTimeout(() => { sendAck(e, state).catch(() => {}) }, ACK_GRACE_MS)
  if (typeof state.graceTimer?.unref === 'function') state.graceTimer.unref()
}

/**
 * 撤掉那句「生成图片中」：卡片发完了、或这条指令最后根本没出图，都该调。
 *
 * 宽限期内还没发出去，就直接不发了；发出去过就立刻撤回。
 * 提示正卡在发送途中的话只打标记，交给 `sendAck` 拿到消息 ID 后自己撤。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<boolean>} 是否真的撤掉了一条消息
 */
export async function dropKingAck (e) {
  const state = e?.__kingAckState
  if (!state || state.dropped) return false
  state.dropped = true
  for (const key of ['graceTimer', 'timer']) {
    if (!state[key]) continue
    clearTimeout(state[key])
    state[key] = null
  }
  if (!state.id) return false
  return recallMsg(e, state.id)
}

/** 默认导出：给 barrel 和需要一次拿全的调用方 */
export default { kingAck, dropKingAck, ackText, ACK_GRACE_MS, ACK_HOLD_MS }
