/**
 * @file `#伊伊更新` 与每日自动检查，只做快进。
 * @module models/Admin/update
 *
 * 动手之前先 `probeUpdateSource` 探环境：没装 git、目录不是 git 仓库（压缩包装的）、插件只是
 * 外层仓库里的一层、没配远程、游离 HEAD，全部翻成人话直接回给用户，顺带报出上游是 GitHub 还是
 * Gitee。分叉也明确拒绝；绝不在用户工作区做 merge/rebase —— 插件目录是用户的，猜错一次就是数据事故。
 *
 * 副作用：跑 git、私聊主人、重启 Yunzai、起一个每日定时任务。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { rootDir, createLogger, parseClock, formatClock, createAutoTask, pluginTitle } from '#yiyi.utils'
import { Config } from '#yiyi.components'

const log = createLogger('管理')

/**
 * 上游两个站，单位：URL；一个拉不动就换另一个（国内 gitee 通常更通）。
 */
export const UPDATE_REPOS = [
  'https://github.com/IKUN-HUANG/YIYI-Plugin.git',
  'https://gitee.com/IKUN-HUANG/YIYI-Plugin.git'
]

/** 官方 GitHub 地址 */
const GITHUB_URL = UPDATE_REPOS[0]
/** 官方 Gitee 地址，国内默认推这一个 */
const GITEE_URL = UPDATE_REPOS[1]
/** 认「是不是官方仓库」：地址里带这段路径就算 */
const OFFICIAL_REPO_RE = /ikun-huang\/yiyi-plugin/i
/** 站点 key → 回执里给人看的叫法 */
const SITE_LABELS = { github: 'GitHub', gitee: 'Gitee' }

/** git 单条命令的超时，单位毫秒：网络卡住时宁可失败也不要挂着 */
const GIT_TIMEOUT_MS = 60 * 1000
/** git 输出上限，单位字节：`log` 偶尔会吐很长，超了 execFile 会直接抛错 */
const GIT_MAX_BUFFER = 4 * 1024 * 1024

const execFileAsync = promisify(execFile)

/**
 * 跑一条 git 命令并返回 trim 过的 stdout。
 *
 * @param {Array<string>} args 参数表（不经过 shell，避免转义问题）
 * @param {string} [cwd] 在哪个目录跑，默认插件根
 * @returns {Promise<string>} 输出（已 trim）；失败时抛出 execFile 的原始错误
 */
async function git (args, cwd = rootDir) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: GIT_MAX_BUFFER
  })
  return String(stdout ?? '').trim()
}

/**
 * 从 git 的报错里挑一句人话：最后一行才是，前缀 `fatal:` 去掉。
 *
 * @param {Error} err execFile 抛出来的错误
 * @param {string} [fallback] 一句都挑不出来时的兜底，默认「执行 git 失败」
 * @returns {string} 能直接发给用户的一句话
 */
function gitReason (err, fallback = '执行 git 失败') {
  const lines = String(err?.stderr || err?.message || '').trim().split('\n').filter(Boolean)
  return (lines.pop() || fallback).replace(/^fatal:\s*/i, '')
}

/**
 * 认出这个 remote 是哪个站，用来决定镜像换哪边。
 *
 * @param {string} [url] remote 地址，默认空
 * @returns {string} `gitee` / `github` / 空串（认不出来）
 */
function hostOf (url = '') {
  if (/gitee\.com/i.test(url)) return 'gitee'
  if (/github\.com/i.test(url)) return 'github'
  return ''
}

/**
 * 取短 sha，给回执用。
 *
 * @param {string} [sha] 完整 sha，默认空
 * @returns {string} 前 7 位
 */
export function shortSha (sha = '') {
  return String(sha).slice(0, 7)
}

/**
 * 找仓库根。
 *
 * @param {string} [cwd] 从哪个目录找起，默认插件根
 * @returns {Promise<string|null>} 仓库根；不是仓库（或没装 git）回 null
 */
