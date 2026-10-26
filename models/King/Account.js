/**
 * @file 账号这一块对用户说的话与做的事：扫码登录、切号删号、校验、绑定/解绑、我是谁。
 *
 * 这些函数都带 `e`（要回包、要撤回、要按人隔离会话），所以留在 models 里由 apps 直接调；
 * 纯取数逻辑在 `auth/` 下，这里只管「说人话 + 串起一次交互」。
 *
 * @module models/King/Account
 */
import { toText, maskUserId, isUsableAuth, normRoleId, sleep, AuthAccountError, ACCOUNT_INVALID_MESSAGE_RE } from './Common.js'
import {
  listAccounts, findAccount, usableAccounts, defaultAccountId,
  setDefaultAccount, removeAccount, accountLine, ownerOf,
  setBind, delBind, resolveBind, silenceLeftMs,
  roleInfoOf, accountsOwningRole
} from './Auth.js'
import { startWechatLogin, startQQLogin, refreshAccount } from './Login.js'
import { kingReply, kingGuard, kingFail, kingAuthTip, kingRecall, loginImage, loginNotice, kingLog } from './Say.js'
import { renderKing, logoUri, imageUris, timeText } from './Card.js'
import { CAMP_REFERER } from './Api.js'
import { rankFaceOf } from './Face.js'

const log = kingLog

const POLL_MS = 2500
const LOGIN_TIMEOUT_MS = 180000

const LOGIN_HELP = [
  '营地登录用扫码，登录信息存在伊伊这边，不会外传：',
  '',
  '#王者QQ扫码      用 QQ 扫码',
  '#王者微信扫码    用微信扫码（写「#王者VX扫码」也一样）',
  '「登录」「登陆」都认，写「#王者QQ登录」也一样。',
  '',
  '登录之后：',
  '#我的营地        主页数据 + 绑定状态（扫码后自动绑本人角色，也可以发「#王者绑定 营地ID」自己绑）',
  '#取消王者扫码    反悔了就把这次扫码取消，二维码卡片也会撤回',
  '',
  '登录信息一般能用一个月左右，过期了重新扫码就行',
  '要是在手机上登录了王者营地，这边的登录信息会立刻过期。'
].join('\n')

const BIND_USAGE = [
  '「#王者绑定 营地ID」把你想看的营地角色绑到你自己名下，绑完发「#我的营地」「#王者战绩」「#王者排行榜」查的就是它。',
  '营地ID 是一串数字（一般 9~10 位），在营地 App「我的 → 点击名字」或「我的 → 三横杠」里能看到；绑别人的营地ID 也可以。',
  '查数据时我会先找这个角色自己的登录信息，找不到再从别人扫码登录的号里挑一个能查的。',
  '上下线提醒、战绩推送这类定时检查只用你自己扫码登录的号，不会借别人的号。'
].join('\n')

/** 扫码登录里「登录信息会过期」的两条提醒，扫码卡与营地卡共用 */
export const LOGIN_AUTH_HINTS = [
  '登录信息大概一个月过期，过期重新扫一次就行',
  '在手机上登了王者营地，这个登录信息会立刻过期'
]

const PLATFORM_TEXT = { qq: 'QQ', wx: '微信', vx: '微信', wechat: '微信', manual: '手动' }

/** 谁正在扫码：一个 QQ 同时只挂一个会话，新的顶掉旧的并撤回旧二维码 */
const loginSessions = new Map()

const grab = (msg, pattern) => {
  const hit = pattern.exec(toText(msg))
  return hit ? toText(hit[1]).trim() : ''
}

/**
 * 「切换/删除/校验账号」这类指令的参数：命令词里的「账号」可有可无，参数也可有可无。
 *
 * 不能直接写 `切换(?:账号)?\s*(\S+)`：用户没写序号时那个可选组会回退，
 * 把「账号」两个字当成参数吃下去，于是回一句「你自己的账号里没找到「账号」」——
 * 看着像在说他的号叫「账号」，其实他只是没写序号。
 *
 * @param {string} msg 消息原文
 * @param {string} verb 动词（切换 / 删除 / 校验）
 * @returns {string} 序号或账号号；没写返回空串
 */
