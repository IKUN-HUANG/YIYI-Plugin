/**
 * @file update模块的一片实现。
 *
 * @module models/Update/Consts
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * 上游两个站，单位：URL；一个拉不动就换另一个（国内 gitee 通常更通）。
 */
export const UPDATE_REPOS = [
  'https://github.com/IKUN-HUANG/YIYI-Plugin.git',
  'https://gitee.com/IKUN-HUANG/YIYI-Plugin.git'
]

/** 官方 GitHub 地址 */
export const GITHUB_URL = UPDATE_REPOS[0]

/** 官方 Gitee 地址，国内默认推这一个 */
export const GITEE_URL = UPDATE_REPOS[1]

/** 认「是不是官方仓库」：地址里带这段路径就算 */
export const OFFICIAL_REPO_RE = /ikun-huang\/yiyi-plugin/i

/** 站点 key → 回执里给人看的叫法 */
export const SITE_LABELS = { github: 'GitHub', gitee: 'Gitee' }

/** git 单条命令的超时，单位毫秒：网络卡住时宁可失败也不要挂着 */
export const GIT_TIMEOUT_MS = 60 * 1000

/** git 输出上限，单位字节：`log` 偶尔会吐很长，超了 execFile 会直接抛错 */
export const GIT_MAX_BUFFER = 4 * 1024 * 1024

/** 把 git 子进程包成 Promise 的那层（只在本目录用） */
export const execFileAsync = promisify(execFile)

/** 间隔的合法范围，单位分钟：1 分钟已经比 git 服务商舒服的上限还快，一天当上限 */
export const UPDATE_INTERVAL_MIN = 1

/** 自动检查间隔的上限（分钟） */
export const UPDATE_INTERVAL_MAX = 1440

/** 上一次「没什么可干」的结论：同一句话只报一次，不然每十分钟一条能把日志刷爆 */

/** 本地改动与上游撞车之后静默多久：12 小时（冲突不会因为多查几遍自己消失） */
export const CONFLICT_HOLD_MS = 12 * 60 * 60 * 1000

/** 上面那个时长的说法，日志和私聊里都用它，别两处硬编码 */
export const CONFLICT_HOLD_TEXT = '12 小时'

/**
 * 静默到什么时候（毫秒时间戳），0 = 没静默。
 *
 * 只在「本地改动和上游改到同一个文件」时写：那一刻机器再勤快也没用，得人来决定留哪边。
 * 主人手动跑 `#伊伊更新` / `#伊伊强制更新`、或者静默期满后又跑通了，都立刻解除。
 */

