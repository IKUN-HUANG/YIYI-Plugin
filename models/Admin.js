/**
 * @file `#伊伊设置` 的全流程：项表、命令匹配、校验、落盘、回执。
 * @module models/Admin
 *
 * 帮助菜单的数据面在 ./Admin/help.js、更新检查在 ./Admin/update.js；本文件只管
 * 「用户说了一句话 → 该改哪个键 → 改成什么 → 回什么」，末尾把另两块原样转出。
 *
 * 副作用：写 config.yaml（见 writeSetting）。
 */
import { normClock, splitList } from '#yiyi.utils'
import { Config } from '#yiyi.components'

/** 写死了 cmd 就用它，否则拼「前缀 + 第一个别名」——回执、用法、面板三处必须同一形态 */
const cmdOf = item => item.cmd || `${item.prefix || '#伊伊设置'}${item.alias[0]}`

const CLEAR_WORDS = ['清空', '空', '无', 'none', 'null', '-', '0']
const LIST_DEL_HEADS = ['-', '－', '—', '删除', '删掉', '移除', '去掉', '取消']
const LIST_ADD_HEADS = ['+', '＋', '添加', '增加', '追加']

const ON = ['开', '开启', '打开', '启用', 'on', 'true', '1', 'yes']
const OFF = ['关', '关闭', '禁用', 'off', 'false', '0', 'no']

/**
 * 把「开 / 开启 / 关 / 关闭」这类口语写法翻成布尔。
 *
 * @param {string} text 用户写的那一段，允许空
 * @returns {boolean|null} 认不出来回 null，由调用方去发用法回执
 */
export function boolValue (text) {
  const word = String(text ?? '').trim().toLowerCase()
  if (ON.includes(word)) return true
  if (OFF.includes(word)) return false
  return null
}

/** 面板的全部设置项。
 *
 * group 决定落在哪张分组卡，path 是 config.yaml 的键路径，type 决定校验方式；
 * 带 mask 的项只报「是否配置」不亮内容，restart 的项改完需重启才生效。 */