function accountArgOf (msg, verb) {
  const token = grab(msg, new RegExp(`${verb}(?:账号)?\\s*(\\S+)`))
  return token === '账号' ? '' : token
}

/** 「2」这种序号和「1234567」这种真 ID 都认 */
function resolveTarget (token, userId = '') {
  const key = toText(token).trim()
  if (!key) return null

  const accounts = listAccounts(userId)
  if (/^\d{1,3}$/.test(key)) {
    const index = Number(key)
    if (index >= 1 && index <= accounts.length) return accounts[index - 1]
  }
  return accounts.find(item => item.id === key || item.userId === key || ownerOf(item) === key) || null
}

/**
 * 纯文字版账号列表（发不出卡片时的兜底）：一行一个号，★ 是默认号。
 *
 * @param {string} [userId=''] 这些号属于谁（QQ 号）
 * @param {object} [options]
 * @param {boolean} [options.mask=false] 打码账号号
 * @param {boolean} [options.maskOwner=false] 打码扫码人 QQ
 * @returns {string} 多行文本；一个号都没有时给扫码引导
 */
export function accountText (userId = '', { mask = false, maskOwner = false } = {}) {
  const accounts = listAccounts(userId)
  if (!accounts.length) return kingAuthTip()

  const usable = accounts.filter(isUsableAuth).length
  return [
    `营地账号：共 ${accounts.length} 个，可用 ${usable} 个（★ 是默认号）`,
    '',
    ...accounts.map((account, index) => accountLine(account, index, { mask, maskOwner })),
    '',
    '切换：「#王者切换账号 序号」，删除：「#王者删除账号 序号」'
  ].join('\n')
}

/**
 * 平台名统一成人话：qq / wx / vx / wechat / manual → QQ / 微信 / 手动。
 *
 * @param {string} [platform=''] 账号记录里的平台标记
 * @returns {string} 中文平台名；认不出来原样返回，空值写「扫码」
 */
export function platformText (platform = '') {
  const raw = toText(platform).toLowerCase()
  if (PLATFORM_TEXT[raw]) return PLATFORM_TEXT[raw]
  return raw ? toText(platform) : '扫码'
}

/**
 * 扫码人 QQ 的头像地址：账号还没绑角色、排行榜里也没有头像时拿它兜底。
 *
 * @param {string|number} [qq=''] QQ 号
 * @returns {string} qlogo 地址；空值给空串（模板那边会画首字母）
 */
export function qqAvatarUri (qq = '') {
  const id = toText(qq).replace(/\D/g, '')
  return id ? `https://q1.qlogo.cn/g?b=qq&nk=${id}&s=640` : ''
}

/**
 * 账号列表 → 卡片行：序号、平台、角色说明、可用状态全在这里定死，模板只负责摆。
 *
 * `stateOk` 同时要求「登录信息完整」且「不在频控冷却里」，模板靠它决定绿点还是灰点。
 *
 * @param {string} [userId=''] 这些号属于谁（QQ 号）
 * @returns {Array<object>} 一行一个号（index / id / nick / initial / kind / roleText / usable / silence / isDefault / state …）
 */
