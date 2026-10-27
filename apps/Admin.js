/**
 * @file 帮助 / 版本 / 更新 / 设置的入口：认消息（正则）→ 调 models/Admin.js 那套函数 → 出图或回话。
 * @module apps/Admin
 *
 * 规则的先后顺序是有讲究的：分组命令必须排在通用设置规则前面，否则
 * `#伊伊基础设置` 会被通用规则当成「项名 = 基础设置」处理掉。
 */
import path from 'node:path'
import { createLogger, pluginTitle, version, yunzai, rootDir } from '#yiyi.utils'
import { render, Config } from '#yiyi.components'
import { extractMsgId, extractSrcId, loadChangelog, loadHelpConfig, loadHelpBg, persistBg, takeCachedBg, highlightCmds, settingsGroups, settingRest, matchSetting, writeSetting, settingUsage, settingApplied, GROUP_CMD_RE, findGroupCmd, groupIndex, GROUP_CMDS, LIST_CMD_RE, findListCmd, updateMasterList, runPluginUpdate, probeUpdateSource, resetUpdateHold, updateCheckingText, canRestartYunzai, restartYunzai, startUpdateCheck, shortSha } from '#yiyi.models'

const log = createLogger('管理')

const CHANGELOG_FILE = path.join(rootDir, 'CHANGELOG.md')

/**
 * 关掉的平台不该在帮助菜单里出现：图标名里带平台名的条目跟着开关走。
 *
 * @param {Array<object>} list 帮助分组表
 * @returns {Array<object>} 过滤后的表；空分组一并去掉
 */
function filterHelped (list) {
  return (list || []).map(g => ({
    ...g,
    list: (g.list || []).filter(item => {
      const icon = item.icon || ''
      if (icon.includes('douyin')) return Config.isEnabled('douyin')
      if (icon.includes('kuaishou')) return Config.isEnabled('kuaishou')
      if (icon.includes('bili')) return Config.isEnabled('bilibili')
      if (icon.includes('xiaohongshu')) return Config.isEnabled('xiaohongshu')
      if (icon.includes('memes')) return Config.memesEnable
      if (icon.includes('music')) return Config.musicEnable
      return true
    })
  })).filter(g => g.list.length > 0)
}

/**
 * 管理面插件：规则按「越具体越靠前」排（见文件头的顺序说明）。
 */
