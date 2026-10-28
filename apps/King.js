/**
 * @file 王者指令面——65 条指令全部在这里注册：正则决定「用户这么说该进哪个功能」，方法体只做「先回生成提示 → 转调」，不放任何取数与算数。
 * @module apps/King
 */
import { kingAck, dropKingAck, kingNews, kingNewsDetail, kingHeroList, kingHero, kingItem, kingPower, kingLogin, cancelKingLogin, kingUseAccount, kingDelAccount, kingCheckAccount, kingAccount, kingBindRole, kingBindHelp, kingUnbindRole, kingMyCamp, kingDiagnose, kingSwitchRole, kingHideRole, kingRestoreRole, kingBattleList, kingBattleDetail, kingRank, kingRankRefresh, kingGroupReport, kingGroupReportPush, kingGroupReportStatus, kingGroupReportTick, kingPushSwitch, kingPushStatus, kingGroupPush, kingPushTick, kingWhoIsPlaying, kingWatchSwitch, kingWatchTest, kingOps, kingOpsClearCache, kingCacheSweep, kingBootCacheSweep, kingKeepAliveTick, kingTier, kingHeroRecord, kingCompare, kingNewsPush, kingSkinPush, kingAlertTick, kingCleanInvalid, kingBackup, kingRestore, kingBlacklist, kingRankTrend, kingPeakTrend, kingSkinCodex, kingSkinMissing, kingMyHeroes, kingExportCsv, kingUserStats, kingHiddenList, kingHiddenClear, parsePeriod, kingReply, AT_HEAD, AT_TAIL } from '#yiyi.king'
import { Config } from '#yiyi.components'
import { afterLoaded } from '#yiyi.utils'

/** 65 条指令的正则表：字面写在这个文件里（闸门按文本抠 `{ reg, fnc }`，挪去别的文件会红）。
 * 构造里只 push；新增指令加在这个数组末尾（兜底那条永远最后）。 */
