/**
 * @file 出图：把模板交给 Yunzai 的渲染器，负责编码格式、`_res_path` 与版权行的拼装。
 * @module components/Render
 */

import Config from './Config.js'
import { pluginName, pluginTitle, resPath } from '../utils/Path.js'
import { version, yunzai } from '../utils/Version.js'
import { logTag } from '../utils/Logger.js'

/**
 * 这一层归 components 不归 utils —— 它要读配置（出图格式）、要拼插件标题与版本、
 * 还要拿 `e.runtime`，属于「跟框架打交道」的零件。
 *
 * 关于 `{{include}}`：**模板里一个都不许有**，每张卡必须是能独立渲染的完整 HTML。
 * 宿主渲染器拿到的是 `template.render(html, data)`（不传 root、不传 filename），
 * art-template 会把非相对路径的 partial 解析成 `path.resolve('/', '局部的名字')`，
 * 线上必崩 `template not found: ENOENT ... '/King/partials/xxx.html'`；
 * 预览器/自检里我们给 art-template 设了 `root: resources/`，所以测试全过、线上全崩。
 * 公共片段（页头 / 卡壳 / 玩家格）因此**拍平进各模板**，不再抽文件；
 * `check-render` 里有一条闸门盯着「resources 下不许出现 `{{include`」。
 */

/** 出图后端认的编码格式（见 Yunzai 渲染器的 screenshot 实现） */
const IMG_TYPES = ['png', 'jpeg', 'webp']

/**
 * 卡片用什么格式编码。
 *
 * 2026-10-24 实测（1080 宽面板卡，同机 Chromium 截图）：webp(100) 787ms / png 561ms / jpeg(92) 109ms
 * —— 慢的是**编码**不是排版（同一次截图换 jpeg(20) 只要 66ms）。
 * 所以默认 png：像素跟 webp(100) 逐字节一致，编码却快三到四成；webp 在微信适配器上还会被当文件发出去。
 *
 * @returns {string} `png` / `jpeg` / `webp`
 */
function imgTypeOf () {
  try {
    const raw = String(Config.get('config')?.imgType ?? '').trim().toLowerCase()
    if (raw === 'jpg') return 'jpeg'
    return IMG_TYPES.includes(raw) ? raw : 'png'
  } catch {
    /** 配置读不出来也要能出图，格式退回 png */
    return 'png'
  }
}

/**
 * 只有有损格式才带 quality；png 传了也没用，索性不传。
 *
 * @param {string} imgType 编码格式
 * @returns {number} 1~100 的质量；png 给 0 表示不传
 */
function qualityOf (imgType) {
  if (imgType === 'png') return 0
  try {
    const q = Math.round(Number(Config.get('config')?.quality ?? 100))
    return Number.isFinite(q) ? Math.min(100, Math.max(1, q)) : 100
  } catch {
    return 100
  }
}

/**
 * 给模板数据补齐渲染器要的字段（`_plugin`、`_res_path`、`imgType`、`copyright`…）。
 *
 * @param {object} [baseData={}] 业务视图对象（可自带 `_res_path` 覆盖默认值）
 * @param {(ctx: {data: object}) => object} [beforeRender] 渲染器回调；传了就只返回它的结果
 * @returns {object} 补齐后的数据（或 `beforeRender` 的返回值）
 */
export function renderData (baseData = {}, beforeRender) {
  const base = baseData._res_path || resPath

  const _imgUrl = img =>
    /^[a-z][a-z0-9+.-]*:/i.test(img) ? img : `${base}${img}`

  const imgType = imgTypeOf()
  const quality = qualityOf(imgType)

  const merged = {
    ...baseData,
    _plugin: pluginName,
    _res_path: base,
    imgType,
    ...(quality ? { quality } : {}),
    omitBackground: true,
    _imgUrl,
    copyright: `${yunzai.label}${yunzai.version ? ` <span class="version">v${yunzai.version}</span>` : ''}`
      + ` · ${pluginTitle} <span class="version">v${version}</span>`
  }

  return beforeRender ? beforeRender({ data: merged }) : merged
}

/**
 * 模板里引资源用的相对路径：`<tpl>` 有几段就往上退几层，再进插件 resources。
 *
 * @param {string} tpl 模板名（`King/camp` 这种带子目录的形式）
 * @returns {string} 形如 `../../../../plugins/YIYI-Plugin/resources/`
 */
export function resPathForTpl (tpl) {
  const depth = 2 + String(tpl || '').split('/').filter(Boolean).length
  return `${'../'.repeat(depth)}plugins/${pluginName}/resources/`
}

/**
 * 模板名 → 磁盘上的文件路径（相对 Yunzai 根）。
 *
 * @param {string} tpl 模板名（`Icon/x` → `plugins/YIYI-Plugin/resources/Icon/x.html`）
 * @returns {string} 相对路径
 */
export function tplFileOf (tpl) {
  return `plugins/${pluginName}/resources/${tpl}.html`
}

/**
 * 出图：把模板和视图数据交给宿主渲染器。
 *
 * @param {string} tpl 模板名，例如 `King/camp`
 * @param {object} [data={}] 视图对象
 * @param {object} [cfg={}] 渲染配置
 * @param {object} [cfg.e] 消息事件对象（要带 `e.runtime.render`）
 * @param {boolean} [cfg.retMsgId=false] 传真则 `retType` 用 `msgId`（返回消息 id）
 * @param {string} [cfg.retType] 直接指定 `retType`，优先于 `retMsgId`
 * @param {Function} [cfg.beforeRender] 业务侧改数据的回调
 * @returns {Promise<any>} 渲染器的结果（图片或消息 id）
 * @throws {Error} 模板名为空、或宿主不支持 `e.runtime.render`
 */
export async function render (tpl, data = {}, cfg = {}) {
  if (!tpl) throw new Error(logTag('渲染') + 'render: tpl 不能为空')

  const { e, retMsgId = false, retType, beforeRender } = cfg
  if (!e?.runtime?.render) {
    throw new Error(logTag('渲染') + 'render: 当前 Yunzai 不支持 e.runtime.render，请升级框架')
  }

  return e.runtime.render(pluginName, tpl, data, {
    retType: retType || (retMsgId ? 'msgId' : 'default'),

    beforeRender ({ data: baseData }) {
      return renderData(baseData, beforeRender)
    }
  })
}