export function accountRows (userId = '') {
  const accounts = listAccounts(userId)
  const defaultId = toText(defaultAccountId(userId))

  return accounts.map((account, index) => {
    const id = toText(account.id || account.userId)
    const nick = toText(account.nick)
    const owner = ownerOf(account)
    const role = toText(account.roleName || account.roleId)
    const server = toText(account.serverName)
    const level = toText(account.roleLevel)
    const usable = isUsableAuth(account)
    const silence = silenceLeftMs(account)
    const storedAt = toText(account.loginAt || account.updatedAt)
    const kind = platformText(account.platform)

    return {
      index: index + 1,
      id,
      nick,
      initial: (nick || id || '?').slice(0, 1).toUpperCase(),
      owner,
      ownerText: owner ? `QQ ${owner}` : '',
      kind,
      storeText: kind === '扫码' ? '扫码存下' : `${kind}扫码存下`,
      avatar: '',
      roleId: toText(account.roleId),
      roleText: role
        ? `角色：${role}${server ? `（${server}${level ? ` · ${level} 级` : ''}）` : ''}`
        : '角色：还没绑，发「#我的营地」会自动绑上',
      loginText: storedAt ? `存于 ${timeText(storedAt)}` : '',
      usable,
      silence,
      isDefault: id === defaultId,
      stateOk: usable && !silence,
      state: usable
        ? (silence ? `暂停中 ${Math.ceil(silence / 60000)} 分钟` : '可用')
        : (toText(account.invalidReason) ? '登录信息已过期' : '登录信息不完整')
    }
  })
}

/**
 * 头像与角色名：头像优先用这个角色在排行榜里那张（官方口径），其次账号自己的、最后扫码人的 QQ 头像；
 * 角色取这个号名下第一个（跟「#王者切换角色」编号一致），号池里的 roleName 常年是空的。
 *
 * 头像要下载再转 data URI（卡片里直接放 http 地址在部分客户端不显示），所以是异步的。
 *
 * @param {Array<object>} [rows=[]] `accountRows` 的产物
 * @param {object} [options]
 * @param {Map<string, Array<object>>|null} [options.rolesByAccount=null] 账号 ID → 角色列表（已知角色时传进来，省一次推断）
 * @returns {Promise<Array<object>>} 补好 `avatar` 与 `roleText` 的行
 */
export async function paintAccountAvatars (rows = [], { rolesByAccount = null } = {}) {
  const rolesOf = row => {
    const listed = rolesByAccount instanceof Map ? rolesByAccount.get(toText(row.id)) : null
    return Array.isArray(listed) ? listed : []
  }

  const withRole = rows.map(row => {
    const roles = rolesOf(row)
    const first = roles[0]
    const roleId = toText(first?.roleId) || toText(row.roleId)
    if (!first) return { ...row, roleId, roleCount: roles.length || row.roleCount }

    const name = toText(first.roleName)
    const server = toText(first.serverName)
    const level = toText(first.roleLevel)
    return {
      ...row,
      roleId,
      roleName: name || row.roleName,
      roleCount: roles.length || row.roleCount,
      roleText: `角色：${name}${server ? `（${server}${level ? ` · ${level} 级` : ''}）` : ''}`
    }
  })

  const uris = await imageUris(
    withRole.map(row => rankFaceOf(row.roleId) || toText(row.avatar) || qqAvatarUri(row.owner)),
    { width: 96, height: 96, limit: 6, referer: CAMP_REFERER }
  )
  return withRole.map((row, index) => ({ ...row, avatar: uris[index] || toText(row.avatar) || '' }))
}

/**
 * 账号卡（`#王者账号`）的模板数据。
 *
 * @param {string} [userId=''] 这些号属于谁（QQ 号）
 * @param {object} [options]
 * @param {boolean} [options.avatars=true] 要不要下头像；离线渲染 / 探针里关掉能省一轮网络
 * @returns {Promise<{logoSrc: string, genTime: string, rows: Array<object>, total: number, usable: number, expired: number, defaultNo: number, note: string}>} 模板数据；`defaultNo` 是默认号序号，0 表示没有
 */