export const SETTINGS = [
  { group: '基础', label: 'Bot 名字', alias: ['名字', '昵称', 'bot名'], path: ['name'], type: 'text', desc: '回消息时用的名字，留空就用触发 Bot 的昵称' },
  { group: '基础', label: '插件优先级', alias: ['插件优先级', '解析优先级', '优先级'], path: ['priority'], type: 'number', desc: '数值越小越优先，改动后需重启', restart: true },
  { group: '基础', label: '插件自动更新', alias: ['插件更新', '自动更新插件', '插件自动更新'], path: ['autoUpdate'], type: 'bool', desc: '常驻轮询 git 上游，一有新提交就拉取并重启（框架没给 Bot.restart 就提示手动重启；没变动就静默）' },
  { group: '基础', label: '插件更新间隔', alias: ['插件更新间隔', '插件更新频率', '更新间隔'], path: ['autoUpdateInterval'], type: 'number', min: 1, max: 1440, desc: '隔几分钟查一次上游（分钟，默认 10），改完下一次心跳就按新值算；本地改动撞上上游时私聊你一次然后静默 12 小时' },
  { group: '基础', label: '背景图源开关', alias: ['背景图源开关', '图源', '图片源', '背景图源'], path: ['bgSource'], type: 'bool', desc: '开启走「背景图片接口」，关闭只用本地 resources/Img/ 里的图' },
  { group: '基础', label: '背景图片接口', alias: ['背景图片接口', '背景接口', '背景API', '帮助背景接口'], path: ['helpBgApi'], type: 'text', mask: true, example: '接口地址', desc: '留空就用本地 resources/Img/ 里的图（随机挑一张）；只显示是否配置，不亮地址' },
  { group: '基础', label: '网易云 Cookie', alias: ['网易云Cookie', '网易云ck', '网抑云Cookie', '网抑云ck', '点歌ck'], path: ['music', 'cookie'], type: 'text', mask: true, maskWord: 'Cookie', example: 'MUSIC_U 的值', desc: '填 MUSIC_U 的值（或整条 Cookie）：配了才能点 VIP 歌，只显示是否配置' },
  { group: '基础', label: '网抑云点歌接口', alias: ['网抑云接口', '网抑云点歌接口', '点歌接口', '点歌API'], path: ['music', 'apiUrl'], type: 'text', mask: true, example: '服务地址', desc: 'NeteaseCloudMusicApiEnhanced 地址（只显示是否配置，不亮地址）' },

  { group: '平台解析', label: '抖音解析', alias: ['抖音', '抖音解析'], path: ['platforms', 'douyin'], type: 'bool', desc: '发送抖音链接时自动解析' },
  { group: '平台解析', label: '快手解析', alias: ['快手', '快手解析'], path: ['platforms', 'kuaishou'], type: 'bool', desc: '发送快手链接时自动解析' },
  { group: '平台解析', label: 'B站解析', alias: ['B站', 'b站', 'bili'], path: ['platforms', 'bilibili'], type: 'bool', desc: '发送B站链接时自动解析' },
  { group: '平台解析', label: '小红书解析', alias: ['小红书', '小红书解析'], path: ['platforms', 'xiaohongshu'], type: 'bool', desc: '发送小红书链接时自动解析' },
  { group: '平台解析', label: '抖音整合转发', alias: ['抖音整合', '抖音整合转发', '抖音转发'], path: ['mergeForwards', 'douyin'], type: 'bool', desc: '抖音：卡片 / 完整简介 / 音乐 / 图集或视频 / 评论卡整合成一条合并转发发出' },
  { group: '平台解析', label: '快手整合转发', alias: ['快手整合', '快手整合转发', '快手转发'], path: ['mergeForwards', 'kuaishou'], type: 'bool', desc: '快手：把这次的卡片 / 简介 / 图集或视频整合成一条合并转发发出' },
  { group: '平台解析', label: 'B站整合转发', alias: ['B站整合', 'b站整合', 'bili整合', 'B站整合转发', 'b站整合转发', 'bili整合转发'], path: ['mergeForwards', 'bilibili'], type: 'bool', desc: 'B站：把这次的卡片 / 简介 / 图集或视频 / 评论卡整合成一条合并转发发出' },
  { group: '平台解析', label: '小红书整合转发', alias: ['小红书整合', '小红书整合转发', '小红书转发'], path: ['mergeForwards', 'xiaohongshu'], type: 'bool', desc: '小红书：把这次的卡片 / 简介 / 图集或视频 / 评论卡整合成一条合并转发发出' },
  { group: '平台解析', label: '评论截图', alias: ['评论截图', '热评截图', '评论图片', '热评'], path: ['commentCard'], type: 'bool', desc: '解析成功后额外发一张热评卡片（下面是分平台开关）' },
  { group: '平台解析', label: '评论条数', alias: ['评论条数', '热评条数'], path: ['commentLimit'], type: 'number', min: 1, max: 10, desc: '热评卡片最多展示几条' },
  { group: '平台解析', label: '抖音评论', alias: ['抖音评论', '抖音评论卡', '抖音热评'], path: ['commentCards', 'douyin'], type: 'bool', desc: '抖音发评论卡片（走自建 API，不看 IP，稳定）' },
  { group: '平台解析', label: 'B站评论', alias: ['B站评论', 'B站评论卡', 'b站评论', 'b站评论卡', 'bili评论', 'bili评论卡', 'B站热评'], path: ['commentCards', 'bilibili'], type: 'bool', desc: 'B站发评论卡片（走官方 wbi 接口，不看 IP，稳定）' },
  { group: '平台解析', label: 'B站代理端口', alias: ['B站代理端口', '代理端口', 'bili端口'], path: ['biliProxyPort'], type: 'number', min: 1, max: 65535, desc: '内嵌视频代理端口，改完立刻换端口，旧端口当场放掉' },
  { group: '平台解析', label: 'B站代理主机', alias: ['B站代理主机', '代理主机', 'bili主机'], path: ['biliProxyHost'], type: 'text', desc: 'Docker 访问宿主机的地址，host 模式填 127.0.0.1' },
  { group: '平台解析', label: '视频大小阈值', alias: ['视频阈值', '阈值', '视频大小'], path: ['mbMax'], type: 'number', desc: '超过该大小只发短链（MB）' },

  { group: '表情', label: '表情功能', alias: ['表情功能', '表情', '表情包功能', '表情包'], path: ['memes', 'enable'], type: 'bool', desc: '发送表情名称即可制作' },
  { group: '表情', label: '表情优先级', alias: ['表情优先级', '表情包优先级'], path: ['memes', 'priority'], type: 'number', allowEmpty: true, emptyText: '跟随插件优先级', restart: true, desc: '表情功能的 Yunzai 优先级，数值越小越优先；与「插件优先级」相互独立，填「清空」就跟随全局，改动后需重启' },
  { group: '表情', label: '表情接口', alias: ['表情接口', '表情地址', '表情包接口'], path: ['memes', 'apiUrl'], type: 'text', mask: true, example: '服务地址', desc: 'meme-generator 服务地址（只显示是否配置，不亮地址）' },
  { group: '表情', label: '详情后缀', alias: ['详情后缀', '详情词'], path: ['memes', 'detailArgs'], type: 'list', cmd: '#伊伊详情后缀', example: '查看', desc: '「#伊伊详情后缀 查看」加一项，「#伊伊详情后缀-查看」删掉' },
  { group: '表情', label: '禁用表情', alias: ['禁用表情', '屏蔽表情'], path: ['memes', 'disabled'], type: 'list', cmd: '#伊伊禁用表情', example: '摸头', desc: '「#伊伊禁用表情 摸头」加一项，「#伊伊禁用表情-摸头」删掉，填「清空」全清' },
  { group: '表情', label: '主人反制', alias: ['主人反制', '反制'], path: ['memes', 'counter'], type: 'bool', cmd: '#伊伊反制', desc: '开着时素材里主人 QQ 的头像排在最后就提到最前面；触发者自己是主人时不反制' },
  { group: '表情', label: '反制表情', alias: ['反制表情'], path: ['memes', 'counterCodes'], type: 'list', cmd: '#伊伊反制表情', example: '摸头', desc: '只有列表里的表情才反制；填「清空」= 所有表情都反制' },
  { group: '表情', label: '自动更新', alias: ['自动更新', '表情自动更新'], path: ['memes', 'autoUpdate'], type: 'bool', desc: '每天定时清空本地表情数据并重新拉取' },
  { group: '表情', label: '更新时间', alias: ['更新时间', '自动更新时间'], path: ['memes', 'autoUpdateTime'], type: 'time', example: '02:30', desc: '每天几点自动更新（HH:MM，24 小时制）' }
]

