/**
 * @file 表情包的「这条消息是不是别人的指令」判定。
 * @module models/Memes/Claim
 *
 * 表情包的兜底规则是「任意 60 字以内的短消息」，天生会撞上别的插件。
 * 与其猜别人家用什么词（点歌插件有小飞、有别的，命令名还会变），不如直接问宿主：
 * 把库里每个插件的规则拿出来试一遍，谁认领就让给谁。
 */

/** 用来识别「万能兜底」规则的探针：能匹配这些日常闲聊的规则不算认领 */
const NEUTRAL_PROBES = ['你好呀', '在吗在吗', '今天天气不错', '摸鱼摸鱼摸鱼']

/** 每个插件对象编译一次的规则表缓存 */
const RULE_CACHE = new WeakMap()

/**
 * 把插件的规则表编译成「正则 + 是否兜底」。
 *
 * 规则里的 `reg` 可能是字符串（云崽载入时才 `new RegExp`），也可能是正则字面量；
 * 带 `g` 的要去掉，否则 `lastIndex` 会让同一份缓存越测越不准。
 *
 * @param {object} plugin 宿主里注册的插件对象
 * @returns {Array<{ re: RegExp, catchAll: boolean }>} 编译结果
 */
function compiledRules (plugin) {
  const cached = RULE_CACHE.get(plugin)
  if (cached) return cached

  const out = []
  for (const rule of plugin.rule) {
    const reg = rule?.reg
    if (typeof reg !== 'string' && !(reg instanceof RegExp)) continue

    let re
    try {
      re = reg instanceof RegExp ? new RegExp(reg.source, reg.flags.replace(/g/g, '')) : new RegExp(reg)
    } catch {
      continue
    }

    out.push({ re, catchAll: NEUTRAL_PROBES.some(probe => re.test(probe)) })
  }

  RULE_CACHE.set(plugin, out)

  return out
}

/**
 * 宿主里注册的插件实例。
 *
 * 各家框架的暴露方式不一样：有的挂在 `Bot.plugin`，有的把加载器的 `priority`
 * 数组原样摊在实例上，还有的干脆什么都不暴露（TRSS / Miao 现在就是后者）。
 * 拿不到就返回空数组，调用方退回关键词白名单那一层。
 *
 * @returns {Array<object>} 能看到的插件实例
 */
async function hostPlugins () {
  const found = globalPlugins()
  if (found.length) return found

  /**
   * TRSS / Miao 只把加载器实例自己留着（`export default new PluginsLoader()`），
   * 全局上没有注册表；宿主的 `priority` 数组就是全部插件实例，能读就读一把。
   * 读不到（换了目录结构、插件独立跑测试）就当没有，绝不影响表情本身。
   */
  try {
    const { pathToFileURL } = await import('node:url')
    const path = await import('node:path')
    const file = path.join(process.cwd(), 'lib', 'plugins', 'loader.js')
    if (!(await import('node:fs')).existsSync(file)) return []

    const mod = await import(pathToFileURL(file).href)
    const loader = mod?.default
    if (!Array.isArray(loader?.priority)) return []

    return loader.priority.map(entry => entry?.plugin).filter(item => item?.rule)
  } catch {
    return []
  }
}

/**
 * 全局对象上已经摊开的插件实例（有的框架会把注册表挂出来）。
 *
 * @returns {Array<object>} 插件实例
 */
function globalPlugins () {
  const g = globalThis
  const boxes = [g.Bot?.plugin, g.Bot?.plugins, g.Bot?.priority, g.plugin?.priority, g.plugin]
  const out = []
  for (const box of boxes) {
    if (!box) continue

    const list = box instanceof Map ? [...box.values()] : Array.isArray(box) ? box : [box]
    for (const item of list) {
      const hit = item?.rule ? item : item?.plugin
      if (hit?.rule) out.push(hit)
    }
  }

  return out
}

/**
 * 这条消息是否被「别的插件」的规则认领了。
 *
 * 只看具体规则：像表情包自己那种「什么短句都收」的兜底规则会匹配日常闲聊，
 * 拿它当认领依据会让表情包永远不干活，所以先剔掉。
 *
 * @param {string} msg 消息全文
 * @param {object} self 本插件实例（跳过自己）
 * @returns {Promise<boolean>} 真 = 有别人的具体规则匹配，应该让出去
 */
export async function claimedByOthers (msg, self) {
  const text = String(msg ?? '').trim()
  if (!text) return false

  for (const plugin of await hostPlugins()) {
    /** 自己（含同名类的其他实例）不算「别人」，否则表情会互相让到谁都不发 */
    const ownClass = self?.constructor?.name
    if (!plugin || plugin === self) continue
    if (ownClass && ownClass !== 'Object' && plugin.constructor?.name === ownClass) continue
    if (!Array.isArray(plugin.rule)) continue

    for (const { re, catchAll } of compiledRules(plugin)) {
      if (catchAll) continue
      if (re.test(text)) return true
    }
  }

  return false
}
