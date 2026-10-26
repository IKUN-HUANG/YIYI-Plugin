/**
 * @file 插件入口：把 apps/ 下的功能类挂进 `apps`，并打一段版本横幅。
 * @module index
 *
 * 横幅格式是**对外契约**（用户截图、日志排查、`check-log-tag` 都按它读），
 * 而且入口横幅是唯一「刻意不带 `[YIYI:...]` 前缀」的日志：带了反而糊。
 * 单个 app 载入失败只报错、不中断其它 app —— 一个功能写坏了不该让整个插件起不来。
 * `apps/` 整个目录读不到也照样打横幅，只是 warn 一句：横幅是「插件起来了」的信号，
 * 把它跟目录状态绑在一起，装错位置的部署会连一句版本号都看不到。
 *
 * 这里**不许**出现 `setInterval`：定时任务一律走 `utils/AutoTask.js`，
 * 模块顶层挂定时器会让进程退不掉（测试、REPL、热重载全卡在这一句上）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { appsDir, createLogger, emoji, version, author, group } from '#yiyi.utils'

const log = createLogger()

/** 已载入的功能类：键是文件名（`Bilibili`），值是那个类 */
const apps = {}

log.mark('-------✧*-------')
log.mark(`伊伊插件正在载入${emoji()}~`)
log.mark('-----------------')

for (const file of listApps()) {
  const name = file.slice(0, -3)
  try {
    const mod = await import(path.join(appsDir, file))
    apps[name] = Object.values(mod)[0]
    log.info(`已加载 ${name}`)
  } catch (err) {
    log.error(`载入错误 ${name}`)
    log.error(err)
  }
}

log.mark(`伊伊插件v${version}载入成功${emoji()}~`)
log.mark(`Created By ${author}.`)
log.mark(`闲聊群：${group}.`)
log.mark('-----------------')

/**
 * 已载入的功能类，供宿主（Yunzai）按文件名取用。
 *
 * @type {Record<string, Function>}
 */
export { apps }

/**
 * 列 apps/ 下的 .js 文件（排序后返回，保证横幅里的「已加载」顺序稳定）。
 *
 * @returns {string[]} 文件名列表；目录读不到给空数组
 */
function listApps () {
  try {
    return fs.readdirSync(appsDir).filter(f => f.endsWith('.js')).sort()
  } catch (err) {
    /** apps 目录读不到就当空目录（插件照样起来，只是没有任何指令），别让入口抛出去 */
    log.warn(`apps 目录读不到 ${appsDir}：${err.message}`)
    return []
  }
}