const RULES = [
  { reg: '^#?王者(?:荣耀|农药)?(?:扫码|登录)(?:取消|撤销)', fnc: 'cancelLogin' },
  { reg: '^#?取消(?:王者(?:荣耀|农药)?)?(?:扫码|登录)', fnc: 'cancelLogin' },
  { reg: '^#?王者(?:荣耀|农药)?[Qq][Qq](?:扫码|登录)?', fnc: 'loginQQ' },
  { reg: '^#?王者(?:荣耀|农药)?(?:微信|[VvWw][Xx])(?:扫码|登录)?', fnc: 'loginWechat' },
  { reg: '^#?王者(?:荣耀|农药)?(?:扫码|登录)?$', fnc: 'loginHelp' },
  { reg: '^#?王者(?:荣耀|农药)?切换角色\\s*\\d*', fnc: 'switchRole' },
  { reg: '^#?王者(?:荣耀|农药)?隐藏角色\\s*\\d*', fnc: 'hideRole' },
  { reg: '^#?王者(?:荣耀|农药)?恢复角色\\s*\\d*', fnc: 'restoreRole' },
  { reg: '^#?王者(?:荣耀|农药)?切换(?:账号)?', fnc: 'useAccount' },
  { reg: '^#?王者(?:荣耀|农药)?删除(?:账号)?', fnc: 'delAccount' },
  { reg: '^#?王者(?:荣耀|农药)?校验(?:账号)?', fnc: 'checkAccount' },
  { reg: '^#?王者(?:荣耀|农药)?账[号户](?:列表|池)?$', fnc: 'account' },
  { reg: '^#?王者(?:荣耀|农药)?绑定\\s*(?:说明|帮助|教程|指南)', fnc: 'bindHelp' },
  { reg: '^#?王者(?:荣耀|农药)?绑定(?!群)(?:营地|角色|营地ID|id)?\\s*\\d*', fnc: 'bindRole' },
  { reg: '^#?王者(?:荣耀|农药)?解绑(?:营地|角色)?', fnc: 'unbindRole' },
  /** 已合并 / 已下线的老指令只回一句指路：赛季数据与称号都并进了营地卡，好友列表不再做 */
  { reg: '^#?王者(?:荣耀|农药)?(?:(?:我的)?(?:营地|主页)?\\s*(?:赛季(?:表现|数据|报表|汇总)?|好友(?:列表)?)|(?:全部|所有)?(?:排位|赛季|巅峰)(?:表现|数据)(?:\\s+\\S+)*|(?:荣耀)?(?:称号墙|我的称号|荣耀称号|称号列表|称号|边框)(?:\\s+\\d+)?)$', fnc: 'retiredCard' },
  /** 签到 / 营地币 / 福利任务 / 兑换整块下线：命中了也别装没听见 */
  { reg: '^#?王者(?:荣耀|农药)?(?:自动签到|签到|营地币|金币|福利任务|福利|任务|领奖|领取奖励|领取福利|营地兑换|兑换)(?:\\s*\\S*)*$', fnc: 'retiredDaily' },
  { reg: AT_HEAD + '#?王者(?:荣耀|农药)?(?:段位|排位)(?:趋势|走势|曲线)\\s*\\S*' + AT_TAIL, fnc: 'rankTrend' },
  { reg: AT_HEAD + '#?王者(?:荣耀|农药)?巅峰(?:分)?(?:趋势|走势|曲线)\\s*\\S*' + AT_TAIL, fnc: 'peakTrend' },
  { reg: '^#?王者(?:荣耀|农药)?皮肤推送\\s*(?:开启|关闭|打开|关|开|状态)?$', fnc: 'skinPush' },
  { reg: '^#?王者(?:荣耀|农药)?公告推送\\s*(?:开启|关闭|打开|关|开|状态)?$', fnc: 'newsPush' },
  { reg: '^#?王者(?:荣耀|农药)?(?:营地)?(?:导出战绩|战绩导出)(?:\\s+\\S+)*$', fnc: 'exportCsv' },
  { reg: '^#?王者用户统计$', fnc: 'userStats' },
  { reg: '^#?王者隐藏主页名单$', fnc: 'hiddenList' },
  { reg: '^#?王者清除隐藏名单(?:\\s+\\S+)*$', fnc: 'hiddenClear' },
  { reg: '^#?王者(?:荣耀|农药)?(?:(?:我的)?皮肤(?:图鉴|墙|收藏)|我的皮肤)(?:\\s*\\S+)?$', fnc: 'skinCodex' },
  { reg: '^#?王者(?:荣耀|农药)?(?:皮肤(?:缺失|缺少)|(?:还)?(?:缺|少|差|没有)(?:什么|哪些)?(?:的)?皮肤)(?:\\s*\\S+)?$', fnc: 'skinMissing' },
  { reg: '^#?王者(?:荣耀|农药)?(?:我的|常用)英雄(?:\\s*\\d+)?$', fnc: 'myHeroes' },
  { reg: '^#?王者(?:荣耀|农药)?(?:英雄)?(?:梯度|强度)(?:榜)?\\s*\\S*$', fnc: 'tier' },
  { reg: '^#?王者(?:荣耀|农药)?(?:出装|铭文|攻略)(?:\\s*\\S+)?$', fnc: 'heroEquip' },
  { reg: '^#?王者(?:荣耀|农药)?英雄战绩(?:\\s*\\S+)?$', fnc: 'heroRecord' },
  { reg: AT_HEAD + '#?王者(?:荣耀|农药)?对比.*$', fnc: 'compare' },
  { reg: '^#?王者(?:荣耀|农药)?清理(?:失效|过期)(?:账号|登录态)?$', fnc: 'opsCleanInvalid' },
  { reg: '^#?王者(?:荣耀|农药)?备份$', fnc: 'opsBackup' },
  { reg: '^#?王者(?:荣耀|农药)?还原\\s*\\S*$', fnc: 'opsRestore' },
  { reg: '^#?王者(?:荣耀|农药)?黑名单\\s*.*$', fnc: 'blacklist' },
  { reg: AT_HEAD + '#?王者(?:荣耀|农药)?战绩(?:详情|数据|明细)\\s*\\d*', fnc: 'battleDetail' },
  { reg: '^#?王者(?:荣耀|农药)?(?:排位|巅峰)总?排名', fnc: 'rank' },
  { reg: '^#?王者(?:荣耀|农药)?排行(?:榜)?刷新', fnc: 'rankRefresh' },
  { reg: '^#?王者(?:荣耀|农药)?(?:(?:排位|巅峰)总?)?排行(?:榜)?', fnc: 'rank' },
  { reg: '^(?:#?王者(?:荣耀|农药)?[日周月]报|#?(?:王者(?:荣耀|农药)?|战绩)?群[日周月]报)$', fnc: 'groupReport' },
  { reg: '^(?:#?(?:开启|关闭)(?:王者(?:荣耀|农药)?|战绩)?(?:群)?[日周月]报推送|#?王者(?:荣耀|农药)?(?:群)?[日周月]报(?:推送)?(?:开启|关闭))$', fnc: 'groupReportPush' },
  { reg: '^#?王者(?:荣耀|农药)?(?:推送状态|群报(?:推送)?状态|群?[日周月]报推送(?:状态)?)$', fnc: 'groupReportStatus' },
  { reg: '^(?:#?(?:开启|关闭)(?:王者(?:荣耀|农药)?|战绩)?(?:战绩推送|上下线提醒)|#?王者(?:荣耀|农药)?(?:战绩推送|上下线提醒)(?:开启|关闭))$', fnc: 'pushSwitch' },
  { reg: '^#?王者(?:荣耀|农药)?战绩推送状态$', fnc: 'pushStatus' },
  { reg: '^(?:#?王者(?:荣耀|农药)?)?(?:群推送|推送总开关|群推送开关|群推送总开关)\\s*(?:一键|全部|所有)?(?:开启|关闭|打开|关|开|状态)?$', fnc: 'groupPush' },
  { reg: '^#?王者(?:荣耀|农药)?推送\\s+(?:一键|全部|所有)?(?:开启|关闭|打开|关|开|状态)$', fnc: 'groupPush' },
  { reg: '^#?(?:王者(?:荣耀|农药)?)?观战(?:开启|打开|开)$', fnc: 'watchSwitch' },
  { reg: '^#?(?:王者(?:荣耀|农药)?)?观战(?:关闭|关)$', fnc: 'watchSwitch' },
  { reg: AT_HEAD + '#?(?:王者(?:荣耀|农药)?)?观战' + AT_TAIL, fnc: 'watchTest' },
  { reg: '^#?(?:谁在(?:打游戏|打王者|玩王者|上号|排位|玩农)|王者(?:荣耀|农药)?(?:在线(?:列表|状态)?|状态)|在线列表|农批在线|在线农批)$', fnc: 'whoIsPlaying' },
  { reg: '^#?王者(?:荣耀|农药)?(?:运维|运行状态)$', fnc: 'ops' },
  { reg: '^#?王者(?:荣耀|农药)?清理缓存$', fnc: 'opsClearCache' },
  { reg: AT_HEAD + '#?王者(?:荣耀|农药)?战绩', fnc: 'battleList' },
  { reg: AT_HEAD + '#?(?:王者(?:荣耀|农药)?(?:我的)?(?:营地|主页)|我的营地|我的主页)(?:\\s*\\S*)?' + AT_TAIL, fnc: 'myCamp' },
  { reg: '^#?王者(?:荣耀|农药)?诊断$', fnc: 'diagnose' },
  { reg: '^#?王者(?:荣耀|农药)?(?:公告|资讯|新闻)(?:列表)?\\s*(?:下一页|上一页|下页|上页)$', fnc: 'news' },
  { reg: '^#?王者(?:荣耀|农药)?(?:公告|资讯|新闻)列表', fnc: 'news' },
  { reg: '^#?王者(?:荣耀|农药)?(?:公告|资讯|新闻)\\s*\\d+(?:\\s*-\\s*\\d+|\\s+\\d+)?$', fnc: 'newsDetail' },
  { reg: '^#?王者(?:荣耀|农药)?(?:公告|资讯|新闻)$', fnc: 'news' },
  { reg: '^#?王者(?:荣耀|农药)?英雄(?:列表|大全)', fnc: 'heroList' },
  { reg: '^#?王者(?:荣耀|农药)?英雄(?:\\s*\\S+(?:\\s+\\S+)*)?$', fnc: 'hero' },
  { reg: '^#?王者(?:荣耀|农药)?装备', fnc: 'item' },
  { reg: '^#?王者(?:荣耀|农药)?(?:战力|查战力)', fnc: 'power' },
  /** 兜底：认得出是王者指令、但没有一条规则接住时，别再装没听见 */
  { reg: '^#王者(?:荣耀|农药)?(?![帮菜])(?:\\s*\\S+)*$', fnc: 'unknownCommand' }
]

