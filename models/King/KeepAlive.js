/**
 * @file 王者登录态保活：每天拿最轻的接口把所有可用号戳一遍，营地的规矩是「用则续命、闲置才死」。
 * @module models/King/KeepAlive
 */
import { createLogger, maskUserId } from '#yiyi.utils'
import { hotLockRun } from './Hot.js'

const log = createLogger('王者保活')

/**
 * 登录态保活：每天拿最轻的接口戳一下所有可用号，触不到的号会在 Auth 那边打上失效标记，
 * 运维卡和推送都会跟着少用它（所以这里只驱逐、不报错）。
 * @returns {Promise<{ total: number, ok: number, fail: number }>} 本轮统计：总号数 / 成功数 / 失败数（个）
 */
export async function kingKeepAliveTick () {
  return hotLockRun('king.keepalive.tick', async () => {
    const { usableAccounts, silenceLeftMs } = await import('./Auth.js')
    const { getCampFriends } = await import('./Api.js')
    const accounts = usableAccounts().filter(account => silenceLeftMs(account) <= 0)

    let ok = 0
    let fail = 0

    for (const account of accounts) {
      try {
        await getCampFriends({ accountId: account.id, pool: false })
        ok += 1
      } catch (error) {
        fail += 1
        log.warn(`保活失败 ${maskUserId(account.id)}：${error.message}`)
      }
    }

    log.info(`保活：${accounts.length} 个号，成功 ${ok}，失败 ${fail}`)
    return { total: accounts.length, ok, fail }
  })
}