export async function repoRoot (cwd = rootDir) {
  try {
    return (await git(['rev-parse', '--show-toplevel'], cwd)) || null
  } catch {
    return null
  }
}

/**
 * 取当前分支名。
 *
 * @param {string} [cwd] 在哪个目录问，默认插件根
 * @returns {Promise<string|null>} 分支名；游离 HEAD 回 null
 */
export async function currentBranch (cwd = rootDir) {
  try {
    const name = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
    return name && name !== 'HEAD' ? name : null
  } catch {
    return null
  }
}

/**
 * 读 git 版本号，顺便当「这台机器有没有 git」的探针。
 *
 * @returns {Promise<string>} 版本号（`2.39.2`）；没装 git 回空串
 */
async function readGitVersion () {
  try {
    const { stdout } = await execFileAsync('git', ['--version'], { timeout: 5000, windowsHide: true })
    return String(stdout ?? '').trim().replace(/^git version\s*/i, '')
  } catch {
    return ''
  }
}

/**
 * 认 remote 地址属于哪个站，回执里说「源：Gitee」用。
 *
 * @param {string} [url] remote 地址，默认空
 * @returns {{site: string, label: string}} site 是 `github` / `gitee` / `other` / `local` / 空串
 */
function siteOf (url = '') {
  const text = String(url ?? '').trim()
  if (!text) return { site: '', label: '' }

  const host = hostOf(text)
  if (host) return { site: host, label: SITE_LABELS[host] }

  if (/^file:\/\//i.test(text) || /^[a-zA-Z]:[\\/]/.test(text) || /^[\\/]|^\.{1,2}[\\/]/.test(text)) {
    return { site: 'local', label: '本地目录' }
  }

  const domain = text.match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)/i)?.[1] ?? ''
  return domain ? { site: 'other', label: domain } : { site: 'other', label: '其它站点' }
}

/**
 * 没装 git 时的说明。
 *
 * @param {string} dir 插件目录
 * @returns {string} 可以直接发给用户的多行说明
 */
function noGitText (dir) {
  return [
    '这台机器上没有 git 命令，「#伊伊更新」用不了（每日自动更新也会直接跳过）。',
    '',
    `插件目录：${dir}`,
    '插件本身照常能用，只是没法一键更新。装好 git 之后再发一次「#伊伊更新」就行：',
    '  Debian/Ubuntu：apt install -y git',
    '  CentOS/Alma：yum install -y git',
    '  Windows：装 Git for Windows，装完重开 Yunzai'
  ].join('\n')
}

/**
 * 目录根本不是 git 仓库（压缩包解压 / 手动复制装的）时的说明。
 *
 * @param {string} dir 插件目录
 * @returns {string} 可以直接发给用户的多行说明
 */
function notRepoText (dir) {
  return [
    `「${dir}」不是 git 仓库，用不了 git 更新。`,
    '',
    '这份插件应该是解压压缩包或手动复制进来的，目录里没有 .git，也就没有能拉的上游。想恢复一键更新，二选一：',
    '1. 用 git clone 重装（推荐，之后「#伊伊更新」就能用）：',
    `   git clone --depth=1 ${GITEE_URL}`,
    `   海外网络可以换 GitHub：${GITHUB_URL}`,
    '2. 保持现在的装法：去 Gitee 或 GitHub 下载最新压缩包解压覆盖，注意别删 config/，设置都在里面。',
    '',
    '插件其余功能不受影响，只是「#伊伊更新」和每日自动更新都不会生效。'
  ].join('\n')
}

/**
 * 有 `.git` 但读不出来时的说明。
 *
 * @param {string} dir 插件目录
 * @returns {string} 可以直接发给用户的多行说明
 */
function brokenRepoText (dir) {
  return [
    `「${dir}」里有个 .git，但 git 读不出来（仓库可能损坏，或者只复制了一半）。`,
    '',
    '先试着手动看一眼：',
    `  git -C "${dir}" status`,
    '修不好就按压缩包重装，或者重新 clone 一份再把 config/ 拷过去。'
  ].join('\n')
}