/** 三张分组卡：别名是用户打的那个词，count 由 groupIndex 现算 */
export const GROUP_CMDS = [
  { group: '基础', alias: '基础设置', cmd: '#伊伊基础设置', desc: 'Bot 名字、插件优先级、插件自动更新与间隔、背景图源开关与背景图片接口、网易云 Cookie、网抑云点歌接口' },
  { group: '平台解析', alias: '解析设置', cmd: '#伊伊解析设置', desc: '四个平台解析开关、四个整合转发开关、评论截图与条数、抖音 / B站评论开关、B站代理、视频阈值' },
  { group: '表情', alias: '表情设置', cmd: '#伊伊表情设置', desc: '表情开关与接口、表情优先级、详情后缀、禁用表情、主人反制与反制列表、自动更新与时间' }
]

/** `#伊伊基础设置` 这类整组命令；必须排在通用设置规则前面，否则会被当成项名 */
export const GROUP_CMD_RE = new RegExp(`^#?(?:伊伊|YIYI)(${GROUP_CMDS.map(g => g.alias).join('|')})$`)

/**
 * 按别名找分组卡。
 *
 * @param {string} word 正则里 $(GROUP_CMDS.map...) 捕获到的那一段
 * @returns {object|null} 没这一组回 null
 */
export function findGroupCmd (word) {
  return GROUP_CMDS.find(g => g.alias === word) || null
}

/**
 * 入口卡要的分组索引。
 *
 * @returns {Array<object>} 每组一条，count 是该组的项数
 */
