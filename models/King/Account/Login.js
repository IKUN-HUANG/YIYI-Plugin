/**
 * @file Account模块的一片实现。
 *
 * @module models/Account/Login
 */
import { createLogger } from '#yiyi.utils'
import { toText, sleep, AuthAccountError, ACCOUNT_INVALID_MESSAGE_RE } from '../Common.js'
import { startQQLogin, startWechatLogin } from '../Login.js'
import { listAccounts, accountLine, findAccount, defaultAccountId } from '../Auth.js'
import { kingReply, kingGuard, kingFail, kingRecall, loginImage, loginNotice } from '../Say.js'
import { LOGIN_AUTH_HINTS, LOGIN_HELP, LOGIN_TIMEOUT_MS, POLL_MS, loginSessions } from './Consts.js'

/** 这一片的日志出口（前缀与账号统一） */
const log = createLogger('王者账号')

/**
 * 扫码登录。二维码卡片发出后进程挂在 loginSessions 上，
 * 只有发起人本人发「#取消王者扫码」能取消：取消时要连二维码一起撤回，否则群里留着一张失效的码。
 *
 * 同一个人重复发起时，新的顶掉旧的（旧二维码一并撤回）；轮询状态 3 分钟没确认就收摊。
 *
 * @param {object} e Yunzai 消息事件
 * @param {string} platform 'qq' 或 'wx' / 'wechat' / '微信'；认不出来就回一段帮助
 * @returns {Promise<void>} 结果直接回复到会话（二维码卡片 + 后续状态）
 */
export async function kingLogin (e, platform) {
  if (!(await kingGuard(e))) return

  const raw = toText(platform).toLowerCase()
  const kind = /qq/.test(raw) ? 'qq' : (/wx|vx|wechat|weixin|微信/.test(raw) ? 'wechat' : '')
  if (!kind) return kingReply(e, LOGIN_HELP)

  const key = toText(e.user_id)
  const previous = loginSessions.get(key)
  if (previous) {
    previous.canceled = true
    loginSessions.delete(key)
    await previous.session?.cancel?.().catch(() => {})
    await previous.dropQr()
  }

  let session
  try {
    session = kind === 'qq'
      ? await startQQLogin({ ownerId: e.user_id })
      : await startWechatLogin({ ownerId: e.user_id })
  } catch (error) {
    return kingFail(e, error, '二维码生成出错，稍后再试')
  }

  const name = kind === 'qq' ? 'QQ' : '微信'
  const card = await loginImage(e, {
    title: `王者荣耀 · ${name}扫码登录`,
    tip: `请打开 ${name}，扫下面的码`,
    qr: session.qrBuffer,
    ttl: '3 分钟内有效',
    hints: [
      '扫完请在手机上点一下确认',
      '扫上或者扫完确认，这张卡片都会立刻撤回',
      '想取消这次登录，发「#取消王者扫码」',
      ...LOGIN_AUTH_HINTS
    ]
  })

  const qr = card
    ? await e.reply(segment.image(card))
    : await e.reply([
        segment.image(session.qrBuffer),
        `${name}扫码登录：请用${name}扫上面的码，三分钟内有效。\n想取消这次登录，发「#取消王者扫码」。`
      ])

  let qrGone = false
  const dropQr = async () => {
    if (qrGone) return false
    qrGone = true
    return kingRecall(e, qr)
  }

  const deadline = Date.now() + LOGIN_TIMEOUT_MS
  const entry = { session, event: e, dropQr, canceled: false, kind }
  loginSessions.set(key, entry)

  let lastStatus = ''
  try {
    while (Date.now() < deadline) {
      await sleep(POLL_MS)
      if (entry.canceled) return

      let state
      try {
        state = await session.poll()
      } catch (error) {
        log.info(`查询${name}扫码状态失败：${toText(error?.message)}`)
        continue
      }
      if (entry.canceled) return
      if (state?.status === lastStatus) continue
      lastStatus = toText(state?.status)

      if (lastStatus === 'waiting') continue
      if (lastStatus === 'scanned') {
        await dropQr()
        await kingReply(e, '已经扫上了，在手机上点一下确认～')
        continue
      }

      await session.cancel().catch(() => {})
      await dropQr()

      if (lastStatus === 'confirmed') {
        const index = listAccounts(e.user_id).findIndex(item => item.id === state.account?.id)
        await kingReply(e, `登录成功，登录信息存好了\n${accountLine(state.account || {}, index, { mask: false })}\n${LOGIN_AUTH_HINTS.join('\n')}`)
        return
      }

      return kingReply(e, toText(state?.message) || '登录没有完成，重新发起一次吧')
    }

    await session.cancel().catch(() => {})
    await dropQr()
    return kingReply(e, '二维码超时了，重新发一次「#王者QQ扫码」或「#王者微信扫码」吧')
  } finally {
    if (loginSessions.get(key) === entry) loginSessions.delete(key)
  }
}

