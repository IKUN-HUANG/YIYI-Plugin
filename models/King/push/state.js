/**
 * @file 订阅状态的读写：隐藏名单与在线状态
 * @module models/King/push/state
 */
import { createLogger, toText, truncInt } from '#yiyi.utils'
import { getProfile } from '../Api.js'
/** 拆分时漏掉的导入：缺了它一进错误分支/日志行就 ReferenceError */
import { CODE_PROFILE_HIDDEN, describeError, maskUserId } from '../Common.js'
import { clearHiddenProfile, markProfileHidden } from '../Exchange.js'
import { cleanName, mapProfile, resolveCampUser } from '../Profile.js'
import { HIDDEN, USER_NOT_EXIST } from './consts.js'

const log = createLogger('推送')

/** 营地 `gameOnline` 的三档：0 离线 / 1 在线 / 2 游戏中 */
const GAME_ONLINE_PLAYING = 2

/**
 * 这一圈到底是**哪个角色**在打。
 *
 * `isGaming` 是营地账号级的：一个 Q 名下几个角色（同一个营地号）拿到的是同一份「有人在打」，
 * 而空闲角色是跳圈查的（每 5 圈一次），轮到它时局已经开了好几分钟，它只能照自己的名字报
 * —— 用户 2026-10-27 报的「认不清角色」就是这张署名错的卡。主页接口的 `roleList` 里
 * `gameOnline=2` 的那个才是真在打的角色，署名与观战都用它，而不是用「这次轮到谁查」。
 *
 * @param {object} result 请求层封过的结果（`{code,data}` 或裸响应体都认）
 * @returns {{roleId: string, roleName: string}|null} 在打的角色；认不出（没人 gameOnline=2 / 名字空）回 null
 */
function playingRoleOf (result) {
  const body = result && typeof result === 'object' ? result : {}
  const data = body.data && typeof body.data === 'object' ? body.data : body
  const roles = Array.isArray(data.roleList) ? data.roleList : []
  const playing = roles.find(item => truncInt(item?.gameOnline) === GAME_ONLINE_PLAYING)
  const roleId = toText(playing?.roleId)
  if (!roleId) return null
  const roleName = cleanName(playing?.roleName)
  /** 「召唤师」是没读到名字的占位，比没有更糟：照它署名等于把名字又丢了 */
  if (!roleName || roleName === '召唤师') return null
  return { roleId, roleName }
}

/**
 * 查通了就把这个号从隐藏名单里清掉：之前记进去多半是认错了营地号，留着会一直跳过它
 */
async function forgetHidden (campId) {
  try {
    clearHiddenProfile(campId)
  } catch (error) {
    log.info(`隐藏名单清理失败：${error.message}`)
  }
}

/**
 * 把营地回「主页隐藏」的号记进名单，以后不再浪费请求
 *
 * @param {string} campId 营地号
 * @param {object} [roleName=""] 角色名，日志用
 * @returns {Promise<void>}
 */
export async function rememberHidden (campId, roleName = '') {
  try {
    markProfileHidden(campId, roleName)
  } catch (error) {
    log.warn(`隐藏名单记录失败：${error.message}`)
  }
}

/**
 * 查一次在线状态：拿到就顺手清掉以前误记的隐藏名单（认错号时会被写成隐藏）
 *
 * @param {string} campId 营地号
 * @param {string} [accountId=""] 用哪个号查
 * @param {string} [campUserId=""] 营地用户 ID
 * @param {object} [targetRoleId=""] 目标角色 ID
 * @param {string} [owner=""] 这个号属于谁，鉴权用
 * @returns {Promise<{gameOnline: number, roleName: string, playingRoleId: string, playingRoleName: string}|null>} 拿不到回 null}
 */
export async function fetchOnlineState (campId, accountId = '', campUserId = '', targetRoleId = '', owner = '') {
  const id = toText(campId)
  if (!id) return null

  /**
   * 营地号先认对再查。认不出来（或手里这个就是角色 ID）时现认一次，
   * 还是认不出来就回 null —— **绝不拿角色 ID 当营地号**：
   * 营地那边一律回 -10107 / -30032，当「主页被隐藏」记进名单以后，
   * 这个角色在群友状态卡上就永远「没查到」。
   */
  let camp = toText(campUserId)
  if (!camp || camp === id) camp = await resolveCampUser(id, { owner, accountId })
  if (!camp) {
    log.info(`${id} 认不出营地号，这轮跳过在线状态`)
    return null
  }

  try {
    const result = await getProfile(camp, { accountId, targetRoleId })
    const code = Number(result?.code ?? 0)
    if (code === Number(CODE_PROFILE_HIDDEN) || code === USER_NOT_EXIST) {
      /** 上线提醒这条路也得记名单，否则只有战绩那条路记、上下线每圈照样打 */
      if (camp !== id) await rememberHidden(id)
      return HIDDEN
    }
    if (code !== 0) {
      log.info(`${id} 在线状态业务码 ${code}（营地号 ${maskUserId(camp)}）：${describeError(result?.raw)}`)
      return null
    }

    const mapped = mapProfile(result)
    const role = mapped?.role || {}
    const roleName = cleanName(role.roleName)
    const gameOnline = truncInt(role.gameOnline)
    const playing = playingRoleOf(result)

    /** 查通了 = 这号没被隐藏，以前写错的名单顺手清掉，下一圈就不用再跳它 */
    if (camp !== id) await forgetHidden(id)

    return {
      gameOnline,
      onlineTime: truncInt(role.onlineTime),
      offlineTime: truncInt(role.offlineTime),
      roleName: roleName && roleName !== '召唤师' ? roleName : '',
      /** 真在打的那个角色（可能不是本次查的这一位）：开局署名与观战都认它 */
      playingRoleId: playing?.roleId || '',
      playingRoleName: playing?.roleName || '',
      campUserId: camp
    }
  } catch (error) {
    log.info(`${id} 在线状态失败：${error.message}`)
    return null
  }
}