export async function accountCardView (userId = '', { avatars = true } = {}) {
  const listed = accountRows(userId)
  const rows = avatars ? await paintAccountAvatars(listed) : listed
  const usable = rows.filter(row => row.usable).length
  const star = rows.find(row => row.isDefault)

  return {
    logoSrc: logoUri(),
    genTime: new Date().toLocaleString('zh-CN', { hour12: false }),
    rows,
    total: rows.length,
    usable,
    expired: rows.length - usable,
    defaultNo: star ? star.index : 0,
    note: '★ 是默认号，只有主人能用。想看营地主页，发「#我的营地」。'
  }
}

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

/**
 * `#王者切换账号 2`：把默认号切成另一个（序号或账号号都认）。
 *
 * 切过去但登录信息不完整时照样切，只是提醒要重扫码 —— 用户点错了还能再切回来。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<void>} 结果直接回复到会话
 */
export async function kingUseAccount (e) {
  if (!(await kingGuard(e))) return

  const token = accountArgOf(e.msg, '切换')
  if (!token) return kingReply(e, `要切哪个？先发「#我的营地」看有哪些号，再发「#王者切换账号 2」\n${kingAuthTip()}`)

  const target = resolveTarget(token, e.user_id)
  if (!target) return kingReply(e, `你自己的账号里没找到「${token}」\n${kingAuthTip()}`)

  const done = setDefaultAccount(target.id, e.user_id)
  if (!done.ok) return kingReply(e, done.reason)

  if (!isUsableAuth(target)) {
    return kingReply(e, `默认账号已经切到 ${toText(target.id)}，但这个号的登录信息不完整，得重新扫码`)
  }
  return kingReply(e, `默认账号已经切到 ${toText(target.id)}${target.nick ? `（${target.nick}）` : ''}`)
}

/**
 * `#王者删除账号 2`：删掉自己的一个号（只删自己的，别人的号碰不到）。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<void>} 结果直接回复到会话
 */
export async function kingDelAccount (e) {
  if (!(await kingGuard(e))) return

  const token = accountArgOf(e.msg, '删除')
  if (!token) return kingReply(e, `要删哪个？先发「#我的营地」看有哪些号，再发「#王者删除账号 2」\n${kingAuthTip()}`)

  const target = resolveTarget(token, e.user_id)
  if (!target) return kingReply(e, `你自己的账号里没找到「${token}」\n${kingAuthTip()}`)

  const done = removeAccount(target.id, e.user_id)
  if (!done.ok) return kingReply(e, done.reason)
  return kingReply(e, `已经把 ${toText(target.id)} 删掉，你自己还剩 ${done.left} 个`)
}

/**
 * `#王者校验账号 [序号]`：真去营地问一遍，看登录信息还有效没。
 *
 * 不带参数就全量校验可用号；校验是网络活，先回一句「要等」，免得用户以为没反应。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<void>} 结果直接回复到会话（逐号一行 ✅ / ⚠️）
 */
export async function kingCheckAccount (e) {
  if (!(await kingGuard(e))) return

  const token = accountArgOf(e.msg, '校验')
  const targets = token ? [resolveTarget(token, e.user_id)].filter(Boolean) : usableAccounts(e.user_id)
  if (!targets.length) {
    return kingReply(e, token ? `你自己的账号里没找到「${token}」` : kingAuthTip())
  }

  await kingReply(e, `开始检查 ${targets.length} 个账号，要点时间…`)

  const lines = []
  for (const target of targets) {
    const one = await refreshAccount(target.id)
    lines.push(`${one.ok ? '✅' : '⚠️'} ${one.message}`)
  }
  return kingReply(e, lines.join('\n'))
}

/**
 * `#王者绑定 营地ID`：只记看哪个角色，不存登录信息，所以别人的 ID 也能绑。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<boolean|void>} 绑上返回 false（交给 kingReply 回包）；参数不对时回一段用法
 */