/**
 * 插件只是外层仓库里的一层目录时的说明：不能拿外层仓库当插件更新。
 *
 * @param {string} dir 插件目录
 * @param {string} inside 包着它的外层仓库根
 * @returns {string} 可以直接发给用户的多行说明
 */
function insideRepoText (dir, inside) {
  return [
    `「${dir}」里没有自己的 .git，它只是外层仓库「${inside}」里的一个目录。`,
    '',
    '对着它执行 git 更新会改动整个外层仓库的工作区，所以「#伊伊更新」不会这么做。要让插件能独立更新，把它 clone 成自己的仓库：',
    `  git clone --depth=1 ${GITEE_URL}`,
    '（换目录重装之前先把 config/ 备份出去，设置都在里面。）'
  ].join('\n')
}

/**
 * 空仓库（有 `.git` 但一次提交都没有）时的说明。
 *
 * @param {string} dir 插件目录
 * @returns {string} 可以直接发给用户的多行说明
 */
function emptyRepoText (dir) {
  return [
    `「${dir}」是个空 git 仓库（还没有任何提交），没有可以拉的上游。`,
    '',
    '想用一键更新，直接从官方仓库重新 clone 一份：',
    `  git clone --depth=1 ${GITEE_URL}`,
    '（换目录之前先把 config/ 备份出去，设置都在里面。）'
  ].join('\n')
}

/**
 * 停在游离 HEAD 上时的说明。
 *
 * @param {string} dir 插件目录
 * @returns {string} 可以直接发给用户的多行说明
 */
function detachedText (dir) {
  return [
    '插件仓库现在停在游离 HEAD 上（没在任何分支），git 不知道跟上游哪个分支。',
    '',
    `先切回分支再更新：git -C "${dir}" checkout main`,
    '切回去再发一次「#伊伊更新」。'
  ].join('\n')
}

/**
 * 是仓库但没配远程时的说明。
 *
 * @param {string} dir 插件目录
 * @param {string} branch 当前分支
 * @returns {string} 可以直接发给用户的多行说明
 */
function noRemoteText (dir, branch) {
  return [
    `「${dir}」是 git 仓库（分支 ${branch}），但没配远程仓库，没有地方可以拉更新。`,
    '',
    '加上官方远程再试：',
    `  git -C "${dir}" remote add origin ${GITEE_URL}`,
    `海外网络可以换成 GitHub：${GITHUB_URL}`
  ].join('\n')
}

/**
 * 探一次更新环境：git 在不在、目录自己是不是仓库、跟着哪个远程、源是 GitHub 还是 Gitee。
 *
 * 所有「用不了」的情况都在这里翻成人话，调用方只管把 `reason` 发出去。
 *
 * @param {{cwd?: string}} [opts] cwd 默认插件根
 * @returns {Promise<{ok: boolean, blocked: boolean, git: boolean, gitVersion: string, cwd: string,
 *   repo: string|null, inside: string|null, branch: string|null, remote: string, url: string,
 *   site: string, label: string, official: boolean, upstream: string, source: string, reason: string}>}
 *   ok=false 时 `blocked:true`、`reason` 是可以直接发给用户的多行说明
 */
