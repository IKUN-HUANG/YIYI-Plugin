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
 * @returns {Promise<{online: number, gameOnline: number}|null> 拿不到回 null}
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

    /** 查通了 = 这号没被隐藏，以前写错的名单顺手清掉，下一圈就不用再跳它 */
    if (camp !== id) await forgetHidden(id)

    return {
      gameOnline,
      onlineTime: truncInt(role.onlineTime),
      offlineTime: truncInt(role.offlineTime),
      roleName: roleName && roleName !== '召唤师' ? roleName : '',
      campUserId: camp
    }
  } catch (error) {
    log.info(`${id} 在线状态失败：${error.message}`)
    return null
  }
}
