/**
 * @file 找宿主的浏览器（扫码登录、出图都要用）。
 *
 * 两条硬约束，`check-browser` 会拦：
 * ① 定位结果**模块级缓存** —— 每张卡重新定位＝每张卡新开一个 Chromium；
 * ② 工厂型后端（trss 的 `renderers/puppeteer/index.js` 是函数不是实例）**产物只造一次**。
 *
 * @module models/King/Browser
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLogger, rootDir, previewValue } from '#yiyi.utils'
import { AuthConfigError, toText } from './Common.js'

const log = createLogger('营地浏览器')

/** 宿主的几种装法：云崽根目录（插件上一级再上一级）、当前工作目录 */
const BROWSER_ROOTS = [path.resolve(rootDir, '..', '..'), process.cwd()]

const BROWSER_BACKENDS = [
  'lib/renderer/loader.js',
  'lib/puppeteer/puppeteer.js',
  'renderers/puppeteer/index.js'
]

const LOADER_BACKEND = 'lib/renderer/loader.js'
const TRSS_BACKEND = 'renderers/puppeteer/index.js'

let located = null
let locating = null
const factoryMade = new Map()

function usable (holder) {
  if (!holder) return false
  return typeof holder.browserInit === 'function' || typeof holder.launch === 'function' || Boolean(holder.browser?.newPage)
}

/**
 * 配置里没写（或写错）渲染器名字时，loader 的 `getRenderer()` 返回它自己 ——
 * 一个只有 `renderers` 表、没有 `browserInit` 的壳。把表里第一个能用的翻出来，
 * 否则这个后端会被判成不可用，一路落到「工厂新建实例」那条路。
 */
function pickFrom (holder) {
  if (usable(holder)) return holder
  if (!holder) return null

  const pools = [holder.renderers]
  if (Array.isArray(holder.script_renderers)) pools.push(holder.script_renderers)
  if (Array.isArray(holder.noscript_renderers)) pools.push(holder.noscript_renderers)

  for (const pool of pools) {
    const list = pool instanceof Map ? [...pool.values()] : Array.isArray(pool) ? pool : []
    for (const one of list) if (usable(one)) return one
  }
  return null
}

async function loadBackend (root, relative) {
  const file = path.join(root, relative)
  if (!fs.existsSync(file)) return null

  const made = factoryMade.get(file)
  if (made) return made

  try {
    const mod = await import(pathToFileURL(file).href)
    const exported = mod?.default ?? mod
    if (relative === LOADER_BACKEND && typeof exported?.getRenderer === 'function') return exported.getRenderer() || null
    if (relative === TRSS_BACKEND && typeof exported === 'function') {
      const instance = exported({})
      factoryMade.set(file, instance)
      log.info('Yunzai 无可用渲染后端，自建长期复用实例')
      return instance
    }
    return exported || null
  } catch (error) {
    log.warn(`浏览器后端加载失败：${relative} → ${previewValue(toText(error?.message), 160)}`)
    return null
  }
}

async function locateRenderer () {
  if (usable(located)) return located
  located = null
  if (locating) return locating

  locating = (async () => {
    for (const root of BROWSER_ROOTS) {
      for (const relative of BROWSER_BACKENDS) {
        const holder = pickFrom(await loadBackend(root, relative))
        if (usable(holder)) return (located = holder)
      }
    }
    return null
  })()

  try {
    return await locating
  } finally {
    locating = null
  }
}

async function openBrowser (holder) {
  try {
    if (typeof holder.browserInit === 'function') {
      const browser = await holder.browserInit()
      if (browser?.newPage) return browser
    }
    if (typeof holder.launch === 'function') {
      const browser = await holder.launch()
      if (browser?.newPage) return browser
    }
  } catch (error) {
    log.warn(`浏览器启动失败：${previewValue(toText(error?.message), 160)}`)
  }

  if (holder.browser?.newPage) return holder.browser
  return null
}

/**
 * 借一个干净的页面给扫码登录用，用完调 `release()` 关掉。
 *
 * UA / 视口 / 超时都是「能设就设」：不同渲染器支持度不一样，设不上只记一条日志，
 * 不能因为宿主不认自定义参数就整个登录流程失败。
 *
 * @param {object} [options]
 * @param {string} [options.userAgent=''] 自定义 UA，空串用浏览器默认
 * @param {object|null} [options.viewport=null] 视口（`{width, height}`），null 用浏览器默认
 * @param {number} [options.timeoutMs=30000] 页面默认超时，单位 ms
 * @returns {Promise<{page: object, release: () => Promise<void>}>} 页面句柄与归还函数
 * @throws {AuthConfigError} 宿主没装渲染器、或浏览器起不来
 */
export async function acquirePage ({ userAgent = '', viewport = null, timeoutMs = 30000 } = {}) {
  const holder = await locateRenderer()
  if (!holder) throw new AuthConfigError('没找到 Yunzai 的浏览器，请先装好 puppeteer 渲染器再试')

  const browser = await openBrowser(holder)
  if (!browser?.newPage) throw new AuthConfigError('Yunzai 的浏览器没启动起来，稍后再试或重启一次 Yunzai')

  const page = await browser.newPage()

  if (userAgent) {
    try {
      await page.setUserAgent(userAgent)
    } catch {
      log.info('不接受自定义 UA，改用默认')
    }
  }

  if (viewport) {
    try {
      await page.setViewport(viewport)
    } catch {
      log.info('不接受自定义视口，改用默认')
    }
  }

  if (page.setDefaultTimeout) page.setDefaultTimeout(timeoutMs)

  return {
    page,
    release: async () => {
      try {
        await page.close()
      } catch (error) {
        log.info(`关闭扫码页面失败：${previewValue(toText(error?.message), 120)}`)
      }
    }
  }
}

/**
 * 宿主自带模板出图：卡片不依赖 `e.runtime.render` 的返回形状。
 *
 * @param {string} tpl 模板路径（宿主渲染器认的相对路径）
 * @param {object} [data={}] 模板数据
 * @returns {Promise<*>} 宿主渲染器的返回值（一般是图片 Buffer 或图片消息段）
 * @throws {AuthConfigError} 没渲染器、或这个宿主不支持自带模板出图
 */
export async function renderImage (tpl, data = {}) {
  const holder = await locateRenderer()
  if (!holder) throw new AuthConfigError('没找到 Yunzai 的出图功能，先把 puppeteer 渲染器装好再试')
  if (typeof holder.screenshot !== 'function') throw new AuthConfigError('Yunzai 出图不支持自带模板，请升级框架')

  return holder.screenshot(tpl, data)
}

/**
 * 这个宿主能不能自带模板出图 —— 调用方据此决定走卡片还是走文字兜底。
 *
 * @returns {Promise<boolean>} 有 `screenshot` 才能出图；定位浏览器本身出错也只当不能用，不往上抛
 */
export async function shotAvailable () {
  try {
    const holder = await locateRenderer()
    return typeof holder?.screenshot === 'function'
  } catch {
    return false
  }
}

/** 默认导出：给 barrel 与需要一次拿全的调用方 */
export default { acquirePage, renderImage, shotAvailable }
