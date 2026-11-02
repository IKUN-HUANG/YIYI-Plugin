/**
 * @file `#伊伊设置` 的一片实现：设置项表与分组卡：改一个键、加一项参数都从这张表来。
 *
 * @module models/Admin/Home/Consts
 */

/** 面板的全部设置项。
 *
 * group 决定落在哪张分组卡，path 是 config.yaml 的键路径，type 决定校验方式；
 * 带 mask 的项只报「是否配置」不亮内容，restart 的项改完需重启才生效。 */
export const SETTINGS = [
  { group: '基础', label: 'Bot 名字', alias: ['名字', '昵称', 'bot名'], path: ['name'], type: 'text', desc: '回消息时用的名字，留空就用触发 Bot 的昵称' },
  { group: '基础', label: '插件优先级', alias: ['插件优先级', '解析优先级', '优先级'], path: ['priority'], type: 'number', desc: '数值越小越优先，改动后需重启', restart: true },
  { group: '基础', label: '插件自动更新', alias: ['插件更新', '自动更新插件', '插件自动更新'], path: ['autoUpdate'], type: 'bool', desc: '常驻轮询 git 上游，一有新提交就拉取并重启（框架没给 Bot.restart 就提示手动重启；没变动就静默）' },
  { group: '基础', label: '插件更新间隔', alias: ['插件更新间隔', '插件更新频率', '更新间隔'], path: ['autoUpdateInterval'], type: 'number', min: 1, max: 1440, desc: '隔几分钟查一次上游（分钟，默认 10），改完下一次心跳就按新值算；本地改动撞上上游时私聊你一次然后静默 12 小时' },
  /** ── 功能总开关：关掉哪个，那个功能的指令正则就整块消失，消息原样让给别的插件 ── */
  { group: '基础', label: '王者功能', alias: ['王者功能', '王者开关', '王者模块', '营地功能'], path: ['enable'], file: 'king', type: 'bool', desc: '关掉后 65 条「#王者 / #营地」指令与战绩推送都停（写进 king.yaml 的 enable）' },
  { group: '基础', label: '点歌功能', alias: ['点歌功能', '点歌开关', '点歌模块'], path: ['music', 'enable'], type: 'bool', desc: '关掉后「#点歌 / #听N / #选N」直接放行给别的插件，一条都不回' },
  { group: '基础', label: '表情功能', alias: ['表情功能', '表情', '表情包功能', '表情包'], path: ['memes', 'enable'], type: 'bool', desc: '关掉后连兜底正则一起撤掉，发什么都不会被表情模块接走' },
  { group: '基础', label: '解析功能', alias: ['解析功能', '解析开关', '解析模块'], path: ['parse', 'enable'], type: 'bool', desc: '四个平台解析的总开关；单平台开关仍在「#伊伊解析设置」里，关掉后链接消息原样放行' },
  { group: '基础', label: '背景图源开关', alias: ['背景图源开关', '图源', '图片源', '背景图源'], path: ['bgSource'], type: 'bool', desc: '开启走「背景图片接口」，关闭只用本地 resources/Img/ 里的图' },
  { group: '基础', label: '背景图片接口', alias: ['背景图片接口', '背景接口', '背景API', '帮助背景接口'], path: ['helpBgApi'], type: 'text', mask: true, example: '接口地址', desc: '留空就用本地 resources/Img/ 里的图（随机挑一张）；只显示是否配置，不亮地址' },
  { group: '基础', label: '网易云 Cookie', alias: ['网易云Cookie', '网易云ck', '网抑云Cookie', '网抑云ck', '点歌ck'], path: ['music', 'cookie'], type: 'text', mask: true, maskWord: 'Cookie', example: 'MUSIC_U 的值', desc: '填 MUSIC_U 的值（或整条 Cookie）：配了才能点 VIP 歌，只显示是否配置' },
  { group: '基础', label: '网抑云点歌接口', alias: ['网抑云接口', '网抑云点歌接口', '点歌接口', '点歌API'], path: ['music', 'apiUrl'], type: 'text', mask: true, example: '服务地址', desc: 'NeteaseCloudMusicApiEnhanced 地址（只显示是否配置，不亮地址）' },

  { group: '平台解析', label: '抖音解析', alias: ['抖音', '抖音解析'], path: ['platforms', 'douyin'], type: 'bool', desc: '发送抖音链接时自动解析' },
  { group: '平台解析', label: '快手解析', alias: ['快手', '快手解析'], path: ['platforms', 'kuaishou'], type: 'bool', desc: '发送快手链接时自动解析' },
  { group: '平台解析', label: 'B站解析', alias: ['B站', 'b站', 'bili'], path: ['platforms', 'bilibili'], type: 'bool', desc: '发送B站链接时自动解析' },
  { group: '平台解析', label: '小红书解析', alias: ['小红书', '小红书解析'], path: ['platforms', 'xiaohongshu'], type: 'bool', desc: '发送小红书链接时自动解析' },
  { group: '平台解析', label: '抖音整合转发', alias: ['抖音整合', '抖音整合转发', '抖音转发'], path: ['mergeForwards', 'douyin'], type: 'bool', desc: '抖音：卡片 / 完整简介 / 音乐 / 图集或视频 / 评论卡整合成一条合并转发发出' },
  { group: '平台解析', label: '快手整合转发', alias: ['快手整合', '快手整合转发', '快手转发'], path: ['mergeForwards', 'kuaishou'], type: 'bool', desc: '快手：把这次的卡片 / 简介 / 图集或视频整合成一条合并转发发出' },
  { group: '平台解析', label: 'B站整合转发', alias: ['B站整合', 'b站整合', 'bili整合', 'B站整合转发', 'b站整合转发', 'bili整合转发'], path: ['mergeForwards', 'bilibili'], type: 'bool', desc: 'B站：把这次的卡片 / 简介 / 图集或视频 / 评论卡整合成一条合并转发发出' },
  { group: '平台解析', label: '小红书整合转发', alias: ['小红书整合', '小红书整合转发', '小红书转发'], path: ['mergeForwards', 'xiaohongshu'], type: 'bool', desc: '小红书：把这次的卡片 / 简介 / 图集或视频 / 评论卡整合成一条合并转发发出' },
  { group: '平台解析', label: '评论截图', alias: ['评论截图', '热评截图', '评论图片', '热评'], path: ['commentCard'], type: 'bool', desc: '解析成功后额外发一张热评卡片（下面是分平台开关）' },
  { group: '平台解析', label: '评论条数', alias: ['评论条数', '热评条数'], path: ['commentLimit'], type: 'number', min: 1, max: 10, desc: '热评卡片最多展示几条' },
  { group: '平台解析', label: '抖音评论', alias: ['抖音评论', '抖音评论卡', '抖音热评'], path: ['commentCards', 'douyin'], type: 'bool', desc: '抖音发评论卡片（走自建 API，不看 IP，稳定）' },
  { group: '平台解析', label: 'B站评论', alias: ['B站评论', 'B站评论卡', 'b站评论', 'b站评论卡', 'bili评论', 'bili评论卡', 'B站热评'], path: ['commentCards', 'bilibili'], type: 'bool', desc: 'B站发评论卡片（走官方 wbi 接口，不看 IP，稳定）' },
  { group: '平台解析', label: 'B站代理端口', alias: ['B站代理端口', '代理端口', 'bili端口'], path: ['biliProxyPort'], type: 'number', min: 1, max: 65535, desc: '内嵌视频代理端口，改完立刻换端口，旧端口当场放掉' },
  { group: '平台解析', label: 'B站代理主机', alias: ['B站代理主机', '代理主机', 'bili主机'], path: ['biliProxyHost'], type: 'text', desc: 'Docker 访问宿主机的地址，host 模式填 127.0.0.1' },
  { group: '平台解析', label: '视频大小阈值', alias: ['视频阈值', '阈值', '视频大小'], path: ['mbMax'], type: 'number', desc: '超过该大小只发短链（MB）' },

  { group: '表情', label: '表情优先级', alias: ['表情优先级', '表情包优先级'], path: ['memes', 'priority'], type: 'number', allowEmpty: true, emptyText: '跟随插件优先级', restart: true, desc: '表情功能的 Yunzai 优先级，数值越小越优先；与「插件优先级」相互独立，填「清空」就跟随全局，改动后需重启' },
  { group: '表情', label: '表情接口', alias: ['表情接口', '表情地址', '表情包接口'], path: ['memes', 'apiUrl'], type: 'text', mask: true, example: '服务地址', desc: 'meme-generator 服务地址（只显示是否配置，不亮地址）' },
  { group: '表情', label: '详情后缀', alias: ['详情后缀', '详情词'], path: ['memes', 'detailArgs'], type: 'list', cmd: '#伊伊详情后缀', example: '查看', desc: '「#伊伊详情后缀 查看」加一项，「#伊伊详情后缀-查看」删掉' },
  { group: '表情', label: '禁用表情', alias: ['禁用表情', '屏蔽表情'], path: ['memes', 'disabled'], type: 'list', cmd: '#伊伊禁用表情', example: '摸头', desc: '「#伊伊禁用表情 摸头」加一项，「#伊伊禁用表情-摸头」删掉，填「清空」全清' },
  { group: '表情', label: '主人反制', alias: ['主人反制', '反制'], path: ['memes', 'counter'], type: 'bool', cmd: '#伊伊反制', desc: '开着时素材里主人 QQ 的头像排在最后就提到最前面；触发者自己是主人时不反制' },
  { group: '表情', label: '反制表情', alias: ['反制表情'], path: ['memes', 'counterCodes'], type: 'list', cmd: '#伊伊反制表情', example: '摸头', desc: '只有列表里的表情才反制；填「清空」= 所有表情都反制' },
  { group: '表情', label: '自动更新', alias: ['自动更新', '表情自动更新'], path: ['memes', 'autoUpdate'], type: 'bool', desc: '每天定时清空本地表情数据并重新拉取' },
  { group: '表情', label: '更新时间', alias: ['更新时间', '自动更新时间'], path: ['memes', 'autoUpdateTime'], type: 'time', example: '02:30', desc: '每天几点自动更新（HH:MM，24 小时制）' }
]

/** 三张分组卡：别名是用户打的那个词，count 由 groupIndex 现算 */
export const GROUP_CMDS = [
  { group: '基础', alias: '基础设置', cmd: '#伊伊基础设置', desc: 'Bot 名字、插件优先级、插件自动更新与间隔、王者 / 点歌 / 表情 / 解析四个功能总开关、背景图源开关与背景图片接口、网易云 Cookie、网抑云点歌接口' },
  { group: '平台解析', alias: '解析设置', cmd: '#伊伊解析设置', desc: '四个平台解析开关、四个整合转发开关、评论截图与条数、抖音 / B站评论开关、B站代理、视频阈值' },
  { group: '表情', alias: '表情设置', cmd: '#伊伊表情设置', desc: '表情接口、表情优先级、详情后缀、禁用表情、主人反制与反制列表、自动更新与时间（表情总开关在基础设置）' }
]

/** `#伊伊基础设置` 这类整组命令；必须排在通用设置规则前面，否则会被当成项名 */
export const GROUP_CMD_RE = new RegExp(`^#?(?:伊伊|YIYI)(${GROUP_CMDS.map(g => g.alias).join('|')})$`)
