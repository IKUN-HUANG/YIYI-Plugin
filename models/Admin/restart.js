/**
 * @file 重启 Yunzai：Miao 跟 TRSS 各走各的路，重启完私聊主人一句「重启成功：耗时 X 秒」。
 * @module models/Admin/restart
 *
 * 为什么不能一行 `Bot.restart()` 了事：两个框架压根没有共同的重启接口。
 * - TRSS-Yunzai 有 `Bot.restart()`（内部 `execve`，退不回来才 `pnpm run restart`），直接调就完事。
 * - Miao-Yunzai **没有**这个函数。它自己的 `#重启` 命令走三条路：Miao 重启服务（`lib/tools/ksr.js`
 *   起的本地 HTTP 端口，默认 27881）/ 跑在 pm2 里就让 pm2 重启自己 / 都没有就把进程退掉等人拉。
 *   插件走前三层，第四层改成「前台转后台」：拿框架自己的后台启动脚本（Miao 的 `npm start` 就是
 *   `pm2 start`）把新进程拉起来，**确认它真的活着**才退掉自己。裸 `process.exit()` 那一步不做 ——
 *   没有守护程序时直接退出就再也不回来了，更新完把机器人关掉比不重启糟得多。
 *
 * 耗时怎么算：跨进程带不过来，所以「开始重启」时先把时间戳写进 `data/update/restart.yaml`，新进程
 * 载入完成时读它、减一下再发出去 —— 跟 Miao 自己那句 `重启成功：耗时X秒` 一个口径（它落 redis，
 * 我们落 data，少一层依赖）。
 *
 * 报告只发**私聊**（正文里带上是被哪条路叫起来的：自动更新 / 手动更新），群里那条回执已经说过
 * 「开始重启 Yunzai…」了，群里再刷一条没必要。
 */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import { execFile, spawn } from 'node:child_process'
import { createLogger, dataDir } from '#yiyi.utils'
import { ensureDir, readYaml, writeYaml } from '#yiyi.utils'

const log = createLogger('重启')

/** 重启标记：写在新进程读得到的地方（data/ 不是运行时缓存，不会被缓存清理扫掉） */
export const RESTART_MARK_FILE = path.join(dataDir, 'update', 'restart.yaml')

/** 超过这个时间还没回来，说明「重启」其实没发生（框架没接口、进程被关了没人拉），别再报耗时 */
export const RESTART_FRESH_MS = 10 * 60 * 1000

/** Miao 重启服务的默认端口（`lib/tools/ksr.js` 里写死的就是这个） */
const MIAO_RESTART_PORT = 27881

/** 探端口 / 发请求的超时：本地回环，慢成这样基本等于没开 */
const PROBE_TIMEOUT_MS = 800

/**
 * 前台转后台时，新进程起来后观察多久才算「真的活着」。
 *
 * 3 秒够跨过「配置文件读一半就崩」那类，也够短到主人感觉不到等待。闸门里能盖小。
 */
const BOOT_WAIT_MS = Number(process.env.YIYI_RESTART_BOOT_WAIT_MS) > 0 ? Number(process.env.YIYI_RESTART_BOOT_WAIT_MS) : 3000

/**
 * 载入完成后等机器人连上的重试节奏（首条私聊常常发不出去）。
 *
 * 两个数都能用环境变量盖掉：闸门里试「发不出去」那条路时不想真等一分钟。
 */
const REPORT_TRIES = Number(process.env.YIYI_RESTART_REPORT_TRIES) > 0 ? Number(process.env.YIYI_RESTART_REPORT_TRIES) : 12
const REPORT_GAP_MS = Number(process.env.YIYI_RESTART_REPORT_GAP_MS) >= 0 ? Number(process.env.YIYI_RESTART_REPORT_GAP_MS) : 5000

/**
 * Miao 重启服务的端口：环境变量优先（部署在容器里改了端口、或者想指到别处时用），
 * 其次读框架自己的 `config/config/bot.yaml` 的 `restart_port`，最后看有没有 ksr.js 用默认口。
 *
 * 只有 Miao 才有 `lib/tools/ksr.js`，所以这个函数同时也回答「这是不是 Miao」。
 *
 * @returns {number} 端口；不是 Miao、或者看不出端口就回 0
 */