export async function kingBindRole (e) {
  if (!(await kingGuard(e))) return false

  const owner = toText(e.user_id)
  const roleId = normRoleId(grab(e.msg, /绑定[^\d]*?(\d+)/))
  if (!roleId) return kingReply(e, BIND_USAGE)

  const info = roleInfoOf(roleId)
  const mine = accountsOwningRole(roleId, owner)
  const usable = usableAccounts(owner)
  const done = setBind(owner, {
    roleId,
    roleName: info.roleName,
    serverName: info.serverName,
    accountId: info.accountId,
    byUser: owner
  })
  if (!done.ok) return kingReply(e, done.reason)

  log.mark(`营地ID绑定：${maskUserId(owner)} → ${maskUserId(roleId)}`)

  const lines = [`已经绑定营地角色 ${roleId}${info.roleName ? `（${info.roleName}${info.serverName ? ` · ${info.serverName}` : ''}）` : ''}`]

  lines.push(info.accountId
    ? (info.accountId === owner
        ? '这个角色就在你自己扫码存下的登录信息里，查数据、开推送都用它'
        : `这个角色在 ${info.accountId} 扫码存下的登录信息里，手动查询我会优先用它（营地ID 是别的号也能绑）`)
    : '这个 ID 我还没在任何登录信息里见过，先按营地账号去试着查；要是查不到，发「#王者QQ扫码」把营地号扫进来我就能认出它')

  lines.push(mine.length || usable.length
    ? '上下线与战绩推送会定时检查，只用你自己扫码存下的号；已经能查到的角色，发「#开启王者战绩推送」就会推到本群'
    : '推送只认你自己扫码存的号，你还没存。想开推送发「#王者QQ扫码」；平时查数据会借别人的号，不受影响')

  return kingReply(e, lines.join('\n'))
}

/**
 * `#王者解绑`：解掉角色绑定，之后查的就是默认账号本人的主页。
 *
 * @param {object} e Yunzai 消息事件
 * @returns {Promise<boolean|void>} 解绑成功返回 false；本来没绑就回一句
 */
export async function kingUnbindRole (e) {
  if (!(await kingGuard(e))) return false

  const done = delBind(e.user_id)
  if (!done.ok) return kingReply(e, done.reason)
  return kingReply(e, '已经解绑了，之后再发「#我的营地」查的就是你默认账号本人的主页')
}

/**
 * `#王者我是谁`（以及诊断里那一块）：把「绑了谁、默认号是谁、还能借几个号」讲清楚。
 *
 * @param {object} e Yunzai 消息事件
 * @param {object} [options]
 * @param {boolean} [options.mask=false] 打码账号号（群里回包用）
 * @returns {Array<string>} 几行状态文案，调用方自己 join
 */
export function kingWhoami (e, { mask = false } = {}) {
  const bind = resolveBind({ userId: e.user_id })
  const account = findAccount(defaultAccountId(e.user_id), e.user_id)
  const bits = []

  bits.push(bind.roleId
    ? `绑定的营地角色：${bind.roleId}${bind.roleName ? `（${bind.roleName}）` : ''}`
    : '还没绑定营地角色：发「#王者绑定 营地ID」绑一个，或者发「#王者QQ扫码」扫上会自动绑本人角色')

  if (account) {
    const left = silenceLeftMs(account)
    bits.push(`默认账号：${mask ? maskUserId(account.id) : account.id}${account.nick ? `（${account.nick}）` : ''}${left ? `（还要等 ${Math.ceil(left / 60000)} 分钟）` : ''}`)
  } else {
    bits.push(kingAuthTip())
  }

  const usable = usableAccounts(e.user_id).length
  bits.push(`你扫码存下的可用登录信息：${usable} 个（手动查询还会借别人的号，上下线与战绩推送只用这 ${usable} 个）`)

  return bits
}

/** 绑定说明那一卡走子目录实现，这里只做转出（`bindHelpView` 给图片卡，`kingBindHelp` 给指令） */
export { BIND_HELP_TITLE, bindHelpView, kingBindHelp } from './account/help.js'