/**
 * 王者荣耀入口：65 条指令的正则表在文件顶层 `RULES` 里（闸门按文本抠），
 * 每个 `fnc` 方法体只把事件转给 `models/King` 对应函数，不在这里取数、不算数。
 *
 * 出图提示在这一层统一发：文件末尾给 `RULES` 里每一个 `fnc` 原位裹了一层
 * 「先排提示 → 转调原方法 → 收工撤提示」，新加指令只要进了 `RULES` 就自动带上，
 * 不用（也没法）靠每条方法自己记得写 `kingAck`——那正是以前漏发、发得晚的根源。
 */
export class King extends plugin {
  constructor () {
    super({
      name: 'YIYI:王者荣耀',
      dsc: '王者荣耀公告资讯、英雄资料（含皮肤与技能）、装备战力，以及营地账号与个人主页',
      event: 'message',
      priority: Config.priority,
      rule: RULES
    })

    this.task = [
      {
        name: 'YIYI:王者战绩推送',
        cron: Config.kingPushCron,
        log: false,
        fnc: () => kingPushTick()
      },
      {
        name: 'YIYI:王者群日报',
        cron: Config.kingGroupDailyReportCron,
        log: false,
        fnc: () => kingGroupReportTick('daily')
      },
      {
        name: 'YIYI:王者群周报',
        cron: Config.kingGroupWeeklyReportCron,
        log: false,
        fnc: () => kingGroupReportTick('weekly')
      },
      {
        name: 'YIYI:王者群月报',
        cron: Config.kingGroupMonthlyReportCron,
        log: false,
        fnc: () => kingGroupReportTick('monthly')
      },
      {
        name: 'YIYI:王者缓存清理',
        cron: Config.kingCacheSweepCron,
        log: false,
        fnc: () => kingCacheSweep()
      },
      {
        name: 'YIYI:王者登录态保活',
        cron: Config.kingKeepAliveCron,
        log: false,
        fnc: () => kingKeepAliveTick()
      },
      {
        name: 'YIYI:王者公告皮肤提醒',
        cron: Config.kingAlertCron,
        log: false,
        fnc: () => kingAlertTick()
      }
    ]
  }

