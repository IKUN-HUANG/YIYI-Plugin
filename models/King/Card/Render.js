/**
 * @file Card模块的一片实现：渲染入口：模板表单探测、样式戳注入与出图降级。
 *
 * @module models/Card/Render
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { pluginName, version, yunzai, resourcesDir, createLogger, readText, fileFingerprint, toText, previewValue } from '#yiyi.utils'
import { render, renderData, tplFileOf } from '#yiyi.components'
import { renderImage, shotAvailable } from '../Browser.js'
import { kingAck } from '../Ack.js'
import { KING_TPL } from './Consts.js'
import { sendKingImage } from './Send.js'

/** 卡片角标那行同时吃 pluginTitle 与 pluginName：infra 的 utils 只导出 pluginName，
 *  art-template 宿主里老模板写的是 {{pluginTitle}}，两边都给才不会出现空白角标 */
const pluginTitle = 'YIYI-Plugin'

const log = createLogger('王者卡片')

/** 样式表入口：@import 在这里展开，字体 url() 也会换成绝对地址 */
const CSS_ENTRY = path.join(resourcesDir, KING_TPL, 'King.css')

/**
 * 这台宿主认哪种 tplFile 写法（见 renderKingWithoutEvent 的注释）。
 * 空串 = 还没试出来，每张卡都要从最便宜的那种开始试；一旦试通就锁死，不再无谓重试。
 */
let workingForm = ''

/** 自带渲染认的 name 写法（插件名前缀 / 裸模板名），定下就不再试另一种 */
let workingName = ''

/**
 * 卡片样式：把 @import 展开、把 url() 换成 file:// 绝对地址。
 * 云崽的渲染器有的用 file:// 打开页面、有的 setContent 塞 HTML，
 * 相对路径在后者里一定 404，所以样式直接跟着模板走最稳。
 */