function restartPort () {
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
function portOpen (port) {
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
function pokeMiaoRestart (port) {
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
function pm2Plan () {
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
function backgroundPlan ({ exit = code => process.exit(code) } = {}) {
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
 * 这台机器现在能用哪些重启办法，按优先级排好。
 *
 * Miao 跟 TRSS 混着判没关系：TRSS 只出 `Bot.restart()`，Miao 只出 pm2 / 重启服务两条，
 * 都在 pm2 里又都有 `Bot.restart()` 时（TRSS 装 pm2 很常见）先走框架自己的接口，最干净。
 *
 * @param {object} [opts] 给「前台转后台」那条路留的口子（闸门里换掉退出动作）
 * @param {(code: number) => void} [opts.exit] 真退出自己的方式
 * @returns {Promise<Array<{ key: string, text: string, run: () => void | Promise<void> }>>} 能用的办法；一个都没有回空数组
 */
export async function restartPlans (opts = {}) {
  const plans = []

  if (typeof globalThis.Bot?.restart === 'function') {
    plans.push({ key: 'bot', text: 'Bot.restart()', run: () => { globalThis.Bot.restart() } })
  }

  const pm2 = pm2Plan()
  if (pm2) plans.push({ key: 'pm2', ...pm2 })

  const port = restartPort()
  if (port && await portOpen(port)) {
    plans.push({ key: 'miao', text: `Miao 重启服务（127.0.0.1:${port}/restart）`, run: () => pokeMiaoRestart(port) })
  }

  /**
   * 最后一条：前台运行（`node .`）又没人管着 —— 用框架自己的后台启动脚本起一个新进程再退掉自己。
   * 排最后是因为它最「重」：会另起一个进程，前面几条都是让现有的守护把本进程重启。
   */
  const background = backgroundPlan(opts)
  if (background) plans.push(background)

  return plans
}

/**
 * 这个环境能不能自动重启（给「更完之后该说重启还是该说手动重启」用）。
 *
 * @returns {Promise<boolean>} 有一条能用的路就是 true
 */
export async function canRestartYunzai () {
  return (await restartPlans()).length > 0
}

/**
 * 记一笔「我要重启了」：新进程靠它算耗时、发那句私聊。
 *
 * @param {object} info 从哪来
 * @param {string} [info.reason] `auto-update` / `manual-update` 之类，只进日志与私聊正文
 * @returns {void}
 */
export function markRestartPending ({ reason = '' } = {}) {
  try {
    ensureDir(path.dirname(RESTART_MARK_FILE))
    writeYaml(RESTART_MARK_FILE, { at: Date.now(), reason })
  } catch (err) {
    log.warn('重启标记没写成（重启后就不会发耗时了）', err)
  }
}

/**
 * 读走重启标记：不管用不用得上都清掉，免得下次载入又报一遍。
 *
 * @returns {{ at: number, reason: string }|null} 没有标记回 null
 */
function takeRestartMark () {
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
 * 重启 Yunzai：先记时间戳，再挑一条能用的路叫下去。
 *
 * 没路可走时**什么都不做**，标记也一并抹掉 —— 进程一根手指都不动，调用方去提示主人手动重启。
 *
 * @param {object} [info] 从哪来
 * @param {string} [info.reason] 记进标记与日志的原因
 * @returns {Promise<string>} 真叫了回那条路的名字；没有能用的路回空串
 */
export async function restartYunzai ({ reason = '', exit } = {}) {
  const plans = await restartPlans({ exit })
  if (!plans.length) return ''

  const plan = plans[0]
  markRestartPending({ reason })
  log.mark(`正在重启 Yunzai（${plan.text}）`)
  const ok = await plan.run()
  /** 只有「前台转后台」会回 false（新进程没起成）：标记抹掉，免得下次启动报一个假的耗时 */
  if (ok === false) {
    clearRestartMark()
    log.warn(`重启没做成（${plan.text}），进程没动，等主人手动重启`)
    return ''
  }
  return plan.text
}

/**
 * 抹掉重启标记（重启没做成时用，别让下次启动报一个假的耗时）。
 *
 * @returns {void}
 */
function clearRestartMark () {
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
async function tellMaster (text) {
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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 载入完成后把「重启成功：耗时 X 秒」私聊给主人。
 *
 * 刚起来那几秒机器人多半还没连上，私聊会静默失败，所以隔 5 秒再试，最多试 12 次（约一分钟）；
 * 标记只在**发出去之后**才算用掉，全试完还发不出去就留着日志提醒，别占着下次启动。
 *
 * @returns {Promise<string>} 发出去的正文；没重启过、或者过了时效就回空串
 */
export async function reportRestartDone () {
  const mark = takeRestartMark()
  if (!mark) return ''

  const ms = Date.now() - mark.at
  if (ms < 0 || ms > RESTART_FRESH_MS) {
    log.info(`上一次重启标记太旧了（${Math.round(ms / 1000)} 秒前），不报耗时`)
    return ''
  }

  const text = `重启成功：耗时${(ms / 1000).toFixed(2)}秒`
  const lines = [text, mark.reason === 'auto-update' ? '[自动更新完自动重启的]' : mark.reason === 'manual-update' ? '[手动更新完自动重启的]' : '']
  const body = lines.filter(Boolean).join('\n')

  for (let i = 0; i < REPORT_TRIES; i++) {
    if (await tellMaster(body)) {
      log.mark(`重启完成，已私聊主人（${text}）`)
      return body
    }
    await sleep(REPORT_GAP_MS)
  }

  log.warn(`重启完成但私聊没发出去（${text}）`)
  return ''
}
