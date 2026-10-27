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
      { icon: 'Link/douyin.png', title: '抖音链接', desc: '发抖音分享链接，自动出视频或图集' },
      { icon: 'Link/kuaishou.png', title: '快手链接', desc: '发快手分享链接，自动出视频或图集' },
      { icon: 'Link/bili.png', title: 'B站链接', desc: '发 B 站链接，自动出视频、图文或专栏' },
      { icon: 'Link/xiaohongshu.png', title: '小红书链接', desc: '发小红书链接，自动出图文或视频' }
    ]
  },
  {
    group: '点歌',
    list: [
      { icon: 'Link/music.png', title: '#点歌', desc: '发「#点歌 歌名或歌手」，出 15 首一页' },
      { icon: 'Help/listen.svg', title: '#听N', desc: '听本页第 N 首，发链接和语音（#选N 同义）' },
      { icon: 'Help/listen-next.svg', title: '#听下页', desc: '翻下一页（#听上页 回上一页）' }
    ]
  },
  {
    group: '表情包',
    list: [
      { icon: 'Memes/meme.png', title: '表情包制作', desc: '发名字就做，能带参数，如「#像素化#20」' },
      { icon: 'Help/emoji-menu.svg', title: '#表情菜单', desc: '分页看全部表情' },
      { icon: 'Help/emoji-search.svg', title: '#表情搜索 猫猫', desc: '按关键词找表情' },
      { icon: 'Help/emoji-help.svg', title: '#表情帮助', desc: '表情包怎么用' }
    ]
  },
  {
    group: '管理功能',
    list: [
      { icon: 'Help/yiyi-king-help.svg', title: '#伊伊王者帮助', desc: '王者全部功能：登录、战绩、排行、推送，运维只有主人能用；写「#王者帮助」也行' },
      { icon: 'Help/yiyi-help.svg', title: '#伊伊帮助', desc: '看这个菜单' },
      { icon: 'Help/version.svg', title: '#伊伊版本', desc: '看插件版本' },
      { icon: 'Help/settings.svg', title: '#伊伊设置', desc: '设置入口，只有主人能改' },
      { icon: 'Help/base-settings.svg', title: '#伊伊基础设置', desc: '名字、优先级、自动更新、图源、点歌接口' },
      { icon: 'Help/parse-settings.svg', title: '#伊伊解析设置', desc: '四个平台的解析开关、转发、评论截图' },
      { icon: 'Help/emoji-settings.svg', title: '#伊伊表情设置', desc: '表情开关、接口、禁用、反制、自动更新' },
      { icon: 'Help/detail-suffix.svg', title: '#伊伊详情后缀', desc: '加或删「详情」后缀，如「#伊伊详情后缀 查看」' },
      { icon: 'Help/emoji-disabled.svg', title: '#伊伊禁用表情', desc: '禁用或恢复表情，如「#伊伊禁用表情 摸头」' },
      { icon: 'Help/anti.svg', title: '#伊伊反制', desc: '主人反制开关，如「#伊伊反制开启」或「#伊伊反制关闭」，写「开 / 关」也认' },
      { icon: 'Help/anti-emoji.svg', title: '#伊伊反制表情', desc: '哪些表情才反制；清空就全反制' },
      { icon: 'Help/update.svg', title: '#伊伊更新', desc: '检查更新，只有主人能用，更完自动重启' },
      { icon: 'Help/force-update.svg', title: '#伊伊强制更新', desc: '本地改过东西也能拉：直接拿上游覆盖，覆盖前把改动存成补丁' }
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
      { icon: 'Help/scan-qq.svg', title: '#王者QQ扫码', desc: '存一个 QQ 区的号。' },
      { icon: 'Help/scan-wechat.svg', title: '#王者微信扫码', desc: '存一个微信区的号。' },
      { icon: 'Help/bind.svg', title: '#王者绑定', desc: '加上营地ID，查这个角色。' },
      { icon: 'Help/bind-help.svg', title: '#王者绑定说明', desc: '扫码和绑定各管什么。' },
      { icon: 'Help/unbind.svg', title: '#王者解绑', desc: '取消绑定。' },
      { icon: 'Help/switch-role.svg', title: '#王者切换角色', desc: '换营地卡显示的角色。' },
      { icon: 'Help/hide-role.svg', title: '#王者隐藏角色', desc: '把角色从营地卡收起来。' },
      { icon: 'Help/show-role.svg', title: '#王者恢复角色', desc: '把收起来的角色放回。' },
      { icon: 'Help/switch-account.svg', title: '#王者切换账号', desc: '换一个存的号来查。' },
      { icon: 'Help/diagnose.svg', title: '#王者诊断', desc: '营地卡查不到时，挨个号试查给你看。' }
    ]
  },
  {
    group: '战绩与排行',
    list: [
      { icon: 'Help/battle.svg', title: '#王者战绩', desc: '最近的对局，可带模式或页码。' },
      { icon: 'Help/battle-detail.svg', title: '#王者战绩详情 3', desc: '第 3 局的阵容、出装、伤害。' },
      { icon: 'Help/home.svg', title: '#王者营地', desc: '段位、巅峰、赛季数据汇总、常用英雄、荣耀称号都在这一张卡。' },
      { icon: 'Help/rank.svg', title: '#王者排行榜', desc: '本群排位榜和巅峰榜，各前十。' },
      { icon: 'Help/rank-refresh.svg', title: '#王者排行榜刷新', desc: '马上重查，不等自动更新。' },
      { icon: 'Help/online.svg', title: '#王者在线', desc: '群里谁在打王者。' },
      { icon: 'Help/watch.svg', title: '#王者观战开启 / 关闭', desc: '开关群里的观战链接。' },
      { icon: 'Help/watch-at.svg', title: '#王者观战@群友', desc: '看他的观战链接卡在哪。' },
      { icon: 'Help/skin-codex.svg', title: '#王者皮肤图鉴', desc: '皮肤海报墙，已有的亮着。' },
      { icon: 'Help/skin-missing.svg', title: '#王者缺皮肤', desc: '还差哪几款，最值钱的先列。' },
      { icon: 'Help/hero-rank.svg', title: '#王者常用英雄', desc: '常用英雄榜，带称号。' }
    ]
  },
  {
    group: '英雄与榜单',
    list: [
      { icon: 'Help/equip.svg', title: '#王者英雄 李白', desc: '技能、荣耀称号、推荐出装与铭文、皮肤海报，一张卡看全。' },
      { icon: 'Help/tier.svg', title: '#王者梯度榜', desc: '英雄强度榜，能挑分路和分段。' },
      { icon: 'Help/hero-record.svg', title: '#王者英雄战绩 李白', desc: '一个英雄的全部战绩。' },
      { icon: 'Help/compare.svg', title: '#王者对比', desc: '两个人比段位、巅峰、皮肤。' },
      { icon: 'Help/news-push.svg', title: '#王者公告推送', desc: '有新公告单独通知你。' },
      { icon: 'Help/skin-push.svg', title: '#王者皮肤推送', desc: '有新皮肤单独通知你。' },
      { icon: 'Help/task.svg', title: '#王者导出战绩', desc: '把本地存的战绩导成表格。' }
    ]
  },
  {
    group: '图鉴与资讯',
    list: [
      { icon: 'Help/news.svg', title: '#王者公告', desc: '官网最新公告。' },
      { icon: 'Help/hero-list.svg', title: '#王者英雄列表', desc: '全部英雄名单。' },
      { icon: 'Help/item.svg', title: '#王者装备', desc: '装备图鉴，也能查单件。' },
      { icon: 'Help/power.svg', title: '#王者战力', desc: '英雄在四个大区的战力。' }
    ]
  },
  {
    group: '群报与推送',
    list: [
      { icon: 'Help/daily.svg', title: '#王者日报', desc: '今天群里的战绩汇成一张卡。' },
      { icon: 'Help/daily-push.svg', title: '#王者日报推送', desc: '本群日报推送开没开。' },
      { icon: 'Help/push-status.svg', title: '#王者推送状态', desc: '日报、周报、月报开没开。' },
      { icon: 'Help/battle-push.svg', title: '#王者战绩推送开启 / 关闭', desc: '有人开局、打完、上下线时提醒你。' },
      { icon: 'Help/battle-push-status.svg', title: '#王者战绩推送状态', desc: '你的提醒开了哪些。' },
      { icon: 'Help/group-push.svg', title: '#王者群推送', desc: '本群推送总开关。' },
      { icon: 'Help/group-push-all.svg', title: '#王者群推送 一键开启', desc: '一次打开全群的推送。' }
    ]
  },
  {
    group: '运维',
    list: [
      { icon: 'Help/ops.svg', title: '#王者运维', desc: '插件运行情况，只有主人能看。' },
      { icon: 'Help/clear-cache.svg', title: '#王者清理缓存', desc: '清图片和公开数据缓存，只有主人能清。' },
      { icon: 'Help/account.svg', title: '#王者账号', desc: '你名下的角色和营地号。' },
      { icon: 'Help/clear-expired.svg', title: '#王者清理过期', desc: '删掉过期的号。' },
      { icon: 'Help/backup.svg', title: '#王者备份 / #王者还原', desc: '备份或还原王者数据。' },
      { icon: 'Help/blacklist.svg', title: '#王者黑名单 / #王者隐藏主页名单', desc: '拉黑、放出、看名单；被营地标成「隐藏主页」的号单独一条。' },
      { icon: 'Help/claim.svg', title: '#王者用户统计', desc: '绑定、授权号、订阅一次摊开。' }
    ]
  }
]
