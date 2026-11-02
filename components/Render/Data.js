/**
 * @file 渲染数据的拼装：把业务视图对象补齐成渲染器要的形状（`_plugin`、`_res_path`、编码参数、版权行）。
 *
 * @module components/Render/Data
 */
import { encodeOf } from './Encode.js'
import { pluginName, pluginTitle, resPath } from '../../utils/Path.js'
import { version, yunzai } from '../../utils/Version.js'

/**
 * 版权行的前半段：宿主名 + 宿主版本（认不出宿主就给兜底名）。
 *
 * @returns {string} 形如 `Miao-Yunzai <span class="version">v3.1.2</span>`
 */
function hostCopyright () {
  const host = yunzai.label
  return yunzai.version ? `${host} <span class="version">v${yunzai.version}</span>` : host
}

/**
 * 给模板数据补齐渲染器要的字段（`_plugin`、`_res_path`、`imgType`、`copyright`…）。
 *
 * `_imgUrl` 是模板里引图的唯一入口：外链（`http:`、`data:` 等带协议的）原样返回，
 * 其余一律拼 `_res_path`，免得每个模板各写一遍相对路径。
 *
 * @param {object} [baseData={}] 业务视图对象（可自带 `_res_path` 覆盖默认值）
 * @param {(ctx: {data: object}) => object} [beforeRender] 渲染器回调；传了就只返回它的结果
 * @returns {object} 补齐后的数据（或 `beforeRender` 的返回值）
 */
export function renderData (baseData = {}, beforeRender) {
  const base = baseData._res_path || resPath

  const _imgUrl = img => (/^[a-z][a-z0-9+.-]*:/i.test(img) ? img : `${base}${img}`)

  const merged = {
    ...baseData,
    _plugin: pluginName,
    _res_path: base,
    ...encodeOf(),
    omitBackground: true,
    _imgUrl,
    copyright: `${hostCopyright()} · ${pluginTitle} <span class="version">v${version}</span>`
  }

  return beforeRender ? beforeRender({ data: merged }) : merged
}