/**
 * 取消扫码：只认发起人，取消的同时撤回二维码卡片。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<boolean|void>} 发起过扫码返回是否取消成功；本来就没在扫码时回一段说明
 */
export async function cancelKingLogin (e) {
  if (!(await kingGuard(e))) return false

  const key = toText(e.user_id)
  const entry = loginSessions.get(key)
  if (!entry) {
    return loginNotice(e, {
      title: '王者荣耀 · 扫码登录',
      tip: '你这边没有正在进行的扫码登录',
      ttl: '',
      hints: ['想登录就发「#王者QQ扫码」或「#王者微信扫码」', ...LOGIN_AUTH_HINTS],
      fallback: '你这边没有正在进行的扫码登录，发「#王者QQ扫码」或「#王者微信扫码」可以重新发起。'
    })
  }

  entry.canceled = true
  loginSessions.delete(key)
  await entry.session?.cancel?.().catch(() => {})
  await entry.dropQr()

  return loginNotice(e, {
    title: '王者荣耀 · 扫码登录',
    tip: '这次扫码已经取消，二维码卡片也撤回了',
    ttl: '',
    hints: ['想重新登录，再发一次「#王者QQ扫码」或「#王者微信扫码」', ...LOGIN_AUTH_HINTS],
    fallback: '这次扫码已经取消，二维码卡片也撤回了。'
  })
}

/**
 * 这个错是不是「登录信息过期」—— 过期要补一张新码，别的错只报失败。
 *
 * @param {Error} error 调用链抛上来的错误
 * @returns {boolean} 过期（含账号无效）为 true
 */
export function isExpiredAuth (error) {
  if (error instanceof AuthAccountError) return true
  return ACCOUNT_INVALID_MESSAGE_RE.test(toText(error?.message))
}

/**
 * 登录信息过期时直接补一张新码，别只丢一句「失败了」让用户自己猜。
 *
 * 手动加的号（platform = manual）补不了码，只能请用户重新扫。
 *
 * @param {object} e Yunzai 消息事件
 * @param {Error} error 业务错误
 * @param {string} [fallback=''] 不是过期时回的那句话
 * @returns {Promise<void>} 结果直接回复到会话
 */
export async function kingAuthFail (e, error, fallback = '') {
  if (!isExpiredAuth(error) || !toText(e?.user_id)) return kingFail(e, error, fallback)

  const accounts = listAccounts(e.user_id)
  const target = findAccount(defaultAccountId(e.user_id), e.user_id) || accounts[accounts.length - 1] || {}
  const platform = toText(target.platform)

  if (platform === 'manual') {
    return kingReply(e, '这个号是以前手动加的，登录信息过期了；发「#王者QQ扫码」或「#王者微信扫码」重新扫一个就能接着用')
  }

  const kind = /qq/i.test(platform) ? 'qq' : (/wx|vx|wechat|weixin/i.test(platform) ? 'wechat' : '')
  await kingReply(e, '你上次扫的营地号登录信息过期了，我重新出一张码，扫一下就能接着用')

  if (kind) return kingLogin(e, kind)
  return kingReply(e, '认不出上次扫的是 QQ 还是微信，麻烦发一次「#王者QQ扫码」或「#王者微信扫码」')
}