export function groupIndex () {
  return GROUP_CMDS.map(g => ({ ...g, count: SETTINGS.filter(item => item.group === g.group).length }))
}

/** 读当前值 —— 面板与回执必须是同一个取值口径，改这里等于改全部 */

/**
 * 按路径读当前值。
 *
 * @param {Array<string>} keys config.yaml 的键路径
 * @returns {*} 读不到回 undefined（中间断链也当 undefined）
 */
export function currentValue (keys) {
  return keys.reduce((acc, key) => (acc == null ? acc : acc[key]), Config.getDefOrConfig('config'))
}

/**
 * 敏感项（Cookie / 接口地址）只报「是否配置」，绝不把内容亮到群里。
 *
 * @param {object} item SETTINGS 里的那一项
 * @param {*} value 当前值
 * @returns {string|null} 非敏感项回 null；敏感项回「已配置X / 未配置X」
 */
export function maskedValue (item, value) {
  if (!item.mask) return null
  const word = item.maskWord || 'API'
  return value === '' || value == null ? `未配置${word}` : `已配置${word}`
}

/**
 * 把值翻成给人看的一行；敏感项走 maskedValue，布尔写「开启 / 关闭」。
 *
 * @param {object} item SETTINGS 里的那一项
 * @param {*} value 当前值
 * @param {{empty?: string}} [opts] 空值显示成什么，默认「空」
 * @returns {string} 给人看的那一行
 */
export function displayValue (item, value, { empty = '空' } = {}) {
  const masked = maskedValue(item, value)
  if (masked) return masked
  if (item.type === 'bool') return value !== false ? '开启' : '关闭'
  if (Array.isArray(value)) return value.join('、') || empty
  if (item.allowEmpty && (value === '' || value == null)) return item.emptyText || empty
  return value === '' || value == null ? empty : String(value)
}

/**
 * 模板要的 rows：label / value / state / desc / cmd / next，按 group 分桶。
 *
 * @param {string} [group] 只要这一组；不传则出全部（入口卡）
 * @returns {Array<{group: string, list: Array<object>}>} 分组后的行；每组 list 非空
 */
export function settingsGroups (group) {
  const groups = []

  for (const item of SETTINGS) {
    if (group && item.group !== group) continue

    let bucket = groups.find(g => g.group === item.group)
    if (!bucket) {
      bucket = { group: item.group, list: [] }
      groups.push(bucket)
    }

    const raw = currentValue(item.path)
    const empty = raw === '' || raw == null
    const shown = displayValue(item, raw, { empty: '（空）' })

    bucket.list.push({
      label: item.label,
      value: shown,
      state: item.type === 'bool' ? (raw !== false ? 'on' : 'off') : (item.mask ? (empty ? 'off' : 'on') : 'text'),
      desc: item.desc || '',
      cmd: cmdOf(item),
      next: item.type === 'bool'
        ? '开启/关闭'
        : (item.mask ? ` <${item.example || '新值'}>` : ` ${shown}`)
    })
  }

  return groups
}

/** 认命令 —— 前缀之外的整段交给 matchSetting，最长别名优先才不会被短别名抢走 */

/**
 * `#伊伊设置抖音解析关` → `抖音解析关`。
 *
 * @param {string} msg 整条消息
 * @returns {string} 前缀之外的部分（可能是空串，代表用户只想看入口卡）
 */
