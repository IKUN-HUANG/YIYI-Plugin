/**
 * @file 出图门面：模板名 → 宿主渲染器，中间只补编码格式、`_res_path` 与版权行。
 *
 * 这一层归 components 不归 utils —— 它要读配置（出图格式）、要拼插件标题与版本、
 * 还要拿 `e.runtime`，属于「跟框架打交道」的零件。
 *
 * 关于 `{{include}}`：**模板里一个都不许有**，每张卡必须是能独立渲染的完整 HTML。
 * 宿主渲染器拿到的是 `template.render(html, data)`（不传 root、不传 filename），
 * art-template 会把非相对路径的 partial 解析成 `path.resolve('/', '局部的名字')`，
 * 线上必崩 `template not found: ENOENT ... '/King/partials/xxx.html'`；
 * 预览器/自检里我们给 art-template 设了 `root: resources/`，所以测试全过、线上全崩。
 * 公共片段（页头 / 卡壳 / 玩家格）因此**拍平进各模板**，不再抽文件；
 * `check-tpl-form` 里有一条闸门盯着「resources 下不许出现 `{{include`」。
 *
 * @module components/Render
 */
import { renderData } from './Render/Data.js'
import { pluginName } from '../utils/Path.js'
import { logTag } from '../utils/Logger.js'

/** 渲染数据的拼装函数：业务侧想自己拼数据时也用它，口径与 `render` 内一致 */
export { renderData }

/**
 * 模板里引资源用的相对路径：`<tpl>` 有几段就往上退几层，再进插件 resources。
 *
 * @param {string} tpl 模板名（`King/Camp` 这种带子目录的形式）
 * @returns {string} 形如 `../../../../plugins/YIYI-Plugin/resources/`
 */
function resPathForTpl (tpl) {
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
 * @param {string} tpl 模板名，例如 `King/Camp`
 * @param {object} [data={}] 视图对象
 * @param {object} [cfg={}] 渲染配置
 * @param {object} [cfg.e] 消息事件对象（要带 `e.runtime.render`）
 * @param {boolean} [cfg.retMsgId=false] 传真则 `retType` 用 `msgId`（返回消息 id）
 * @param {string} [cfg.retType] 直接指定 `retType`，优先于 `retMsgId`
 * @param {(ctx: {data: object}) => object} [cfg.beforeRender] 业务侧改数据的回调
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