  async loginQQ (e) {
    return kingLogin(e, 'qq')
  }

  async loginWechat (e) {
    return kingLogin(e, 'wechat')
  }

  async loginHelp (e) {
    return kingLogin(e, '')
  }

  async cancelLogin (e) {
    return cancelKingLogin(e)
  }

  async useAccount (e) {
    return kingUseAccount(e)
  }

  async delAccount (e) {
    return kingDelAccount(e)
  }

  async checkAccount (e) {
    return kingCheckAccount(e)
  }

  async account (e) {
    return kingAccount(e)
  }

  async bindRole (e) {
    return kingBindRole(e)
  }

  async bindHelp (e) {
    return kingBindHelp(e)
  }

  async unbindRole (e) {
    return kingUnbindRole(e)
  }

  /** 营地主页：本赛季表现已经并进这张卡，不再有子视图 */
  async myCamp (e) {
    return kingMyCamp(e)
  }

  /** 赛季表现 / 称号墙都并进营地卡了，好友列表不做：老指令回一句指路，不报错 */
  async retiredCard (e) {
    return kingReply(e, '赛季数据和荣耀称号都并进「#王者营地」那张卡了，往下翻就能看到；好友列表已经下线。皮肤图鉴发「#王者皮肤图鉴」。')
  }

  /** 签到 / 营地币 / 福利任务 / 营地兑换整块下线 */
  async retiredDaily (e) {
    return kingReply(e, '签到、营地币、福利任务、营地兑换这几项已经去掉了，不用再发。查战绩、营地（赛季汇总和荣耀称号都在这张卡里）、英雄、皮肤、排行这些都还在。')
  }

  async diagnose (e) {
    return kingDiagnose(e)
  }

  async switchRole (e) {
    return kingSwitchRole(e)
  }

  async hideRole (e) {
    return kingHideRole(e)
  }

  async restoreRole (e) {
    return kingRestoreRole(e)
  }

  async battleList (e) {
    return kingBattleList(e)
  }

  async battleDetail (e) {
    return kingBattleDetail(e)
  }

  async rank (e) {
    return kingRank(e)
  }

  async rankRefresh (e) {
    return kingRankRefresh(e)
  }

  async groupReport (e) {
    return kingGroupReport(e, parsePeriod(e.msg))
  }

  async groupReportPush (e) {
    return kingGroupReportPush(e)
  }

  async groupReportStatus (e) {
    return kingGroupReportStatus(e)
  }

