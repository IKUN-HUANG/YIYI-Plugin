/**
 * @file 账号与绑定：对外只留这一个门。
 *
 * 真正的实现拆在同目录 `auth/` 下四块（存号、贴条、角色关系、展示），
 * 这里负责「绑定」这件事并把前面四块转出去 —— 卡片侧一直只用 `Auth.js`，
 * 内部分几片是内部的事，别再让调用方记路径。
 *
 * @module models/King/Auth
 */
import { createLogger, toText, pickValue } from '#yiyi.utils'
import { readUserPart, writeUserPart, listUserIds, listGroupIds, readGroupPart, writeGroupPart } from './core/store.js'
import { normRoleId, maskUserId } from './Common.js'
import { patchAccount, findAccount } from './auth/pool.js'
import { hoursOf } from './auth/marks.js'
import { normalizeBind } from './core/schema.js'

/** 号池：读写账号记录、找默认号、列可用号（`auth/pool.js` 的实现） */
export * from './auth/pool.js'
/** 账号状态：静默剩余时间、登录信息够不够用（`auth/state.js`） */
export * from './auth/state.js'
/** 状态标记：失效 / 限频的时长与读写（`auth/marks.js`） */
export * from './auth/marks.js'
/** 角色关系：哪个号名下有哪个角色、角色信息查询（`auth/roles.js`） */
export * from './auth/roles.js'

const log = createLogger('营地账号')


/**
 * 登录态失效：停用 `authInvalidHours` 小时（默认 24）。
 *
 * 为什么要把失效也记成「静默到某个时刻」：营地那边换码之后旧 token 不会立刻死透，
 * 不标记就会每条指令都拿废号去撞一次接口、每次等满超时。日志只在这里记一句 ——
 * 门面才知道是哪个号的哪次失败，`auth/marks.js` 只管写状态。
 * @param {*} id 营地账号 ID
 * @param {*} reason 原因（来自营地的错误归一结果）
 * @returns {*} patch 结果（`ok` 为 false 时说明这个号已经不在档里）
 */
export function markAuthInvalid (id, reason) {
  const hours = hoursOf('authInvalidHours', 24)
  if (!hours) return { ok: true }
  const until = Date.now() + hours * 3600000
  const ret = patchAccount(id, {
    invalidAt: new Date().toISOString(),
    invalidReason: toText(reason),
    rateLimitedUntil: Math.max(Number(findAccount(id)?.rateLimitedUntil) || 0, until)
  })
  if (ret.ok) log.warn(`账号 ${maskUserId(id)} 登录失效，停用 ${hours} 小时：${toText(reason)}`)
  return ret
}

/**
 * 被限频：静默 `rateLimitHours` 小时（默认 12），这期间绝不重试 —— 再撞只会更久。
 * @param {*} id 营地账号 ID
 * @param {*} reason 原因（通常是 `-30107 <endpoint>`）
 * @returns {*} patch 结果
 */
export function markRateLimited (id, reason) {
  const hours = hoursOf('rateLimitHours', 12)
  if (!hours) return { ok: true }
  const ret = patchAccount(id, {
    rateLimitedUntil: Date.now() + hours * 3600000,
    rateLimitReason: toText(reason)
  })
  return ret
}

const BIND_PART = 'bind'

/**
 * 读出所有个人绑定（`users/<QQ>.yaml` 的 `bind` 段）。
 *
 * 顺手清废料：0.0.82 起群绑定下线，老的 `group/<群号>.yaml` 里残留的 bind 一发现就删掉
 * （群文件本身要留着放群报订阅，所以只删这一段）。
 *
 * @returns {{users: Record<string, object>}} QQ → 绑定记录；没绑的人不出现在里面
 */
export function loadBinds () {
  const users = {}
  for (const id of listUserIds()) {
    const bind = readUserPart(id, BIND_PART)
    if (bind && toText(bind.roleId)) users[id] = bind
  }

  for (const id of listGroupIds()) {
    if (!readGroupPart(id, BIND_PART)) continue
    writeGroupPart(id, BIND_PART, null)
    log.mark(`清理废弃群绑定：群 ${id}`)
  }

  return { users }
}

/**
 * 整份写回绑定表：表里没有的人，他的 bind 段会被清空（搬家 / 还原时用这个口径）。
 *
 * @param {object} [binds={}] `{ users: { QQ: 绑定记录 } }`
 * @returns {{users: Record<string, object>}} 落盘后的绑定表
 */
