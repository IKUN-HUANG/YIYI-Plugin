/**
 * @file `#伊伊更新` / `#伊伊强制更新` 与自动检查（每 N 分钟看一眼上游有没有新提交）。
 * @module models/Admin/update
 *
 * 动手之前先 `probeUpdateSource` 探环境：没装 git、目录不是 git 仓库（压缩包装的）、插件只是
 * 外层仓库里的一层、没配远程、游离 HEAD，全部翻成人话直接回给用户，顺带报出上游是 GitHub 还是
 * Gitee。分叉也明确拒绝；默认路线绝不在用户工作区做 merge/rebase —— 插件目录是用户的，猜错一次
 * 就是数据事故。
 *
 * 唯一的例外是主人**明确要**的 `#伊伊强制更新`（`force: true`）：`git reset --hard` 把工作区对齐到
 * 上游，本地改动与本地提交一起丢掉，冲突无从谈起。覆盖前先把已跟踪文件的改动存成补丁放进
 * `data/update/`，盖错了还能 `git apply` 找回；未跟踪文件（`data/`、`cache/`、`config/config/`）
 * git 本来就不碰，设置不会丢。
 *
 * 副作用：跑 git、私聊主人、重启 Yunzai、起一个常驻轮询任务（定时器由入口的「载入完成」
 * 钩子挂上，不然那行启动日志会插到载入横幅中间去）。
 *
 * 回执与通知的格式是对外契约（用户按它判断「更到哪了」）：手动更新的每一条回执都**引用回复**，
 * 正文一行一件事、用方括号起头 —— `已更新 1 个提交：` / `[<sha> <提交说明>]` / `[旧 sha → 新 sha]` /
 * `开始重启Yunzai…`；自动更新只私聊首位主人，前几行同样是方括号，最后一行是 `开始重启Yunzai...`。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { rootDir, dataDir, createLogger, createIntervalTask, pluginTitle } from '#yiyi.utils'
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
 * 本地改动（只看**已跟踪**文件）：`git reset --hard` 会悄无声息吃掉的就是这些。
 *
 * 未跟踪文件（`data/`、`cache/`、`config/config/` 都不入库）不在里面：git 本身不碰它们，
 * 用户设置、登录态、绑定都靠这个区分活下来，所以这里只数已跟踪的。
 *
 * @param {string} cwd 仓库根
 * @returns {Promise<Array<string>>} 改过的文件路径（相对仓库根）；读不出来回空数组
 */
async function dirtyFiles (cwd) {
  try {
    const out = await git(['status', '--porcelain', '--untracked-files=no'], cwd)
    return out
      ? out.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
        /** `XY path` 或 `R  old -> new`：取右半边那个真实路径 */
        const rest = line.slice(2).trim()
        return rest.includes(' -> ') ? rest.split(' -> ').pop() : rest
      })
      : []
  } catch {
    return []
  }
}

/**
 * 上游这两个提交之间动了哪些文件 —— 本地改动撞上这些文件才会真冲突。
 *
 * @param {string} cwd 仓库根
 * @param {string} target 上游 ref（`origin/main` 或 `FETCH_HEAD`）
 * @returns {Promise<Array<string>>} 文件路径；读不出来回空数组
 */
async function upstreamChanged (cwd, target) {
  try {
    const out = await git(['diff', '--name-only', 'HEAD', target], cwd)
    return out ? out.split('\n').map(s => s.trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

/** 补丁文件名里的时间戳：`20261027-181530`，按本地时区 */
function stampNow () {
  const at = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
}

/**
 * 强制覆盖之前，先把已跟踪文件的改动存成补丁（`data/update/force-<时间>.patch`）。
 *
 * 覆盖是主人要求的，但「要覆盖」和「盖错了没法回头」是两件事：一份 `git apply` 就能还原的补丁
 * 成本几乎为零，而它能把一次手滑从「改了一晚上的东西没了」降级成「多一条命令」。
 *
 * @param {string} cwd 仓库根
 * @returns {Promise<string>} 补丁文件绝对路径；没有改动 / 写不出来回空串
 */
async function savePatch (cwd) {
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--binary', 'HEAD'], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: GIT_MAX_BUFFER
    })
    if (!String(stdout ?? '').trim()) return ''
    const dir = path.join(dataDir, 'update')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `force-${stampNow()}.patch`)
    fs.writeFileSync(file, String(stdout), 'utf8')
    return file
  } catch (err) {
    log.warn(`覆盖前备份本地改动失败（${err?.message || err}），继续覆盖`)
    return ''
  }
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
    '这台机器上没有 git 命令，「#伊伊更新」用不了（自动更新也会直接跳过）。',
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
    '插件其余功能不受影响，只是「#伊伊更新」和自动更新都不会生效。'
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
 * 「伊伊插件检查更新中.」这句回执，第二行带上探出来的源（Gitee · origin/main）。
 *
 * 两行而不是一句话：源里本来就有 `·` 和小横线，挤在括号里在手机上会折成一团。
 *
 * @param {{source?: string}} [env] probeUpdateSource 的结果
 * @returns {string} 一两行话
 */
