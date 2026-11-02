/**
 * @file 重启 Yunzai 的一片实现：四条重启路径各自的探测与执行件（端口探活、pm2、Miao 重启服务、前台转后台），不从门面转出。
 *
 * @module models/Admin/Restart/Shared
 */

import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { createLogger, readYaml } from '#yiyi.utils'
import { MIAO_RESTART_PORT, PROBE_TIMEOUT_MS, BOOT_WAIT_MS } from './Env.js'
import { RESTART_MARK_FILE } from './Mark.js'

const log = createLogger('重启')

/**
 * 读框架的 package.json（只看它写没写后台启动脚本，读不出来不算错）。
 *
 * @param {string} file 绝对路径
 * @returns {object|null} 解析不出来回 null
 */
function readJsonFile (file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 用哪个包管理器跑 `start`：跟框架自己判的一样 —— 有 pnpm 锁就用 pnpm，其次 yarn，最后 npm。
 *
 * @param {string} cwd 框架根目录
 * @returns {string} `pnpm` / `yarn` / `npm`
 */
function packageRunner (cwd) {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

/**
 * Miao 重启服务的端口：环境变量优先（部署在容器里改了端口、或者想指到别处时用），
 * 其次读框架自己的 `config/config/bot.yaml` 的 `restart_port`，最后看有没有 ksr.js 用默认口。
 *
 * 只有 Miao 才有 `lib/tools/ksr.js`，所以这个函数同时也回答「这是不是 Miao」。
 *
 * @returns {number} 端口；不是 Miao、或者看不出端口就回 0
 */
export function restartPort () {
  const env = String(process.env.YIYI_RESTART_PORT ?? '').trim()
  if (/^\d+$/.test(env)) return Number(env)

  const cwd = process.cwd()
  if (!fs.existsSync(path.join(cwd, 'lib', 'tools', 'ksr.js'))) return 0

  const cfg = readYaml(path.join(cwd, 'config', 'config', 'bot.yaml'), {})
  const port = Number(String(cfg?.restart_port ?? '').trim())
  return Number.isInteger(port) && port > 0 ? port : MIAO_RESTART_PORT
}

/**
 * 本地端口通不通：通 = Miao 重启服务真的在跑（`lib/tools/ksr.js` 有，不代表有人用它起 bot）。
 *
 * @param {number} port 端口
 * @returns {Promise<boolean>} 能连上就 true
 */
export function portOpen (port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = ok => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(PROBE_TIMEOUT_MS, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/**
 * 敲一下 Miao 重启服务：它会 kill 掉子进程再重新 spawn（见 `lib/tools/ksr.js`）。
 *
 * 发完就不管回包了 —— 它 `res.end()` 之后立刻 kill，等到的是连接被掐断，不是失败。
 *
 * @param {number} port 端口
 * @returns {void}
 */
export function pokeMiaoRestart (port) {
  try {
    const req = http.get({ host: '127.0.0.1', port, path: '/restart' }, res => res.resume())
    req.on('error', () => {})
    req.setTimeout(PROBE_TIMEOUT_MS, () => req.destroy())
  } catch (err) {
    log.warn('叫 Miao 重启服务失败', err)
  }
}

/**
 * pm2 重启自己：pm2 会给子进程塞 `pm_id`，能拿到就说明跑在 pm2 里。
 *
 * 用 `pm2 restart <id>` 而不是 `pnpm run restart`：后者要读 `config/pm2/pm2.json`、依赖工作目录，
 * 换个启动方式就找不到；id 是本进程自己的，错不了。
 *
 * @returns {{ text: string, run: () => void }|null} 不在 pm2 里回 null
 */
export function pm2Plan () {
  const id = String(process.env.pm_id ?? '').trim()
  if (!/^\d+$/.test(id)) return null
  const name = String(process.env.name ?? '').trim() || id
  return {
    text: `pm2 restart ${name}`,
    run: () => {
      try {
        execFile('pm2', ['restart', name], { detached: true, stdio: 'ignore' }, err => {
          if (err) log.warn(`pm2 重启失败（${name}）`, err)
        }).unref()
      } catch (err) {
        log.warn('调 pm2 失败', err)
      }
    }
  }
}

/**
 * 前台运行的救法：用框架自己的后台启动脚本把新进程拉起来，确认活着之后再退掉自己。
 *
 * 为什么非要「先起来再退」：`node .` 是前台跑的，直接 `exit` 就没人拉了；而 Miao 的 `#重启` 也是
 * 这条路（`${npm} start` 成功后 `process.exit()`）。比它多一层的判断是「新进程真活着没有」——
 * 拿不到结论就不退出，宁可这次不重启，也不要退出后机器人再也没上线。
 *
 * 判成功：子进程还在跑（`node .` 这种前台脚本被 detached 之后就常驻了），或者它已经退出、退出码 0
 * （`pnpm start` = `pm2 start` 这类跑完就交棒的）。**非 0 一律算失败** —— 那说明根本没人接手，
 * 这时候退出自己等于让机器人下线。
 *
 * @param {object} [opts] 退出方式（闸门里换成假的，不然把闸门自己退了）
 * @param {(code: number) => void} [opts.exit] 真退出自己
 * @returns {{ text: string, run: () => Promise<boolean> }|null} 框架没写后台启动脚本就回 null；`run` 回「转成了没有」
 */
export function backgroundPlan ({ exit = code => process.exit(code) } = {}) {
  const cwd = process.cwd()
  const pkg = readJsonFile(path.join(cwd, 'package.json'))
  const script = String(pkg?.scripts?.start ?? '').trim()
  if (!script) return null

  const cmd = `${packageRunner(cwd)} start`
  return {
    key: 'start',
    text: `前台转后台（${cmd}）`,
    run: async () => {
      let spoke = false
      const child = spawn(cmd, { shell: true, cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      child.stdout.on('data', () => { spoke = true })
      child.stderr.on('data', () => { spoke = true })
      const spawnError = await new Promise(resolve => {
        child.once('error', err => resolve(err))
        setTimeout(() => resolve(null), BOOT_WAIT_MS)
      })
      child.unref()

      if (spawnError) {
        log.warn(`前台转后台没起来（${cmd}），这次不重启`, spawnError)
        return false
      }
      const alive = child.exitCode === null && !child.killed
      const code = child.exitCode
      /** 退了而且不是 0：起崩了（没装 pm2、脚本写错），此时退出自己 = 机器人下线 */
      if (!alive && code !== 0) {
        log.warn(`前台转后台起来就退了（${cmd}，退出码 ${String(code)}），这次不重启`)
        return false
      }
      if (!alive && !spoke) log.info(`前台转后台的启动脚本已经交棒（${cmd}）`)
      log.mark(`前台转后台成功（${cmd}），旧进程退出`)
      exit(0)
      return true
    }
  }
}

/**
 * 读走重启标记：不管用不用得上都清掉，免得下次载入又报一遍。
 *
 * @returns {{ at: number, reason: string }|null} 没有标记回 null
 */
export function takeRestartMark () {
  const mark = readYaml(RESTART_MARK_FILE, null)
  if (!mark) return null
  try {
    fs.rmSync(RESTART_MARK_FILE, { force: true })
  } catch (err) {
    log.warn('重启标记删不掉', err)
  }
  const at = Number(mark.at)
  return Number.isFinite(at) && at > 0 ? { at, reason: String(mark.reason ?? '') } : null
}

/**
 * 抹掉重启标记（重启没做成时用，别让下次启动报一个假的耗时）。
 *
 * @returns {void}
 */
export function clearRestartMark () {
  try {
    fs.rmSync(RESTART_MARK_FILE, { force: true })
  } catch (err) {
    log.warn('重启标记删不掉', err)
  }
}

/**
 * 主人 QQ：框架配置优先（重启后还没有任何消息事件，`Bot.config.masterQQ` 是唯一现成的），
 * 读不到再看插件自己记的名单。
 *
 * @returns {string[]} 纯数字的主 QQ；一个都没有回空数组
 */
function masterIds () {
  const digits = value => String(value ?? '').replace(/\D/g, '')
  const cfg = globalThis.Bot?.config || {}
  const raw = cfg.masterQQ ?? cfg.masters ?? cfg.master
  const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,，、]+/)).map(digits).filter(id => id.length >= 5)
  if (list.length) return list

  const file = readYaml(path.join(process.cwd(), 'config', 'config', 'other.yaml'), {})
  const fromFile = file?.masterQQ
  return (Array.isArray(fromFile) ? fromFile : String(fromFile ?? '').split(/[\s,，、]+/))
    .map(digits).filter(id => id.length >= 5)
}

/**
 * 私聊一位主人（两条路：`pickFriend` 优先，退到 `sendMasterMsg`）。
 *
 * @param {string} text 正文
 * @returns {Promise<boolean>} true = 发出去了
 */
export async function tellMaster (text) {
  const ids = masterIds()
  if (!ids.length) {
    log.warn('不知道主人是谁（框架配置里没有 masterQQ），重启耗时没发出去')
    return false
  }
  try {
    const qq = /^\d+$/.test(ids[0]) ? Number(ids[0]) : ids[0]
    const friend = globalThis.Bot?.pickFriend?.(qq)
    if (typeof friend?.sendMsg === 'function') {
      await friend.sendMsg(text)
      return true
    }
  } catch (err) {
    log.warn('私聊主人失败', err)
  }
  try {
    if (typeof globalThis.Bot?.sendMasterMsg === 'function') {
      await globalThis.Bot.sendMasterMsg(text)
      return true
    }
  } catch (err) {
    log.warn('私聊主人失败', err)
  }
  return false
}

/**
 * 等一会儿，单位毫秒。
 *
 * @param {number} ms 毫秒数
 * @returns {Promise<void>} 到点后 resolve，不会 reject
 */
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