export async function probeUpdateSource ({ cwd = rootDir } = {}) {
  const dir = path.resolve(cwd)
  const env = {
    ok: false,
    blocked: true,
    git: false,
    gitVersion: '',
    cwd: dir,
    repo: null,
    inside: null,
    branch: null,
    remote: '',
    url: '',
    site: '',
    label: '',
    official: false,
    upstream: '',
    source: '',
    reason: ''
  }

  const gitVersion = await readGitVersion()
  if (!gitVersion) return { ...env, reason: noGitText(dir) }
  env.git = true
  env.gitVersion = gitVersion

  const top = await repoRoot(dir)
  if (!top) {
    const hasGitDir = fs.existsSync(path.join(dir, '.git'))
    return { ...env, reason: hasGitDir ? brokenRepoText(dir) : notRepoText(dir) }
  }

  const real = p => {
    try {
      return fs.realpathSync(p)
    } catch {
      return path.resolve(p)
    }
  }
  if (real(top) !== real(dir)) return { ...env, inside: top, reason: insideRepoText(dir, top) }

  env.repo = top

  try {
    await git(['rev-parse', '--verify', '--quiet', 'HEAD'], top)
  } catch {
    return { ...env, reason: emptyRepoText(dir) }
  }

  const branch = await currentBranch(top)
  if (!branch) return { ...env, reason: detachedText(dir) }
  env.branch = branch

  let tracked = ''
  try {
    tracked = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], top)
  } catch { /** 没设上游就用 origin/<branch> */ }

  let remotes = []
  try {
    remotes = (await git(['remote'], top)).split('\n').map(s => s.trim()).filter(Boolean)
  } catch { /** 一个 remote 都没有 */ }
  const remote = tracked ? tracked.split('/')[0] : (remotes.includes('origin') ? 'origin' : remotes[0] || '')

  let url = ''
  if (remote) {
    try {
      url = await git(['remote', 'get-url', remote], top)
    } catch { /** 名字在、地址读不出来，当成没配 */ }
  }
  if (!remote || !url) return { ...env, reason: noRemoteText(dir, branch) }

  const { site, label } = siteOf(url)
  const official = OFFICIAL_REPO_RE.test(url)
  const upstream = tracked || `${remote}/${branch}`
  const source = [label || '来源未知', upstream, official || !/github|gitee/.test(site) ? '' : '非官方地址']
    .filter(Boolean)
    .join(' · ')

  return { ...env, ok: true, blocked: false, remote, url, site, label, official, upstream, source }
}

/**
 * 「正在检查上游更新…」这句回执，带上探出来的源（GitHub / Gitee）。
 *
 * @param {{source?: string}} [env] probeUpdateSource 的结果
 * @returns {string} 一行话
 */
export function updateCheckingText (env = {}) {
  return env?.source ? `正在检查上游更新…（源：${env.source}）` : '正在检查上游更新…'
}

/**
 * 拉上游；当前域名拉不动就换另一个站（github ↔ gitee）再试一次。
 *
 * @param {string} cwd 仓库根
 * @param {string} remote remote 名
 * @param {string} branch 分支名
 * @returns {Promise<string>} 换过镜像就回那个镜像 URL，没换回空串
 */
async function fetchUpstream (cwd, remote, branch) {
  try {
    await git(['fetch', '--quiet', remote], cwd)
    return ''
  } catch (err) {
    let url = ''
    try {
      url = await git(['remote', 'get-url', remote], cwd)
    } catch { /** 没配这个 remote 就当空，下面继续用默认上游 */ }
    const host = hostOf(url)
    const mirror = host ? UPDATE_REPOS.find(u => hostOf(u) !== host) : ''
    if (!mirror) throw err

    log.warn(`从 ${url || remote} 拉取失败（${gitReason(err)}），换镜像 ${mirror} 再试`)
    await git(['fetch', '--quiet', mirror, branch], cwd)
    return mirror
  }
}

/**
 * 检查并快进。ok 只管「命令跑成没跑成」：
 * 环境用不了（没装 git / 不是仓库 / 没配远程 / 游离 HEAD）= ok:false + blocked:true + 多行 reason；
 * 分叉 = ok:false + reason；没更新 = ok:true + updated:false。
 *
 * @param {{cwd?: string, pull?: boolean}} [opts] cwd 默认插件根；pull=false 只检查不合并
 * @returns {Promise<{ok: boolean, updated: boolean, blocked?: boolean, repo?: string|null,
 *   inside?: string|null, branch?: string|null, remote?: string, url?: string, site?: string,
 *   label?: string, official?: boolean, source?: string, upstream?: string, before?: string,
 *   after?: string, upstreamSha?: string, ahead?: number, behind?: number, incoming?: number,
 *   subject?: string, mirror?: string, pending?: number, reason?: string}>}
 *   blocked:true 时 reason 是给用户看的完整说明（多行），其余情况 reason 是一句话
 */