export function updateCheckingText (env = {}) {
  const source = String(env?.source || '').trim()
  return source ? `伊伊插件检查更新中.\n源: ${source}` : '伊伊插件检查更新中.'
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
 * 强制覆盖：`git reset --hard` 到上游，本地改动与本地提交一起丢掉。
 *
 * 不 merge、不 rebase、不 clean —— 冲突无从谈起，这正是 `#伊伊强制更新` 存在的理由。
 * 覆盖前先把已跟踪文件的改动存成补丁（见 `savePatch`），盖错了还能找回来。
 *
 * @param {{repo: string, target: string, base: object, dirty: Array<string>}} args 目标仓库 / 上游 ref / 公共字段 / 改过的文件
 * @returns {Promise<object>} 与 `runPluginUpdate` 同形状，另加 forced / discarded / droppedCommits / patch / moved / subject
 */
async function forceOverwrite ({ repo, target, base, dirty }) {
  let subject = ''
  try {
    subject = await git(['log', '--format=%h %s', '--no-merges', '-1', target], repo)
  } catch { /** 取不到提交说明不影响覆盖，回执里少一行而已 */ }

  const patch = dirty.length ? await savePatch(repo) : ''
  try {
    await git(['reset', '--hard', target], repo)
  } catch (err) {
    return { ...base, ok: false, forced: true, conflict: dirty, reason: `覆盖失败：${gitReason(err)}` }
  }

  const head = await git(['rev-parse', 'HEAD'], repo)
  return {
    ...base,
    ok: true,
    forced: true,
    /** 版本没动但本地改动被还原了，对外也算「变了」—— 回执不能只说「已经是最新」 */
    updated: head !== base.before || dirty.length > 0,
    moved: head !== base.before,
    after: head,
    incoming: base.behind,
    subject,
    discarded: dirty.length,
    droppedCommits: base.ahead,
    patch
  }
}

/**
 * 检查并快进；`force: true` 时改成直接覆盖。ok 只管「命令跑成没跑成」：
 * 环境用不了（没装 git / 不是仓库 / 没配远程 / 游离 HEAD）= ok:false + blocked:true + 多行 reason；
 * 分叉 / 本地改动挡住 = ok:false + reason（冲突时带上 `conflict` 文件表）；没更新 = ok:true + updated:false。
 *
 * @param {{cwd?: string, pull?: boolean, force?: boolean}} [opts] cwd 默认插件根；
 *   `pull:false` 只检查不合并；`force:true` 丢弃本地改动直接覆盖上游（`#伊伊强制更新` 那条路）
 * @returns {Promise<{ok: boolean, updated: boolean, blocked?: boolean, repo?: string|null,
 *   inside?: string|null, branch?: string|null, remote?: string, url?: string, site?: string,
 *   label?: string, official?: boolean, source?: string, upstream?: string, before?: string,
 *   after?: string, upstreamSha?: string, ahead?: number, behind?: number, incoming?: number,
 *   subject?: string, mirror?: string, pending?: number, forced?: boolean, moved?: boolean,
 *   conflict?: Array<string>, discarded?: number, droppedCommits?: number, patch?: string,
 *   reason?: string}>}
 *   blocked:true 时 reason 是给用户看的完整说明（多行），其余情况 reason 是一句话
 */
export async function runPluginUpdate ({ cwd = rootDir, pull = true, force = false } = {}) {
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

  const dirty = await dirtyFiles(repo)

  if (force) return await forceOverwrite({ repo, target, base, dirty })

  if (!behind) return { ...base, reason: ahead ? `本地比上游多 ${ahead} 个提交` : '' }
  if (ahead) {
    return {
      ...base,
      ok: false,
      reason: `本地有 ${ahead} 个提交、上游有 ${behind} 个，分叉了；自动更新只做快进，要丢掉本地提交直接覆盖就发「#伊伊强制更新」`
    }
  }

  const subject = await git(['log', '--format=%h %s', '--no-merges', '-1', `HEAD..${target}`], repo)

  /**
   * 「本地改动挡住了更新」：本地改过的文件，上游这一趟也改了 —— 快进要覆盖它们，git 会直接拒。
   * 只有交集才算冲突：本地改的文件上游没动，快进照样能过去，不该吓用户。
   */
  const changed = await upstreamChanged(repo, target)
  const conflict = dirty.filter(file => changed.includes(file))

  if (!pull) return { ...base, pending: behind, subject, conflict: conflict.length ? conflict : undefined }
  if (conflict.length) {
    return {
      ...base,
      ok: false,
      subject,
      conflict,
      reason: `本地改动挡住了更新：${conflict.join('、')}；发「#伊伊强制更新」丢弃本地改动直接覆盖`
    }
  }

  try {
    await git(['merge', '--ff-only', target], repo)
  } catch (err) {
    return {
      ...base,
      ok: false,
      subject,
      /** 报错里没细说，但工作区确实脏：按冲突算，自动更新才会通知并静默，而不是每 10 分钟干撞一次 */
      conflict: dirty.length ? dirty : undefined,
      reason: `合并失败：${gitReason(err)}（本地改动挡着的话，发「#伊伊强制更新」直接覆盖）`
    }
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

/** 间隔的合法范围，单位分钟：1 分钟已经比 git 服务商舒服的上限还快，一天当上限 */
const UPDATE_INTERVAL_MIN = 1
const UPDATE_INTERVAL_MAX = 1440

/**
 * 把配置里「隔几分钟查一次」翻成数字。
 *
 * @param {string|number} [text] 间隔原文，默认取配置里的更新间隔
 * @returns {number|null} 1–1440 的整数分钟；认不出来（不是数字 / 越界）回 null
 */
export function parseUpdateInterval (text = Config.pluginAutoUpdateInterval) {
  const num = Number(String(text ?? '').trim())
  if (!Number.isFinite(num)) return null
  const minutes = Math.round(num)
  if (minutes < UPDATE_INTERVAL_MIN || minutes > UPDATE_INTERVAL_MAX) return null
  return minutes
}

/**
 * 反过来：分钟数 → 人话的间隔，启动日志与状态统一用它。
 *
 * @param {string|number} [text] 间隔原文，默认取配置里的更新间隔
 * @returns {string} 形如 `10 分钟`；认不出来回空串
 */
export function formatUpdateInterval (text = Config.pluginAutoUpdateInterval) {
  const minutes = parseUpdateInterval(text)
  return minutes == null ? '' : `${minutes} 分钟`
}

/** 上一次「没什么可干」的结论：同一句话只报一次，不然每十分钟一条能把日志刷爆 */
let lastQuietNote = ''

/** 本地改动与上游撞车之后静默多久：12 小时（冲突不会因为多查几遍自己消失） */
const CONFLICT_HOLD_MS = 12 * 60 * 60 * 1000
/** 上面那个时长的说法，日志和私聊里都用它，别两处硬编码 */
const CONFLICT_HOLD_TEXT = '12 小时'

/**
 * 静默到什么时候（毫秒时间戳），0 = 没静默。
 *
 * 只在「本地改动和上游改到同一个文件」时写：那一刻机器再勤快也没用，得人来决定留哪边。
 * 主人手动跑 `#伊伊更新` / `#伊伊强制更新`、或者静默期满后又跑通了，都立刻解除。
 */
let holdUntil = 0

/**
 * 现在是不是在静默期里 —— 状态面板与闸门用。
 *
 * @returns {number} 静默到的时间戳（毫秒）；0 = 没静默
 */
export function updateHoldUntil () {
  return holdUntil
}

/**
 * 手动更新之后解除静默（手动就是「我已经处理过了」，没必要再等满 12 小时）。
 *
 * @returns {void}
 */
export function resetUpdateHold () {
  holdUntil = 0
}

/**
 * 同一句提示只报首次（结论变了才再说一次）。
 *
 * 轮询是常驻的：不是 git 仓库、上游拉不动这类毛病会一直存在，每圈都喊一遍等于刷屏。
 * 更新成功或恢复正常时把记忆清掉，下次真出问题还会再报。
 *
 * @param {string} note 这一次的结论（当去重 key 用）
 * @param {'info'|'mark'|'warn'} level 日志级别
 * @param {string} text 真要写进日志的那一句
 * @returns {void}
 */
function noteOnce (note, level, text) {
  if (note === lastQuietNote) return
  lastQuietNote = note
  if (level === 'warn') log.warn(text)
  else if (level === 'mark') log.mark(text)
  else log.info(text)
}

/** 每隔 N 分钟看一眼上游：有新提交就快进并重启，没有就一句都不写 */
const autoUpdate = createIntervalTask({
  enabled: () => Config.pluginAutoUpdate,
  intervalText: () => Config.pluginAutoUpdateInterval,
  parseInterval: () => parseUpdateInterval(),
  formatInterval: () => formatUpdateInterval(),
  disabledReason: '自动更新已关闭',
  intervalLabel: '更新间隔',
  startLabel: '插件自动更新',
  holdUntil: () => holdUntil,
  holdLabel: '本地改动挡住了更新',
  log,
  status: () => ({ repos: UPDATE_REPOS, holdUntil }),
  run: async ({ cwd = rootDir } = {}) => {
    const ret = await runPluginUpdate({ cwd })

    /**
     * 撞上了：本地改过的文件，上游这一趟也改了。快进会盖掉主人的改动，自动这条路不该替他决定，
     * 于是报一次、静默 12 小时 —— 期间一次 git 都不跑，免得每十分钟撞一次墙。
     */
    if (ret.conflict?.length) {
      holdUntil = Date.now() + CONFLICT_HOLD_MS
      const files = ret.conflict.map(file => `  ${file}`).join('\n')
      log.warn(`自动更新跳过：本地改动与上游撞车（${ret.conflict.join('、')}），${CONFLICT_HOLD_TEXT}内不再检查`)
      await notifyUpdateMaster(
        `「${pluginTitle}」自动更新卡住了：下面这些文件你改过、上游也改了，我没敢动：\n\n${files}\n\n` +
        `${ret.subject ? `上游最新：${ret.subject}\n\n` : ''}` +
        '想保留自己的改动：先提交或挪开，让我能快进。\n' +
        '想直接要上游版本：发「#伊伊强制更新」，覆盖前我会把改动存成补丁。\n\n' +
        `接下来 ${CONFLICT_HOLD_TEXT}先不查上游了，免得反复撞；这期间手动更新照常能用。`
      )
      return { ...ret, holdUntil }
    }

    /** 没撞车就说明冲突过去了（或压根没有），静默自然解除 */
    holdUntil = 0

    if (!ret.ok) {
      if (ret.blocked) {
        const head = String(ret.reason).split('\n')[0]
        noteOnce(`blocked:${head}`, 'mark', `跳过自动更新：${head}`)
        return { ...ret }
      }
      noteOnce(`fail:${ret.reason}`, 'warn', `自动更新失败：${ret.reason}`)
      return { ...ret }
    }
    if (!ret.updated) {
      /** 「上游没变动」是常态（每十分钟一次），静默；状态里的 lastAt 能看出还在查 */
      lastQuietNote = ''
      return { ...ret }
    }

    lastQuietNote = ''
    log.mark(`插件已更新：${ret.subject || shortSha(ret.after)}`)
    const willRestart = canRestartYunzai()
    /**
     * 一行一件事、方括号起头：手机上扫一眼就知道「更到哪了、从哪来」，比一整段话好读。
     * 源缺了就整行不写（`ret.label` 空 = 连 remote 都没探出来）。
     */
    await notifyUpdateMaster([
      `${pluginTitle}自动更新:`,
      `[${ret.subject || shortSha(ret.after)}]`,
      `[${shortSha(ret.before)} → ${shortSha(ret.after)}]`,
      ret.label ? `[源：${ret.source}]` : '',
      willRestart ? '开始重启Yunzai...' : '这个框架没有重启接口（没给 Bot.restart），麻烦手动重启一次 Yunzai 让新版本生效。'
    ].filter(Boolean).join('\n'))
    if (!willRestart) {
      log.warn('框架没给 Bot.restart()，不动进程，已通知主人手动重启')
      return { ...ret, restarted: '' }
    }

    const how = restartYunzai()
    log.mark(`正在重启 Yunzai（${how}）`)
    return { ...ret, restarted: how }
  }
})

/** 立刻跑一次自动更新（闸门用；`{ force: true }` 跳过间隔判断）。 */
export const runAutoUpdate = autoUpdate.run
/** 起轮询检查（每 N 分钟，N 取配置）。 */
export const startUpdateCheck = autoUpdate.start
/** 停掉定时检查。 */
export const stopUpdateCheck = autoUpdate.stop
/** 现在能不能跑、为什么不能跑。 */
export const updateStatus = autoUpdate.status
