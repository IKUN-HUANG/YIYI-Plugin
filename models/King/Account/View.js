/**
 * @file Account模块的一片实现。
 *
 * @module models/Account/View
 */
import { toText, cleanText, isUsableAuth } from '../Common.js'
import { kingAuthTip } from '../Say.js'
import { logoUri, imageUris, timeText } from '../Card.js'
import { CAMP_REFERER } from '../Api.js'
import { RankFaceOf } from '../Face.js'
import { PLATFORM_TEXT } from './Consts.js'
import { listAccounts, accountLine, defaultAccountId, ownerOf, silenceLeftMs } from '../Auth.js'
import { roleInfoOf } from '../Auth/Roles.js'

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
    const role = cleanText(account.roleName) || toText(account.roleId)
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

    /** 角色名有可能是空的（营地对某些号不给 roleName）：再回角色关系里找一遍，
     *  还找不到就挂上角色 ID —— 别让卡片上只剩「角色：（区服 · 30 级）」这一截，看着像坏了 */
    const name = [first.roleName, row.roleName, roleInfoOf(roleId)?.roleName]
      .map(cleanText)
      .find(Boolean) || (roleId ? `#${roleId}` : '未读出角色')
    const server = toText(first.serverName)
    const level = toText(first.roleLevel)
    return {
      ...row,
      roleId,
      roleName: name,
      roleCount: roles.length || row.roleCount,
      roleText: `角色：${name}${server ? `（${server}${level ? ` · ${level} 级` : ''}）` : ''}`
    }
  })

  const uris = await imageUris(
    withRole.map(row => RankFaceOf(row.roleId) || toText(row.avatar) || qqAvatarUri(row.owner)),
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