export class Admin extends plugin {
  constructor () {
    super({
      name: 'YIYI:管理',
      dsc: '伊伊插件帮助 / 版本 / 设置',
      event: 'message',
      priority: Config.priority,
      rule: [
        { reg: /^#?(伊伊|YIYI)(帮助|菜单|help)$/, fnc: 'help' },
        { reg: /^#?(?:(?:伊伊|YIYI)王者|王者(?:荣耀|农药)?)(?:帮助|菜单|help)$/, fnc: 'kingHelp' },
        { reg: /^#?(伊伊|YIYI)(强制更新|暴力更新|forceupdate)$/, fnc: 'forceUpdate' },
        { reg: /^#?(伊伊|YIYI)(更新|检查更新|update)$/, fnc: 'update' },
        { reg: /^#?(伊伊|YIYI)(版本|version|changelog)$/, fnc: 'ver' },
        { reg: GROUP_CMD_RE, fnc: 'settingGroup' },
        { reg: /^#?(伊伊|YIYI)(设置|配置|admin)/, fnc: 'setting' },
        { reg: LIST_CMD_RE, fnc: 'listSetting' },
        { reg: /^#?(获取|给我|我要|求|发(?:一下|下|个)?)?原图(吧|呗)?$/, fnc: 'originImg' }
      ]
    })
  }

  /**
   * `#伊伊帮助` / `#伊伊菜单`：整张帮助卡。
   *
   * @param {object} e 消息事件
   * @returns {Promise<void>} 出图后回消息；渲染失败回一句文字
   */
  async help (e) {
    try {
      const { cfg, list } = await loadHelpConfig()
      const bgSrc = await loadHelpBg()

      const ret = await render('Help/index', {
        title: cfg.title,
        subTitle: cfg.subTitle,
        itemCols: cfg.itemCols || 2,
        bgBlur: cfg.bgBlur !== false,
        bgSrc,
        version,
        pluginTitle,
        yunzai,
        helpList: filterHelped(list),
        _hl: highlightCmds
      }, { e, retMsgId: true })

      await persistBg(extractMsgId(ret), bgSrc)
    } catch (err) {
      log.error('渲染失败', err)
      return e.reply('帮助渲染失败，请查看后台日志')
    }
  }

  /**
   * `#伊伊王者帮助` / `#王者帮助`：王者那一张帮助卡（数据面同源，只是换了 cfg）。
   *
   * @param {object} e 消息事件
   * @returns {Promise<void>} 出图后回消息；渲染失败回一句文字
   */
  async kingHelp (e) {
    try {
      const { kingCfg, kingList } = await loadHelpConfig()
      const bgSrc = await loadHelpBg()

      const ret = await render('Help/index', {
        title: kingCfg.title,
        subTitle: kingCfg.subTitle,
        itemCols: kingCfg.itemCols || 2,
        bgBlur: kingCfg.bgBlur !== false,
        bgSrc,
        version,
        pluginTitle,
        yunzai,
        helpList: filterHelped(kingList),
        _hl: highlightCmds
      }, { e, retMsgId: true })

      await persistBg(extractMsgId(ret), bgSrc)
    } catch (err) {
      log.error('王者帮助渲染失败', err)
      return e.reply('王者帮助渲染失败，请查看后台日志')
    }
  }

  /**
   * `#伊伊版本`：版本号 + CHANGELOG 前几版。
   *
   * @param {object} e 消息事件
   * @returns {Promise<void>} 出图后回消息；渲染失败回一句文字
   */
  async ver (e) {
    try {
      const { cfg } = await loadHelpConfig()
      const bgSrc = await loadHelpBg()
      const changelogHtml = loadChangelog(CHANGELOG_FILE, 4)

      const ret = await render('Help/version', {
        bgSrc,
        bgBlur: cfg.bgBlur !== false,
        pluginTitle,
        version,
        yunzai,
        changelogHtml
      }, { e, retMsgId: true })

      await persistBg(extractMsgId(ret), bgSrc)
    } catch (err) {
      log.error('版本渲染失败', err)
      return e.reply('版本信息渲染失败，请查看后台日志')
    }
  }

  /**
   * `#伊伊更新`：先探环境（是不是 git 仓库、源是 GitHub 还是 Gitee），再检查上游并快进；
   * 更完只在框架给了 `Bot.restart()` 时才重启，没给就提示主人手动重启一次，绝不让进程自己退出。
   *
   * @param {object} e 消息事件
   * @returns {Promise<*>} e.reply 的结果
   */
  async update (e) {
    if (!e.isMaster) return e.reply('只有主人可以使用「#伊伊更新」哦')
    updateMasterList(e)

    const env = await probeUpdateSource()
    if (!env.ok) {
      log.warn(`「#伊伊更新」用不了：${String(env.reason).split('\n')[0]}`)
      return e.reply(env.reason)
    }

    await e.reply(updateCheckingText(env))
    const ret = await runPluginUpdate()

    /** 主人自己动手了（而且成功了）：自动更新那边的静默立刻解除，不用干等满 12 小时 */
    if (ret.ok) resetUpdateHold()

    if (!ret.ok) return e.reply(ret.blocked ? ret.reason : `更新失败：${ret.reason}`)
    if (!ret.updated) {
      const ahead = ret.ahead ? `（本地还有 ${ret.ahead} 个提交）` : ''
      return e.reply(`已经是最新版本了${ahead}`)
    }

    log.mark(`手动更新：${ret.subject || shortSha(ret.after)}`)
    const via = ret.mirror ? `\n原源拉不动，已换官方镜像：${ret.mirror}` : ''
    const willRestart = canRestartYunzai()
    await e.reply(
      `已更新 ${ret.incoming} 个提交：\n${ret.subject || ''}\n${shortSha(ret.before)} → ${shortSha(ret.after)}${via}\n${willRestart ? '重启 Yunzai 中…' : '这个框架没有重启接口（没给 Bot.restart），麻烦手动重启一次 Yunzai 让新版本生效。'}`
    )
    if (!willRestart) {
      log.warn('框架没给 Bot.restart()，不动进程，已提示主人手动重启')
      return
    }

    const how = restartYunzai()
    log.mark(`正在重启 Yunzai（${how}）`)
  }

  /**
   * `#伊伊强制更新`：不管本地改了什么，直接拿上游覆盖 —— 普通更新被本地改动挡住时的出路。
   *
   * 覆盖前把已跟踪文件的改动存成补丁（`data/update/`），盖错了能 `git apply` 找回；未跟踪的
   * `data/`、`cache/`、`config/config/` 本来就不入库，设置、登录态、绑定一个都不丢。
   *
   * @param {object} e 消息事件
   * @returns {Promise<*>} e.reply 的结果
   */
  async forceUpdate (e) {
    if (!e.isMaster) return e.reply('只有主人可以使用「#伊伊强制更新」哦')
    updateMasterList(e)

    const env = await probeUpdateSource()
    if (!env.ok) {
      log.warn(`「#伊伊强制更新」用不了：${String(env.reason).split('\n')[0]}`)
      return e.reply(env.reason)
    }

    await e.reply(`强制更新：本地改过什么、多出几个提交都不管，直接拿上游版本覆盖${env.label ? `（${env.label}）` : ''}…`)
    const ret = await runPluginUpdate({ force: true })
    resetUpdateHold()

    if (!ret.ok) return e.reply(ret.blocked ? ret.reason : `强制更新失败：${ret.reason}`)
    if (!ret.moved && !ret.discarded) return e.reply('已经是最新版本，本地也没有改动，没什么可覆盖的')

    const lines = [ret.moved ? `已覆盖到上游 ${shortSha(ret.after)}` : '代码本来就最新，只是把本地改动还原了']
    if (ret.moved && ret.subject) lines.push(ret.subject)
    if (ret.droppedCommits) lines.push(`丢掉本地提交 ${ret.droppedCommits} 个`)
    if (ret.discarded) lines.push(`还原改过的文件 ${ret.discarded} 个`)
    if (ret.patch) lines.push(`改动存了补丁（想找回就 git apply）：\n${ret.patch}`)

    log.mark(`强制更新：${shortSha(ret.before)} → ${shortSha(ret.after)}${ret.discarded ? `，还原 ${ret.discarded} 个文件` : ''}`)

    const willRestart = canRestartYunzai()
    if (!willRestart) {
      log.warn('框架没给 Bot.restart()，不动进程，已提示主人手动重启')
      return e.reply(`${lines.join('\n')}\n\n这个框架没有重启接口（没给 Bot.restart），麻烦手动重启一次 Yunzai 让新版本生效。`)
    }

    await e.reply(`${lines.join('\n')}\n\n重启 Yunzai 中…`)
    const how = restartYunzai()
    log.mark(`正在重启 Yunzai（${how}）`)
  }

  /**
   * `#伊伊设置`：只写前缀 = 入口卡；跟了项名 = 交给 applySetting。
   *
   * @param {object} e 消息事件
   * @returns {Promise<*>} 回执
   */
  async setting (e) {
    if (!e.isMaster) return e.reply('只有主人可以使用「#伊伊设置」哦')

    const rest = settingRest(e.msg)
    if (!rest) {
      await this.settingCard(e)
      return
    }

    const hit = matchSetting(rest)
    if (!hit) {
      return e.reply(`没有「${rest.split(/\s+/)[0]}」这项设置，发送「#伊伊设置」看分组、发「#伊伊基础设置」等看具体项`)
    }

    return await this.applySetting(e, hit.item, hit.value)
  }

  /**
   * `#伊伊基础设置` 这类整组命令：只出那一组的面板。
   *
   * @param {object} e 消息事件
   * @returns {Promise<*>} false = 认不出这一组，让后面的规则接着试
   */
  async settingGroup (e) {
    if (!e.isMaster) return e.reply('只有主人可以使用「#伊伊设置」哦')
    updateMasterList(e)

    const hit = GROUP_CMD_RE.exec(String(e.msg ?? ''))
    const g = hit && findGroupCmd(hit[1])
    if (!g) return false

    await this.settingCard(e, g.group)
  }

  /**
   * 带独立命令的列表项（`#伊伊禁用表情 摸头`）。
   *
   * @param {object} e 消息事件
   * @returns {Promise<*>} 回执；false = 认不出，让后面的规则接着试
   */
  async listSetting (e) {
    const hit = LIST_CMD_RE.exec(String(e.msg ?? ''))
    const item = hit && findListCmd(hit[1])
    if (!item) return false

    if (!e.isMaster) return e.reply(`只有主人可以使用「${item.cmd}」哦`)
    return await this.applySetting(e, item, hit[2].trim())
  }

  /**
   * 写值的唯一入口：只写项名 → 教用法；写坏了 → 回原因；写成了 → 发这一组的面板。
   *
   * @param {object} e 消息事件
   * @param {object} item SETTINGS 里的那一项
   * @param {string} value 用户写的值（空串代表只写了项名）
   * @returns {Promise<*>} 回执
   */
  async applySetting (e, item, value) {
    updateMasterList(e)
    if (!value) return e.reply(settingUsage(item))

    const ret = writeSetting(item, value)
    if (!ret.ok) return e.reply(ret.reason)

    const now = Array.isArray(ret.value) ? (ret.value.join('、') || '空') : ret.value
    log.mark(`修改设置 [${item.label}] ${ret.action} = ${now}`)

    if (await this.settingCard(e, item.group)) return
    return e.reply(settingApplied(item, ret.value, ret))
  }

  /**
   * 入口卡（group 为空）与分组卡共用一张模板；渲染不出来才回 false 让调用方退文字。
   *
   * @param {object} e 消息事件
   * @param {string} [group] 只要这一组；不传 = 入口卡
   * @returns {Promise<boolean>} true = 图发出去了
   */
  async settingCard (e, group) {
    try {
      const { cfg } = await loadHelpConfig()
      const bgSrc = await loadHelpBg()
      const g = group ? GROUP_CMDS.find(item => item.group === group) : null

      const ret = await render('Help/settings', {
        bgSrc,
        bgBlur: cfg.bgBlur !== false,
        pluginTitle,
        version,
        yunzai,
        title: g ? `伊伊设置 · ${g.group}` : '伊伊设置',
        index: !g,
        entries: g ? [] : groupIndex(),
        groups: settingsGroups(group),
        _hl: highlightCmds
      }, { e, retMsgId: true })

      await persistBg(extractMsgId(ret), bgSrc)
      return true
    } catch (err) {
      log.error('设置渲染失败', err)
      await e.reply('设置面板渲染失败，请查看后台日志')
      return false
    }
  }

  /**
   * 帮助卡背面的「#原图」：取那张卡当次用的背景。
   *
   * @param {object} e 消息事件
   * @returns {Promise<*>} 图片；false = 不是回我们发的卡（或已过期）
   */
  async originImg (e) {
    const srcId = extractSrcId(e)
    if (!srcId) return false

    try {
      const bgSrc = await takeCachedBg(srcId)
      if (!bgSrc) return false
      return e.reply(segment.image(bgSrc))
    } catch (err) {
      log.error('原图读取失败', err)
      return false
    }
  }
}

if (Config.pluginAutoUpdate) startUpdateCheck()
