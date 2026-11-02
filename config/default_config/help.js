/**
 * @file 帮助菜单的默认数据面：标题、列数、分组条目，以及王者那一套。
 * @module config/default_config/help
 *
 * 这份是唯一事实来源 —— models/Admin/help.js 的迁移以它为准，用户那份只保留改过的文字。
 */

/**
 * 通用帮助卡的抬头与版式。
 */
export const helpCfg = {
  title: '伊伊帮助',
  subTitle: 'Yunzai-Bot & YIYI-Plugin',
  itemCols: 2,
  bgBlur: false
}

/**
 * 王者帮助卡的抬头与版式。
 */
export const kingHelpCfg = {
  title: '王者荣耀帮助',
  subTitle: 'YIYI-Plugin · 王者荣耀（营地）',
  /** 四列：王者这边指令多，两列要翻好几屏才能看全 */
  itemCols: 4,
  bgBlur: false
}

/**
 * 王者帮助的文案版本号：调大它，老装机的说明文字才会被默认表覆盖刷新。
 */
export const kingHelpRevision = 18

/**
 * 通用帮助的分组条目：icon 是 resources/Icon 下的图，title 里的指令会被染成高亮色。
 */
export const helpList = [
  {
    group: '平台解析',
    list: [
      { icon: 'Link/Douyin.png', title: '抖音链接', desc: '发抖音分享链接，自动出视频或图集' },
      { icon: 'Link/Kuaishou.png', title: '快手链接', desc: '发快手分享链接，自动出视频或图集' },
      { icon: 'Link/Bili.png', title: 'B站链接', desc: '发 B 站链接，自动出视频、图文或专栏' },
      { icon: 'Link/Xiaohongshu.png', title: '小红书链接', desc: '发小红书链接，自动出图文或视频' }
    ]
  },
  {
    group: '点歌',
    list: [
      { icon: 'Link/Music.png', title: '#点歌', desc: '发「#点歌 歌名或歌手」，出 15 首一页' },
      { icon: 'Help/Listen.svg', title: '#听N', desc: '听本页第 N 首，发链接和语音（#选N 同义）' },
      { icon: 'Help/ListenNext.svg', title: '#听下页', desc: '翻下一页（#听上页 回上一页）' }
    ]
  },
  {
    group: '表情包',
    list: [
      { icon: 'Memes/Meme.png', title: '表情包制作', desc: '发名字就做，能带参数，如「#像素化#20」' },
      { icon: 'Help/EmojiMenu.svg', title: '#表情菜单', desc: '分页看全部表情' },
      { icon: 'Help/EmojiSearch.svg', title: '#表情搜索 猫猫', desc: '按关键词找表情' },
      { icon: 'Help/EmojiHelp.svg', title: '#表情帮助', desc: '表情包怎么用' }
    ]
  },
  {
    group: '管理功能',
    list: [
      { icon: 'Help/YiyiKingHelp.svg', title: '#伊伊王者帮助', desc: '王者全部功能：登录、战绩、排行、推送，运维只有主人能用；写「#王者帮助」也行' },
      { icon: 'Help/YiyiHelp.svg', title: '#伊伊帮助', desc: '看这个菜单' },
      { icon: 'Help/Version.svg', title: '#伊伊版本', desc: '看插件版本' },
      { icon: 'Help/Settings.svg', title: '#伊伊设置', desc: '设置入口，只有主人能改' },
      { icon: 'Help/BaseSettings.svg', title: '#伊伊基础设置', desc: '名字、优先级、自动更新、图源、点歌接口' },
      { icon: 'Help/ParseSettings.svg', title: '#伊伊解析设置', desc: '四个平台的解析开关、转发、评论截图' },
      { icon: 'Help/EmojiSettings.svg', title: '#伊伊表情设置', desc: '表情开关、接口、禁用、反制、自动更新' },
      { icon: 'Help/DetailSuffix.svg', title: '#伊伊详情后缀', desc: '加或删「详情」后缀，如「#伊伊详情后缀 查看」' },
      { icon: 'Help/EmojiDisabled.svg', title: '#伊伊禁用表情', desc: '禁用或恢复表情，如「#伊伊禁用表情 摸头」' },
      { icon: 'Help/Anti.svg', title: '#伊伊反制', desc: '主人反制开关，如「#伊伊反制开启」或「#伊伊反制关闭」，写「开 / 关」也认' },
      { icon: 'Help/AntiEmoji.svg', title: '#伊伊反制表情', desc: '哪些表情才反制；清空就全反制' },
      { icon: 'Help/Update.svg', title: '#伊伊更新', desc: '检查更新，只有主人和作者能用，更完自动重启' },
      { icon: 'Help/ForceUpdate.svg', title: '#伊伊强制更新', desc: '本地改过东西也能拉：直接拿上游覆盖，覆盖前存补丁；只有主人和作者能用' }
    ]
  }
]

/**
 * 王者帮助的分组条目；迁移时按 title 与这份对齐（退役项剔除、新项补齐）。
 */
