/**
 * @file 路径常量：插件里所有「东西放哪」只在这一处定，别的模块一律从这里取，谁也不自己拼。
 * @module utils/Path
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 只有这里能碰 `import.meta.url`；测试里换 `YIYI_DATA_DIR` / `YIYI_CACHE_DIR` 就能把读写引到沙箱 */
const here = path.dirname(fileURLToPath(import.meta.url))

/** 插件根目录（绝对路径） */
export const rootDir = path.resolve(here, '..')

/** 插件目录名：宿主按它找模板和资源，所以取目录名而不是写死字符串 */
export const pluginName = path.basename(rootDir)

/** 对外自称的插件名（日志、帮助卡、渲染器注册都用它） */
export const pluginTitle = 'YIYI-Plugin'

/** 功能入口目录（一个文件一个功能，宿主的 `plugin` 基类在这里被继承） */
export const appsDir = path.join(rootDir, 'apps')

/** 素材根目录：模板、CSS、图标，升级时整块替换 */
export const resourcesDir = path.join(rootDir, 'resources')

/**
 * 运行期数据：服务器上是 `<Yunzai>/plugins/YIYI-Plugin/data/`，登录态、绑定、归档都在这儿，
 * 升级插件时要连它一起保留。测试里由 TEST/utils/env.mjs 指到工作区根 data/。
 */
export const dataDir = process.env.YIYI_DATA_DIR
  ? path.resolve(process.env.YIYI_DATA_DIR)
  : path.join(rootDir, 'data')

/** 缓存目录：所有可再生的东西（公开表、对局回顾、翻页记录…）都丢这儿，删了不影响功能 */
export const cacheDir = process.env.YIYI_CACHE_DIR
  ? path.resolve(process.env.YIYI_CACHE_DIR)
  : path.join(rootDir, 'cache')

/** 模板里引资源用的相对路径（art-template 的 `_res_path`），深度由模板所在层数决定 */
export const resPath = `../../../../../plugins/${pluginName}/resources/`