export function saveBinds (binds = {}) {
  const users = binds.users && typeof binds.users === 'object' ? binds.users : {}

  for (const id of listUserIds()) if (!users[id]) writeUserPart(id, BIND_PART, null)
  for (const [id, bind] of Object.entries(users)) writeUserPart(id, BIND_PART, normalizeBind(bind))

  return { users }
}

/**
 * 绑定表的键就是 QQ 号的字符串形式 —— 统一走这里，免得有人拿 number 去查查不到。
 *
 * @param {string|number} value QQ 号
 * @returns {string} 键；空值是空串
 */
export function bindKey (value) {
  return toText(value)
}

/**
 * 这个人的绑定记录（原始形态，没归一）。
 *
 * @param {object} [params]
 * @param {string} [params.userId=''] QQ 号
 * @returns {{user: object|null}} 绑定记录；没绑是 null
 */
export function getBind ({ userId = '' } = {}) {
  const binds = loadBinds()
  const user = binds.users[bindKey(userId)]
  return { user: user && typeof user === 'object' ? user : null }
}

/**
 * 这个 QQ 绑的是哪个营地角色。群绑定已下线，只认个人档。
 *
 * 卡片侧都读这个（而不是直接读 yaml）：roleId 为空说明还没绑，调用方要引导去绑。
 *
 * @param {object} [params]
 * @param {string} [params.userId=''] QQ 号
 * @returns {{roleId: string, roleName: string, serverName: string, accountId: string, byUser: string, from: string}} 归一后的绑定；`from` 为 'user' 表示真的绑过
 */
export function resolveBind ({ userId = '' } = {}) {
  const { user } = getBind({ userId })
  const roleId = normRoleId(user?.roleId)
  return {
    roleId,
    roleName: toText(user?.roleName),
    serverName: toText(user?.serverName),
    accountId: toText(user?.accountId),
    byUser: toText(user?.byUser),
    from: roleId ? 'user' : ''
  }
}

/**
 * 写入 / 覆盖一个人的绑定。
 *
 * @param {string|number} key 绑定对象（QQ 号）
 * @param {object} [data={}] roleId / roleName / serverName / accountId / byUser
 * @returns {{ok: boolean, bind?: object, reason?: string}} `reason` 是可直接回给用户的话
 */
export function setBind (key, data = {}) {
  const id = bindKey(key)
  if (!id) return { ok: false, reason: '没给要绑定的对象' }

  const bind = normalizeBind({ ...data, updatedAt: new Date().toISOString() })
  if (!writeUserPart(id, BIND_PART, bind)) return { ok: false, reason: '数据文件写不进去，看一眼日志' }
  return { ok: true, bind }
}

/**
 * 解绑：只清 `bind` 段，不碰这个人的登录态与订阅。
 *
 * @param {string|number} key 绑定对象（QQ 号）
 * @returns {{ok: boolean, reason?: string}} 本来没绑也算失败（省得用户以为解过了）
 */
export function delBind (key) {
  const id = bindKey(key)
  if (!id || !readUserPart(id, BIND_PART)) return { ok: false, reason: '这个用户还没绑定过营地角色' }

  writeUserPart(id, BIND_PART, null)
  return { ok: true }
}

/**
 * 所有绑定摊平成行（运维面板列名单用）。
 *
 * @returns {Array<object>} 每行 `{ key, ...绑定字段 }`
 */
export function listBindEntries () {
  return Object.entries(loadBinds().users).map(([key, value]) => ({ key, ...value }))
}

/**
 * 请求头里跟账号相关的三个字段：老号可能没存，缺了就按营地客户端的默认值填。
 *
 * 默认值不是随便挑的：跟营地 App 发出来的一致，填错营地会当成异常请求。
 *
 * @param {object} account 号码记录
 * @returns {{gameAreaId: string, gameUserSex: string, kohDimGender: string}} 三个头部字段
 */
export function resolveAccountExtra (account) {
  return {
    gameAreaId: toText(pickValue(account?.gameAreaId, '1')),
    gameUserSex: toText(pickValue(account?.gameUserSex, '1')),
    kohDimGender: toText(pickValue(account?.kohDimGender, '2'))
  }
}