export const kingHelpList = [
  {
    group: '账号与登录',
    list: [
      { icon: 'Help/ScanQq.svg', title: '#王者QQ扫码', desc: '存一个 QQ 区的号。' },
      { icon: 'Help/ScanWechat.svg', title: '#王者微信扫码', desc: '存一个微信区的号。' },
      { icon: 'Help/Bind.svg', title: '#王者绑定', desc: '加上营地ID，查这个角色。' },
      { icon: 'Help/BindHelp.svg', title: '#王者绑定说明', desc: '扫码和绑定各管什么。' },
      { icon: 'Help/UnBind.svg', title: '#王者解绑', desc: '取消绑定。' },
      { icon: 'Help/SwitchRole.svg', title: '#王者切换角色', desc: '换营地卡显示的角色。' },
      { icon: 'Help/HideRole.svg', title: '#王者隐藏角色', desc: '把角色从营地卡收起来。' },
      { icon: 'Help/ShowRole.svg', title: '#王者恢复角色', desc: '把收起来的角色放回。' },
      { icon: 'Help/SwitchAccount.svg', title: '#王者切换账号', desc: '换一个存的号来查。' },
      { icon: 'Help/Diagnose.svg', title: '#王者诊断', desc: '营地卡查不到时，挨个号试查给你看。' }
    ]
  },
  {
    group: '战绩与排行',
    list: [
      { icon: 'Help/Battle.svg', title: '#王者战绩', desc: '最近的对局，可带模式或页码。' },
      { icon: 'Help/BattleDetail.svg', title: '#王者战绩详情 3', desc: '第 3 局的阵容、出装、伤害。' },
      { icon: 'Help/Home.svg', title: '#王者营地', desc: '段位、巅峰、赛季数据汇总、常用英雄、荣耀称号都在这一张卡。' },
      { icon: 'Help/Rank.svg', title: '#王者排行榜', desc: '本群排位榜和巅峰榜，各前十。' },
      { icon: 'Help/RankRefresh.svg', title: '#王者排行榜刷新', desc: '马上重查，不等自动更新。' },
      { icon: 'Help/Online.svg', title: '#王者在线', desc: '群里谁在打王者。' },
      { icon: 'Help/Watch.svg', title: '#王者观战开启 / 关闭', desc: '开关群里的观战链接。' },
      { icon: 'Help/WatchAt.svg', title: '#王者观战@群友', desc: '看他的观战链接卡在哪。' },
      { icon: 'Help/SkinCodex.svg', title: '#王者皮肤图鉴', desc: '皮肤海报墙，已有的亮着。' },
      { icon: 'Help/SkinMissing.svg', title: '#王者缺皮肤', desc: '还差哪几款，最值钱的先列。' },
      { icon: 'Help/HeroRank.svg', title: '#王者常用英雄', desc: '常用英雄榜，带称号。' }
    ]
  },
  {
    group: '英雄与榜单',
    list: [
      { icon: 'Help/Equip.svg', title: '#王者英雄 李白', desc: '技能、荣耀称号、推荐出装与铭文、皮肤海报，一张卡看全。' },
      { icon: 'Help/Tier.svg', title: '#王者梯度榜', desc: '英雄强度榜，能挑分路和分段。' },
      { icon: 'Help/HeroRecord.svg', title: '#王者英雄战绩 李白', desc: '一个英雄的全部战绩。' },
      { icon: 'Help/Compare.svg', title: '#王者对比', desc: '两个人比段位、巅峰、皮肤。' },
      { icon: 'Help/NewsPush.svg', title: '#王者公告推送', desc: '有新公告通知到群里（群主、群管理或主人开）。' },
      { icon: 'Help/SkinPush.svg', title: '#王者皮肤推送', desc: '上新皮肤时推到群里（只推群，不私聊个人）。' },
      { icon: 'Help/Task.svg', title: '#王者导出战绩', desc: '把本地存的战绩导成表格。' }
    ]
  },
  {
    group: '图鉴与资讯',
    list: [
      { icon: 'Help/News.svg', title: '#王者公告', desc: '官网最新公告。' },
      { icon: 'Help/HeroList.svg', title: '#王者英雄列表', desc: '全部英雄名单。' },
      { icon: 'Help/Item.svg', title: '#王者装备', desc: '装备图鉴，也能查单件。' },
      { icon: 'Help/Power.svg', title: '#王者战力', desc: '英雄在四个大区的战力。' }
    ]
  },
  {
    group: '群报与推送',
    list: [
      { icon: 'Help/Daily.svg', title: '#王者日报', desc: '今天群里的战绩汇成一张卡。' },
      { icon: 'Help/DailyPush.svg', title: '#王者日报推送', desc: '本群日报推送开没开。' },
      { icon: 'Help/PushStatus.svg', title: '#王者推送状态', desc: '日报、周报、月报开没开。' },
      { icon: 'Help/BattlePush.svg', title: '#王者战绩推送开启 / 关闭', desc: '有人开局、打完、上下线时提醒你。' },
      { icon: 'Help/BattlePushStatus.svg', title: '#王者战绩推送状态', desc: '你的提醒开了哪些。' },
      { icon: 'Help/GroupPush.svg', title: '#王者群推送', desc: '本群推送总开关。' },
      { icon: 'Help/GroupPushAll.svg', title: '#王者群推送 一键开启', desc: '一次打开全群的推送。' }
    ]
  },
  {
    group: '运维',
    list: [
      { icon: 'Help/Ops.svg', title: '#王者运维', desc: '插件运行情况，只有主人能看。' },
      { icon: 'Help/ClearCache.svg', title: '#王者清理缓存', desc: '清图片和公开数据缓存，只有主人能清。' },
      { icon: 'Help/Account.svg', title: '#王者账号', desc: '你名下的角色和营地号。' },
      { icon: 'Help/ClearExpired.svg', title: '#王者清理过期', desc: '删掉过期的号。' },
      { icon: 'Help/Backup.svg', title: '#王者备份 / #王者还原', desc: '备份或还原王者数据。' },
      { icon: 'Help/Blacklist.svg', title: '#王者黑名单 / #王者隐藏主页名单', desc: '拉黑、放出、看名单；被营地标成「隐藏主页」的号单独一条。' },
      { icon: 'Help/Claim.svg', title: '#王者用户统计', desc: '绑定、授权号、订阅一次摊开。' }
    ]
  }
]
