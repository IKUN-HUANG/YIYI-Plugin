/** 自动更新的间隔、冲突静默与任务生命周期。 */
import { Config } from '#yiyi.components'
import { rootDir, createIntervalTask, pluginTitle } from '#yiyi.utils'
import { canRestartYunzai, restartYunzai } from '../restart.js'
import { log, UPDATE_REPOS, shortSha } from './common.js'
import { runPluginUpdate } from './execute.js'
import { notifyUpdateMaster } from './notify.js'

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
    const willRestart = await canRestartYunzai()
    /**
     * 一行一件事、方括号起头：手机上扫一眼就知道「更到哪了、从哪来」，比一整段话好读。
     * 源缺了就整行不写（`ret.label` 空 = 连 remote 都没探出来）。
     */
    await notifyUpdateMaster([
      `${pluginTitle}自动更新:`,
      `[${ret.subject || shortSha(ret.after)}]`,
      `[${shortSha(ret.before)} → ${shortSha(ret.after)}]`,
      ret.label ? `[源：${ret.source}]` : '',
      willRestart ? '开始重启Yunzai...' : '这个框架没有可用的重启方式（既没有 Bot.restart，也没有 Miao 那种本地重启服务，还不在进程守护里），麻烦手动重启一次 Yunzai 让新版本生效。'
    ].filter(Boolean).join('\n'))
    if (!willRestart) {
      log.warn('没有可用的重启接口，不动进程，已通知主人手动重启')
      return { ...ret, restarted: '' }
    }

    const how = await restartYunzai({ reason: 'auto-update' })
    if (!how) {
      log.warn('重启没做成，进程没动')
      await notifyUpdateMaster([`${pluginTitle}自动更新:`, '已更新，但重启没做成（框架的启动脚本没起来），麻烦手动重启一次 Yunzai 让新版本生效。'].join('\n'))
      return { ...ret, restarted: '' }
    }
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