export async function runPluginUpdate ({ cwd = rootDir, pull = true } = {}) {
  const env = await probeUpdateSource({ cwd })
  if (!env.ok) return { ok: false, updated: false, ...env }

  const { repo, branch, remote, source } = env
  const upstream = env.upstream

  let mirror = ''
  try {
    mirror = await fetchUpstream(repo, remote, branch)
  } catch (err) {
    return { ok: false, updated: false, ...env, blocked: false, reason: `拉取上游失败：${gitReason(err)}` }
  }

  const target = mirror ? 'FETCH_HEAD' : upstream
  try {
    await git(['rev-parse', '--verify', '--quiet', `${target}^{commit}`], repo)
  } catch {
    return { ok: false, updated: false, ...env, blocked: false, reason: `找不到上游分支「${upstream}」，检查一下 git branch -u` }
  }

  const before = await git(['rev-parse', 'HEAD'], repo)
  const upstreamSha = await git(['rev-parse', target], repo)
  const ahead = Number(await git(['rev-list', '--count', `${target}..HEAD`], repo)) || 0
  const behind = Number(await git(['rev-list', '--count', `HEAD..${target}`], repo)) || 0
  const base = { ...env, ok: true, updated: false, upstream: target, before, after: before, upstreamSha, ahead, behind, mirror }

  if (!behind) return { ...base, reason: ahead ? `本地比上游多 ${ahead} 个提交` : '' }
  if (ahead) return { ...base, ok: false, reason: `本地有 ${ahead} 个提交、上游有 ${behind} 个，分叉了；自动更新只做快进，请手动处理` }

  const subject = await git(['log', '--format=%h %s', '--no-merges', '-1', `HEAD..${target}`], repo)
  if (!pull) return { ...base, pending: behind, subject }

  try {
    await git(['merge', '--ff-only', target], repo)
  } catch (err) {
    return { ...base, ok: false, subject, reason: `合并失败：${gitReason(err)}` }
  }

  const head = await git(['rev-parse', 'HEAD'], repo)
  return { ...base, updated: true, after: head, incoming: behind, subject }
}

let mastersCache = []

/**
 * 记 / 取主人名单。事件上才带 `e.runtime.cfg.masterQQ`，定时那条路没有事件，用最近一次记下的。
 *
 * @param {object} [e] 事件；不传就是「要一份名单」
 * @returns {Array<string>} 主人 QQ 列表；一次都没见过回空数组
 */
export function updateMasterList (e) {
  if (!e) return [...mastersCache]

  const cfg = e.runtime?.cfg
  if (!cfg) return []

  const raw = cfg.masterQQ ?? cfg.master ?? []
  const list = (Array.isArray(raw) ? raw : [raw]).map(v => String(v ?? '').trim()).filter(Boolean)
  if (list.length) mastersCache = list
  return list
}

/**
 * 私聊主人（两条路：pickFriend 优先，退到 sendMasterMsg）。
 *
 * @param {string} msg 要发的正文
 * @returns {Promise<boolean>} true = 发出去了；false = 没有主人名单或两条路都失败
 */
export async function notifyUpdateMaster (msg) {
  const masters = updateMasterList()
  if (!masters.length) {
    log.warn('还没见过带主人名单的消息（框架只在 e.runtime.cfg.masterQQ 上给），更新通知没发出去')
    return false
  }

  try {
    const qq = /^\d+$/.test(masters[0]) ? Number(masters[0]) : masters[0]
    const friend = globalThis.Bot?.pickFriend?.(qq)
    if (typeof friend?.sendMsg === 'function') {
      await friend.sendMsg(msg)
      return true
    }
  } catch (err) {
    log.error('私聊主人失败', err)
  }

  try {
    if (typeof globalThis.Bot?.sendMasterMsg === 'function') {
      await globalThis.Bot.sendMasterMsg(msg)
      return true
    }
  } catch (err) {
    log.error('私聊主人失败', err)
  }

  return false
}