function cssText (file, seen = new Set()) {
  const abs = path.resolve(file)
  if (seen.has(abs)) return ''
  seen.add(abs)

  const dir = path.dirname(abs)
  return readText(abs)
    .replace(/@import\s+url\(\s*(['"]?)([^'")]+)\1\s*\)\s*;?/gi, (all, quote, rel) => cssText(path.resolve(dir, rel), seen))
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (all, quote, rel) => {
      if (/^(?:data:|https?:|file:|\/\/)/i.test(rel)) return all
      const target = path.resolve(dir, rel)
      return fs.existsSync(target) ? `url("${pathToFileURL(target).href}")` : all
    })
    /** 样式表里的注释不该跟着每张卡发进 Chromium：King.css 的注释约占样式表 16%，每张卡都要带一遍 */
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]+$/gm, '')
}

/** 拼好的 <style> 按「模板 + 样式表」指纹缓存：否则每张卡都要重读 King.css 再拼一遍（实测 ~2.6ms/张） */
const cssStampCache = new Map()

function cssStamp (file) {
  const abs = path.resolve(file)
  const stamp = fileFingerprint(abs) || 'none'
  const hit = cssStampCache.get(abs)
  if (hit && hit.stamp === stamp) return hit.css
  const css = cssText(abs)
  cssStampCache.set(abs, { stamp, css })
  return css
}

const isImagePayload = value =>
  Buffer.isBuffer(value) || (typeof value === 'string' && /^(base64:\/\/|data:image\/)/.test(value))

/** 纯文字卡（提示/说明）和自动推送不算「卡片类」，出图前不打扰用户 */
const ACK_SKIP_TPL = new Set(['Notice', 'BindHelp', 'Push'])

/**
 * 挑这个宿主认的 tplFile 写法（见 renderKingWithoutEvent 的注释）。
 *
 * @param {string} tplPath 模板名，例如 `King/BattleDetail`
 * @returns {string[]} `rel` / `yunzai` 的尝试顺序，前者是 resources 相对写法
 */
function tplForms (tplPath) {
  const rel = `${tplPath}.html`
  const rooted = tplFileOf(tplPath)
  const landed = file => {
    try {
      return fs.existsSync(path.resolve(file))
    } catch {
      return false
    }
  }
  if (landed(rel)) return ['rel']
  if (landed(rooted)) return ['yunzai']
  return ['rel', 'yunzai']
}

/** 两种 tplFile 写法各自的落盘路径（`rel` 是 resources 相对、`yunzai` 是 Yunzai 根相对） */
function tplFileFor (tplPath, kind) {
  return kind === 'rel' ? `${tplPath}.html` : tplFileOf(tplPath)
}

/**
 * 自带渲染用的临时目录名：**单段、不含斜杠**。
 *
 * `screenshot(name, data)` 各版宿主对 name 的拼法不一样：TRSS 拿 name 拼 `temp/html/<name>/<saveId ?? 末尾那段>.html`，
 * 有的版本又把整串 name 里的 `/` 换成 `_` 当文件名 —— 名字里带 `/` 迟早撞上「目录少一级 / 文件名对不上」的 ENOENT
 * （线上 2026-11-02 那条 `temp\html\King\push\King_Push.html` 就是这么来的）。单段名两边都对得上。
 */
function tempToken (tplPath) {
  return `${pluginName}-${tplPath}`.replace(/[^\w.-]+/g, '-')
}

/**
 * 自己先把临时目录建出来：宿主的 `mkdir` 不带 recursive 时，多一级就静默失败，随后 write 报 ENOENT。
 * 只在**真 Yunzai 根**（`<cwd>/plugins/<插件名>` 在）动手建，测试沙箱里建出来的只是垃圾目录。
 */
function ensureTempDir (token) {
  try {
    if (!fs.existsSync(path.join(process.cwd(), 'plugins', pluginName))) return ''
    const dir = path.join(process.cwd(), 'temp', 'html', token)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  } catch {
    return ''
  }
}

/**
 * 出一张王者卡片并（按需）自己发出去，是各业务模块唯一该调的出图函数。
 *
 * 为什么分两条后端：默认走框架 e.runtime.render（渲染完顺手发图，调用方不看返回值也不会丢卡），
 * 只有明确要图回来（retType）时才用自带渲染，拿不到再退回框架。
 *
 * @param {object} e 云崽消息事件对象
 * @param {string} tpl 模板名，相对 KING_TPL 目录，如 battle-detail、notice
 * @param {object} [data] 模板数据
 * @param {object} [opts] 出图选项：retType（'base64' 等，要图回来时才给）、retMsgId、noAck（跳过「正在出图」提示）、data（叠加进模板的额外字段）
 * @returns {Promise<Buffer|string|object>} 要图模式给图（Buffer/字符串），否则给框架的发送回执
 */
export async function renderKing (e, tpl, data = {}, opts = {}) {
  if (!ACK_SKIP_TPL.has(tpl) && !opts.noAck) await kingAck(e)

  const tplPath = `${KING_TPL}/${tpl}`
  const viaFramework = async () => {
    /**
     * 样式必须跟着**这一份**数据进去：模板里写的是 `<style>{{@css}}</style>`，
     * 框架渲染这条路上没人替我们填 `css`，漏了就是整张卡没有样式
     * （2026-10-29 线上就是这样：卡有内容、一点 css 都没有）。
     */
    /**
     * `saveId` 显式给一个单段名：宿主拿它当临时文件名（TRSS 的 `saveId ?? 末尾那段`），
     * 不给的话有的版本会把整串 name 拼进文件名，跟它自己建的临时目录对不上（ENOENT）。
     */
    const out = await render(tplPath, { ...data, css: cssStamp(CSS_ENTRY), saveId: tempToken(tplPath) }, {
      e,
      retType: opts.retType,
      retMsgId: opts.retType ? opts.retMsgId : (opts.retMsgId ?? true),
      beforeRender: ({ data: merged }) => ({ ...merged, pluginTitle, pluginName, version, yunzai, ...(opts.data || {}) })
    })

    /**
     * 默认模式（不传 retType）：框架渲染完顺手就把图发出去并返回消息 id；万一某个版本把图交回来没发，这里补发一次。
     * retType 模式（要图回来）：调用方自己就是要把图交回去用（提示卡先拿图、再拼 at 一起发），
     * 这里再发一遍就成了「一张卡 + 一遍同样的文字」两份，所以原样退回。
     */
    if (isImagePayload(out)) return opts.retType ? out : sendKingImage(e, out)

    return out
  }

  /** 默认必须交给框架：自带渲染只把图 return 回来，调用方不看返回值就等于卡片凭空消失（日志有出图、群里什么都没有） */
  if (!opts.retType) {
    try {
      return await viaFramework()
    } catch (error) {
      log.info(`${tplPath} 框架出图失败，改用内置渲染：${previewValue(toText(error?.message), 160)}`)
      const image = await renderKingWithoutEvent(tpl, data, opts)
      return sendKingImage(e, image)
    }
  }

  if (await shotAvailable()) {
    const image = await renderKingWithoutEvent(tpl, data, opts)
    if (image) return image
  }

  return viaFramework()
}

/**
 * 不经框架、直接用插件自带的 Chromium 出图（有事件对象也不发，只把图交回来）。
 * 由 renderKing 在「要图回来」或框架出图失败时调用；出图失败只记一条日志并给空串，不抛。
 *
 * @param {string} tpl 模板名，相对 KING_TPL 目录
 * @param {object} [data] 模板数据
 * @param {object} [opts] 出图选项，只用其中的 data（叠加进模板的额外字段）
 * @returns {Promise<Buffer|string>} 渲染结果的图；渲染器不可用或报错时给空串
 */
export async function renderKingWithoutEvent (tpl, data = {}, opts = {}) {
  const tplPath = `${KING_TPL}/${tpl}`

  /**
   * 样式**直接塞进页面**（模板里是 `<style>{{@css}}</style>`），不走 `<link>`、也不另存模板副本。
   *
   * 云崽的渲染器分两派：一派 `file://` 打开页面，相对路径能自己找；另一派读完模板再
   * `page.setContent`，页面没有基地址，`<link href="../../resources/…">` 一律 404。
   * 另存一份「带 <style> 的模板副本」能同时喂饱两派，但副本得放在渲染器找得到的地方——
   * 放 `resources/` 会被提交进仓库，放 `cache/` 就得给它一条 `../cache/…` 的路径，
   * 而 `../cache/…` 只在「渲染器会先拼上 resources 目录」时才成立：Miao / TRSS 都是拿
   * `process.cwd()`（Yunzai 根）直接 `readFileSync(tplFile)`，于是这条路径落到 Yunzai 根的
   * 上一级去，读不到就打一行 `加载html错误`、不抛异常、只交回空图（2026-10-28 线上就是这么炸的）。
   * 把 CSS 当数据传进去，两派都吃得到，也就不需要副本了。
   */
  const merged = renderData({ ...data, css: cssStamp(CSS_ENTRY) }, ({ data: base }) => ({
    ...base,
    pluginTitle,
    pluginName,
    version,
    yunzai,
    ...(opts.data || {})
  }))

  /**
   * `screenshot(name, data)` 的 name 有讲究：TRSS 把 name 当「插件/模板」拼进临时目录
   * （`temp/html/<plugin>/<path>/<名字>.html`），只给 `King/Push` 又会拼成
   * `temp/html/King/Push/King_Push.html` —— 目录少一级，直接 ENOENT（线上 2026-11-01、11-02 两次都是它）。
   * 所以先给**单段安全名**（tempToken，同时当 saveId），再退回「插件名 + 模板」、最后裸模板名；tplFile 三派都试。
   */
  const token = tempToken(tplPath)
  ensureTempDir(token)

  const names = workingName ? [workingName] : [token, `${pluginName}/${tplPath}`, tplPath]
  const forms = workingForm ? [workingForm] : tplForms(tplPath)
  let failed = ''

  for (const name of names) {
    for (const kind of forms) {
      const file = tplFileFor(tplPath, kind)
      try {
        const out = await renderImage(name, { ...merged, tplFile: file, saveId: token })
        if (out) {
          workingName = name
          workingForm = kind
          return out
        }
        failed = '渲染器返回空'
      } catch (error) {
        failed = previewValue(toText(error?.message), 160)
      }
    }
  }

  log.warn(`${tplPath} 出图失败：${failed}`)
  return ''
}