export function settingRest (msg) {
  return (/^#?(?:伊伊|YIYI)(?:设置|配置|admin)([\s\S]*)$/.exec(String(msg ?? ''))?.[1] ?? '').trim()
}

/** 有独立命令的列表项（详情后缀 / 禁用表情 / 反制 / 反制表情）：它们有自己的一条规则 */
const LIST_SETTINGS = SETTINGS.filter(item => item.cmd)
const LIST_ALIASES = LIST_SETTINGS.flatMap(item => item.alias).sort((a, b) => b.length - a.length)

/** `#伊伊禁用表情 摸头` 这类带独立命令的列表项；别名一样最长优先 */
export const LIST_CMD_RE = new RegExp(`^#?(?:伊伊|YIYI)(${LIST_ALIASES.join('|')})([\\s\\S]*)$`)

/**
 * 按别名找带独立命令的列表项。
 *
 * @param {string} label LIST_CMD_RE 捕获到的那一段
 * @returns {object|null} 没这一项回 null
 */
export function findListCmd (label) {
  return LIST_SETTINGS.find(item => item.alias.includes(label)) || null
}

/**
 * 按别名认设置项，最长别名优先 ——「插件更新间隔」不能被「插件更新」抢走。
 *
 * @param {string} rest 前缀之外的整段
 * @returns {{item: object, value: string}|null} 没认出来回 null
 */
export function matchSetting (rest) {
  const raw = String(rest ?? '')
  let hit = null

  for (const item of SETTINGS) {
    for (const alias of item.alias) {
      if (raw.slice(0, alias.length).toLowerCase() !== alias.toLowerCase()) continue
      if (!hit || alias.length > hit.len) hit = { item, len: alias.length }
    }
  }

  if (!hit) return null
  const value = raw.slice(hit.len).replace(/^[\s=:：,，]+/, '').trim()
  return { item: hit.item, value }
}

/** 写 —— 校验不过一律回 reason，非法值绝不允许落到 config.yaml */

/**
 * 列表项的一次改动：加 / 删 / 清空 / 已经有了。
 *
 * @param {object} item SETTINGS 里的列表项
 * @param {string} value 用户写的原文（可能带 + / - 前缀）
 * @param {Array<string>} [current] 现在的值，默认现读配置
 * @returns {{ok: boolean, value?: Array<string>, action?: string, items?: Array<string>, reason?: string}}
 *   ok:false 时 reason 直接发进群
 */
export function resolveListValue (item, value, current = currentValue(item.path)) {
  const now = Array.isArray(current) ? current : []
  const text = String(value ?? '').trim()

  if (CLEAR_WORDS.includes(text.toLowerCase())) return { ok: true, value: [], action: 'clear', items: [...now] }

  let action = 'add'
  let body = text
  const delHead = LIST_DEL_HEADS.find(head => text.startsWith(head))
  const addHead = LIST_ADD_HEADS.find(head => text.startsWith(head))
  if (delHead) {
    action = 'del'
    body = text.slice(delHead.length)
  } else if (addHead) {
    body = text.slice(addHead.length)
  }

  const items = splitList(body)
  if (!items.length) {
    return { ok: false, reason: `「${item.label}」要填内容，例：${item.example ? `${cmdOf(item)} ${item.example}` : `${cmdOf(item)} 值`}` }
  }

  if (action === 'del') {
    const gone = items.filter(v => now.includes(v))
    if (!gone.length) {
      return { ok: false, reason: `「${item.label}」里没有 ${items.join('、')}（现在：${now.join('、') || '空'}）` }
    }
    return { ok: true, value: now.filter(v => !items.includes(v)), action, items: gone }
  }

  const fresh = items.filter(v => !now.includes(v))
  if (!fresh.length) return { ok: true, value: now, action: 'have', items }

  return { ok: true, value: [...now, ...fresh], action, items: fresh }
}

/**
 * 按 type 校验后写回 config.yaml。
 *
 * @param {object} item SETTINGS 里的那一项
 * @param {*} value 用户写的原文
 * @returns {{ok: boolean, value?: *, action?: string, items?: Array<string>|null, reason?: string}}
 *   ok:false 时 reason 直接发进群；action 为 set / clear / add / del / have
 */
export function writeSetting (item, value) {
  let action = 'set'
  let items = null

  if (item.type === 'bool') {
    const flag = boolValue(value)
    if (flag === null) return { ok: false, reason: `${item.label} 只能填 开启 / 关闭（也可以只写 开 / 关）` }
    value = flag
  } else if (item.type === 'enum') {
    if (!item.values.includes(value)) return { ok: false, reason: `${item.label} 只能填 ${item.values.join(' / ')}` }
  } else if (item.type === 'number') {
    if (item.allowEmpty && CLEAR_WORDS.includes(String(value ?? '').trim().toLowerCase())) {
      Config.setYaml('config', item.path, '')
      return { ok: true, value: '', action: 'clear' }
    }
    const num = Number(value)
    if (!Number.isFinite(num)) return { ok: false, reason: `${item.label} 需要填数字` }
    if (item.min != null && num < item.min) return { ok: false, reason: `${item.label} 不能小于 ${item.min}` }
    if (item.max != null && num > item.max) return { ok: false, reason: `${item.label} 不能大于 ${item.max}` }
    value = num
  } else if (item.type === 'time') {
    const clock = normClock(value)
    if (!clock) return { ok: false, reason: `${item.label} 要填 HH:MM，例：${item.example || '02:30'}` }
    value = clock
  } else if (item.type === 'list') {
    const ret = resolveListValue(item, value)
    if (!ret.ok) return ret
    value = ret.value
    action = ret.action
    items = ret.items
  } else if (item.type === 'text') {
    const text = String(value ?? '').trim()
    if (CLEAR_WORDS.includes(text.toLowerCase())) {
      value = ''
      action = 'clear'
    } else {
      value = text
    }
  }

  Config.setYaml('config', item.path, value)
  return { ok: true, value, action, items }
}

/** 回执 —— 面板渲染失败时才走这里，文字必须自己在群里说得清 */

/**
 * 只写了项目名没写值 → 教怎么用。
 *
 * @param {object} item SETTINGS 里的那一项
 * @returns {string} 多行用法文本（含当前值）
 */
export function settingUsage (item) {
  const cmd = cmdOf(item)
  const now = displayValue(item, currentValue(item.path))

  if (item.type === 'bool') {
    return [
      '用法：',
      `${cmd}开启　/　${cmd}关闭　→ 也可以只写 开 / 关`,
      `当前值：${now}`
    ].join('\n')
  }

  if (item.type === 'list') {
    return [
      '用法：',
      `${cmd} ${item.example || '值1,值2'}　→ 添加（逗号分隔可加多个）`,
      `${cmd}-${item.example || '值'}　→ 删除`,
      `${cmd}清空　→ 全部清掉`,
      `当前值：${now}`
    ].join('\n')
  }

  if (item.type === 'text') {
    return [
      '用法：',
      `${cmd}<${item.example || '值'}>　→ 设置`,
      `${cmd}清空　→ 清空（回到默认）`,
      `当前值：${now}`
    ].join('\n')
  }

  if (item.allowEmpty) {
    return [
      '用法：',
      `${cmd}<值>　→ 设置`,
      `${cmd}清空　→ ${item.emptyText || '用默认值'}`,
      `当前值：${now}`
    ].join('\n')
  }

  return `用法：${cmd}<值>\n当前值：${now}`
}

/**
 * 改完之后的文字回执（面板出得来时不用它，出不来才兜这一句）。
 *
 * @param {object} item SETTINGS 里的那一项
 * @param {*} value 改完之后的值
 * @param {{action?: string, items?: Array<string>|null}} [state] writeSetting 的结果
 * @returns {string} 一行回执
 */
export function settingApplied (item, value, { action = 'set', items = null } = {}) {
  const text = displayValue(item, value)

  if (action === 'clear') {
    return item.allowEmpty
      ? `已清空「${item.label}」，现在${item.emptyText || '用默认值'}`
      : `已清空「${item.label}」（现在是空的）`
  }
  if (action === 'have') return `「${item.label}」里已经有 ${items.join('、')} 了（现在：${text}）`
  if (action === 'add' || action === 'del') {
    const verb = action === 'add' ? '添加' : '删除'
    return `已${verb}「${item.label}」：${items.join('、')}（现在：${text}）`
  }

  const act = Array.isArray(value) && !value.length ? '清空' : '设置'
  return `已${act}「${item.label}」：${text}${item.restart ? '，重启后生效' : ''}`
}

/**
 * 帮助菜单的数据面（读 help.js、老配置迁移、背景图）。
 */
export * from './Admin/help.js'
/**
 * 更新检查（`#伊伊更新` 与每日自动检查）。
 */
export * from './Admin/update.js'