/**
 * 这个框架给不给重启接口 —— 只认 `Bot.restart()`。
 *
 * 不拿 `Bot.exit()` / `process.exit()` 兜底：Miao 与 TRSS 对「进程退出」的处理完全不是一回事，
 * 有的框架退出就真退出了（没有守护程序托管时不会再有人把它拉起来），更新完把机器人关掉比
 * 干脆不重启糟得多。没有重启接口就只提示主人手动重启，进程一根手指都不动。
 *
 * @returns {boolean} 有 `Bot.restart()` 就是 true
 */
export function canRestartYunzai () {
  return typeof globalThis.Bot?.restart === 'function'
}

/**
 * 调框架的重启接口。
 *
 * @returns {string} 真调了回 `Bot.restart()`；框架没给接口回空串，调用方要提示主人手动重启
 */
export function restartYunzai () {
  if (!canRestartYunzai()) return ''
  globalThis.Bot.restart()
  return 'Bot.restart()'
}

/**
 * 把「HH:MM」翻成当天第几分钟。
 *
 * @param {string} [text] 时间文本，默认取配置里的更新时间
 * @returns {number|null} 0–1439；认不出来回 null
 */
export function parseUpdateTime (text = Config.pluginAutoUpdateTime) {
  return parseClock(text)
}

/**
 * 反过来：分钟数 → `HH:MM`，回执与日志统一用它。
 *
 * @param {string} [text] 时间文本，默认取配置里的更新时间
 * @returns {string} `HH:MM`；认不出来回空串
 */
export function formatUpdateTime (text = Config.pluginAutoUpdateTime) {
  return formatClock(parseUpdateTime(text))
}

/** 每日自动更新：判断「今天到点没有、今天跑过没有」都交给 createAutoTask */
const autoUpdate = createAutoTask({
  enabled: () => Config.pluginAutoUpdate,
  timeText: () => Config.pluginAutoUpdateTime,
  parseTime: () => parseUpdateTime(),
  formatTime: () => formatUpdateTime(),
  disabledReason: '自动更新已关闭',
  timeLabel: '更新时间',
  sameDayReason: '今天已经检查过',
  startLabel: '插件自动更新',
  log,
  status: () => ({ repos: UPDATE_REPOS }),
  run: async ({ cwd = rootDir } = {}) => {
    const ret = await runPluginUpdate({ cwd })
    if (!ret.ok) {
      if (ret.blocked) {
        log.mark(`跳过自动更新：${String(ret.reason).split('\n')[0]}`)
        return { ...ret }
      }
      log.warn(`自动更新失败：${ret.reason}`)
      return { ...ret }
    }
    if (!ret.updated) {
      log.mark('上游没有更新，静默')
      return { ...ret }
    }

    log.mark(`插件已更新：${ret.subject || shortSha(ret.after)}`)
    const willRestart = canRestartYunzai()
    await notifyUpdateMaster(
      `「${pluginTitle}」有新版本，已经自动更新好了：\n\n${ret.subject || ''}\n${shortSha(ret.before)} → ${shortSha(ret.after)}\n${ret.label ? `源：${ret.source}\n` : ''}\n${willRestart ? '正在重启 Yunzai…' : '这个框架没有重启接口（没给 Bot.restart），麻烦手动重启一次 Yunzai 让新版本生效。'}`
    )
    if (!willRestart) {
      log.warn('框架没给 Bot.restart()，不动进程，已通知主人手动重启')
      return { ...ret, restarted: '' }
    }

    const how = restartYunzai()
    log.mark(`正在重启 Yunzai（${how}）`)
    return { ...ret, restarted: how }
  }
})

/** 立刻跑一次自动更新（闸门用，跳过时间判断）。 */
export const runAutoUpdate = autoUpdate.run
/** 起每日定时检查。 */
export const startUpdateCheck = autoUpdate.start
/** 停掉定时检查。 */
export const stopUpdateCheck = autoUpdate.stop
/** 现在能不能跑、为什么不能跑。 */
export const updateStatus = autoUpdate.status
