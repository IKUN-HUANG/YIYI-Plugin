/**
 * @file update模块的一片实现。
 *
 * @module models/Update/Auto
 */
import { canRestartYunzai, restartYunzai } from '../Restart.js'
import { Config } from '#yiyi.components'
import { rootDir, pluginTitle, createIntervalTask } from '#yiyi.utils'
import { createLogger } from '#yiyi.utils'
import { updateState } from './State.js'
import { UPDATE_REPOS, CONFLICT_HOLD_MS, CONFLICT_HOLD_TEXT } from './Consts.js'
import { parseUpdateInterval, formatUpdateInterval, noteOnce } from './Interval.js'
import { runPluginUpdate } from './Run.js'
import { notifyUpdateMaster } from './Masters.js'
import { shortSha } from './Git.js'

/** 这一片的日志出口（前缀与更新统一） */
const log = createLogger('管理')

/** 每隔 N 分钟看一眼上游：有新提交就快进并重启，没有就一句都不写 */
export const autoUpdate = createIntervalTask({
  enabled: () => Config.pluginAutoUpdate,
  intervalText: () => Config.pluginAutoUpdateInterval,
  parseInterval: () => parseUpdateInterval(),
  formatInterval: () => formatUpdateInterval(),
  disabledReason: '自动更新已关闭',
  intervalLabel: '更新间隔',
  startLabel: '插件自动更新',
  holdUntil: () => updateState.holdUntil,
  holdLabel: '本地改动挡住了更新',
  log,
  status: () => ({ repos: UPDATE_REPOS, holdUntil: updateState.holdUntil }),
  run: async ({ cwd = rootDir } = {}) => {
    const ret = await runPluginUpdate({ cwd })

    /**
     * 撞上了：本地改过的文件，上游这一趟也改了。快进会盖掉主人的改动，自动这条路不该替他决定，
     * 于是报一次、静默 12 小时 —— 期间一次 git 都不跑，免得每十分钟撞一次墙。
     */
    if (ret.conflict?.length) {
      updateState.holdUntil = Date.now() + CONFLICT_HOLD_MS
      const files = ret.conflict.map(file => `  ${file}`).join('\n')
      log.warn(`自动更新跳过：本地改动与上游撞车（${ret.conflict.join('、')}），${CONFLICT_HOLD_TEXT}内不再检查`)
      await notifyUpdateMaster(
        `「${pluginTitle}」自动更新卡住了：下面这些文件你改过、上游也改了，我没敢动：\n\n${files}\n\n` +
        `${ret.subject ? `上游最新：${ret.subject}\n\n` : ''}` +
        '想保留自己的改动：先提交或挪开，让我能快进。\n' +
        '想直接要上游版本：发「#伊伊强制更新」，覆盖前我会把改动存成补丁。\n\n' +
        `接下来 ${CONFLICT_HOLD_TEXT}先不查上游了，免得反复撞；这期间手动更新照常能用。`
      )
      return { ...ret, holdUntil: updateState.holdUntil }
    }

    /** 没撞车就说明冲突过去了（或压根没有），静默自然解除 */
    updateState.holdUntil = 0

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
      updateState.lastQuietNote = ''
      return { ...ret }
    }

    updateState.lastQuietNote = ''
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
