/**
 * @file 推送取数：拉主页与对局列表，把「查不到」翻成要写的状态位
 * @module models/King/push/fetch
 */
import { createLogger, toText } from '#yiyi.utils'
import { getBattleList } from '../Api.js'
import { archiveBattles } from '../Archive.js'
/** 拆分时漏掉的导入：缺了它一进错误分支就 ReferenceError */
import { CODE_PROFILE_HIDDEN, describeError } from '../Common.js'
import { cleanName, mapProfile, resolveCampUser } from '../Profile.js'
import { HIDDEN, USER_NOT_EXIST } from './consts.js'
import { fetchOnlineState, rememberHidden } from './state.js'

const log = createLogger('推送')

/**
 * 拉一次主页 + 对局列表；查不到的那一侧给 null，让 planPush 按「没信号」处理
 *
 * @param {string} campId 营地号
 * @param {string} [accountId=""] 用哪个号查
 * @param {string} [campUserId=""] 营地用户 ID
 * @param {string} [owner=""] 这个号属于谁，鉴权用
 * @returns {Promise<{profile: object|null, battles: Array<object>|null}>}
 */
export async function fetchLatest (campId, accountId = '', campUserId = '', owner = '') {
  const id = toText(campId)
  if (!id) return null

  /** 跟 fetchOnlineState 一个口径：营地号认不出来就别查、更别记名单 */
  let friendUserId = toText(campUserId)
  if (!friendUserId || friendUserId === id) friendUserId = await resolveCampUser(id, { owner, accountId })
  if (!friendUserId) {
    log.info(`${id} 认不出营地号，这轮跳过战绩`)
    return null
  }

  try {
    const result = await getBattleList({ friendUserId, option: 0, lastTime: 0, roleId: id }, { accountId })
    const code = Number(result?.code ?? 0)
    if (code === Number(CODE_PROFILE_HIDDEN) || code === USER_NOT_EXIST) {
      if (friendUserId !== id) await rememberHidden(id, cleanName(mapProfile(result)?.role?.roleName))
      return HIDDEN
    }
    if (code !== 0) {
      log.info(`${id} 战绩列表业务码 ${code}：${describeError(result?.raw)}`)
      return null
    }

    const data = result?.data && typeof result.data === 'object' ? result.data : null
    if (!data) return null
    if (data.invisible) {
      await rememberHidden(id)
      return HIDDEN
    }

    const list = Array.isArray(data.list) ? data.list : []
    if (list.length) {
      try {
        archiveBattles(id, list)
      } catch (error) {
        log.info(`${id} 归档失败：${error.message}`)
      }
    }

    return data
  } catch (error) {
    log.info(`${id} 战绩列表失败：${error.message}`)
    return null
  }
}

/**
 * 接口不可用（-10103 等）要写回订阅的状态位：这个号暂时别查，并记到什么时候
 *
 * @param {object} sub 订阅记录
 * @param {string} campId 营地号
 * @param {number} now 当前时间，毫秒
 * @returns {object 要合并进订阅的字段}
 */
export function unavailablePatch (sub, campId, now) {
  return {
    ...sub,
    lastUnavailableAt: String(now),
    lastUnavailableReason: `营地号 ${campId} 取不到数据（隐藏主页或用户不存在）`
  }
}