  async news (e) {
    return kingNews(e)
  }

  async newsDetail (e) {
    return kingNewsDetail(e)
  }

  async heroList (e) {
    return kingHeroList(e)
  }

  async hero (e) {
    return kingHero(e)
  }

  async item (e) {
    return kingItem(e)
  }

  async power (e) {
    return kingPower(e)
  }

  async pushSwitch (e) {
    return kingPushSwitch(e)
  }

  async pushStatus (e) {
    return kingPushStatus(e)
  }

  async groupPush (e) {
    return kingGroupPush(e)
  }

  async watchSwitch (e) {
    return kingWatchSwitch(e)
  }

  /** `#观战@某人` / `#王者观战@某人`：手动跑一次取流，把卡在哪一步摊开给用户看 */
  async watchTest (e) {
    return kingWatchTest(e)
  }

  async whoIsPlaying (e) {
    return kingWhoIsPlaying(e)
  }

  async ops (e) {
    return kingOps(e)
  }

  async opsClearCache (e) {
    return kingOpsClearCache(e)
  }

  async opsCleanInvalid (e) {
    return kingCleanInvalid(e)
  }

  async opsBackup (e) {
    return kingBackup(e)
  }

  async opsRestore (e) {
    return kingRestore(e)
  }

  async blacklist (e) {
    return kingBlacklist(e)
  }

  async tier (e) {
    return kingTier(e)
  }

  /** `#王者出装 李白` 与 `#王者英雄 李白` 现在出同一张卡：技能、称号、出装铭文、皮肤都在里面 */
  async heroEquip (e) {
    return kingHero(e)
  }

  async rankTrend (e) {
    return kingRankTrend(e)
  }

  async peakTrend (e) {
    return kingPeakTrend(e)
  }

  async heroRecord (e) {
    return kingHeroRecord(e)
  }

  async skinCodex (e) {
    return kingSkinCodex(e)
  }

  async skinMissing (e) {
    return kingSkinMissing(e)
  }

  async myHeroes (e) {
    return kingMyHeroes(e)
  }

  /** 导出本地战绩归档为 CSV（只读本地，不联网） */
  async exportCsv (e) {
    return kingExportCsv(e)
  }

  /** 用户统计（主人）：绑定、授权号、推送订阅一次摊开 */
  async userStats (e) {
    return kingUserStats(e)
  }

  async hiddenList (e) {
    return kingHiddenList(e)
  }

  async hiddenClear (e) {
    return kingHiddenClear(e)
  }

  async compare (e) {
    return kingCompare(e)
  }

  async newsPush (e) {
    return kingNewsPush(e)
  }

  async skinPush (e) {
    return kingSkinPush(e)
  }

  /** 认得出是王者指令但没人接住：回一句「没这条」，别让用户以为机器人没听见 */
  async unknownCommand (e) {
    return kingReply(e, '没这条指令，发「#王者帮助」看看都有什么')
  }
}

/**
 * 给 `RULES` 里每一个 `fnc` 在原位裹一层「触发即提示」：先排那句「生成图片中」，
 * 再转调原来的方法，这条指令收工（卡片已经发出去）再把提示撤掉。
 *
 * 为什么裹在调度口而不在每条方法里手写：65 条指令里只要有一条忘了写 `kingAck`，
 * 用户发那条就得干等十几秒才看到任何回应；裹在这里，进了 `RULES` 就自动带上，
 * 新加指令也不再有机会漏。方法名不变，框架按 `rule.fnc` 取到的就是这个包装层。
 */
for (const rule of RULES) {
  const name = rule.fnc
  const orig = King.prototype[name]
  if (typeof orig !== 'function' || orig.__kingAckWrapped) continue

  const wrapped = async function (e) {
    kingAck(e).catch(() => {})
    try {
      return await orig.call(this, e)
    } finally {
      await dropKingAck(e)
    }
  }

  wrapped.__kingAckWrapped = true
  King.prototype[name] = wrapped
}

/**
 * 启动先清一遍 `cache/`（插件根目录下那份）：里面全是能再生成的东西 ——
 * 卡片内联副本存的是 `file:///` 绝对路径（换台机器、改个目录名就全废），
 * 公开表跟游戏版本走（旧表比没有更糟）。登记在 `afterLoaded()` 里，日志才落在版本横幅后面。
 */
afterLoaded(kingBootCacheSweep)
