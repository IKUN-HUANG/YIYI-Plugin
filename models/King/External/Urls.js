/**
 * @file External模块的一片实现：外部接口地址与赛区 / 公告频道常量。
 *
 * @module models/External/Urls
 */


/**
 * 外部资料地址表（官网 + 第三方战力站）。改地址只改这里，别散落在函数体里。
 * @type {Record<string, string>}
 */
export const EXTERNAL_URLS = {
  HeroList: 'https://pvp.qq.com/web201605/js/herolist.json',
  pvpSkinList: 'https://pvp.qq.com/zlkdatasys/heroskinlist.json',
  HeroXpflby: 'https://pvp.qq.com/zlkdatasys/data_zlk_xpflby.json',
  pvpItemList: 'https://pvp.qq.com/web201605/js/item.json',
  HeroFightingCapacity: 'https://www.sapi.run/hero/select.php',
  pvpNewsList: 'https://apps.game.qq.com/cmc/cross',
  pvpNewsDetail: 'https://apps.game.qq.com/wmp/v3.1/public/searchNews.php',
  HeroDetailPage: 'https://pvp.qq.com/web201605/herodetail'
}

/**
 * 官网公告的频道号 → 中文名（文案里给用户看的那几个选项卡）。
 * @type {Record<number, string>}
 */
export const PVP_NEWS_CHANNELS = { 1762: '版本公告', 1760: '热门', 1761: '新闻', 1763: '活动', 1766: '体验服' }

/**
 * 战力榜要查的大区代码（第三方接口认的四个值），查的时候四个并行。
 * @type {string[]}
 */
export const FIGHTING_CAPACITY_REGIONS = ['aqq', 'awx', 'iqq', 'iwx']

/**
 * 大区代码 → 中文名，战力榜每一行的「安卓QQ」这类标题用它。
 * @type {Record<string, string>}
 */
export const FIGHTING_CAPACITY_REGION_NAMES = { aqq: '安卓QQ', awx: '安卓微信', iqq: '苹果QQ', iwx: '苹果微信' }
