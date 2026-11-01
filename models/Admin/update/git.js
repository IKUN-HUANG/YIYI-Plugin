/** Git 命令、仓库查询、补丁备份与上游拉取。 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { rootDir, dataDir } from '#yiyi.utils'
import fs from 'node:fs'
import path from 'node:path'
import { log, UPDATE_REPOS, hostOf } from './common.js'

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
export async function git (args, cwd = rootDir) {
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
export function gitReason (err, fallback = '执行 git 失败') {
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
export async function dirtyFiles (cwd) {
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
export async function upstreamChanged (cwd, target) {
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
export async function savePatch (cwd) {
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
export async function readGitVersion () {
  try {
    const { stdout } = await execFileAsync('git', ['--version'], { timeout: 5000, windowsHide: true })
    return String(stdout ?? '').trim().replace(/^git version\s*/i, '')
  } catch {
    return ''
  }
}

/**
 * 拉上游；当前域名拉不动就换另一个站（github ↔ gitee）再试一次。
 *
 * @param {string} cwd 仓库根
 * @param {string} remote remote 名
 * @param {string} branch 分支名
 * @returns {Promise<string>} 换过镜像就回那个镜像 URL，没换回空串
 */
export async function fetchUpstream (cwd, remote, branch) {
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
