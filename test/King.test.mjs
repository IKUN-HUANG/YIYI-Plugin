/**
 * @file 王者素材与常用英雄卡的自检。
 *
 * 只查「契约」：目录划分、素材文件在某处、映射函数的输出、模板与样式的关键结构。
 * 具体怎么排版是设计师的事，这里不锁像素。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { PLUGIN, read, exists, load } from './Harness.mjs'

const KING_ICON = path.join(PLUGIN, 'resources', 'Icon', 'King')

test('素材按类型分在 12 个目录里，没有散落在根上的文件', () => {
  const expected = ['Branch', 'Brand', 'Equip', 'Hero', 'HeroSkill', 'Honor', 'Medal', 'Meta', 'Peak', 'Proficiency', 'Rank', 'Summoner']
  const actual = fs.readdirSync(KING_ICON, { withFileTypes: true })
  const dirs = actual.filter(e => e.isDirectory()).map(e => e.name).sort()
  const files = actual.filter(e => e.isFile()).map(e => e.name)
  assert.deepEqual(dirs, [...expected].sort(), '子目录清单不对')
  assert.deepEqual(files, [], 'Icon/King 根上不该有裸文件')
})

test('称号五档都指向本地徽章，1 国服 / 2 小国 / 3 省 / 4 市 / 5 区', async () => {
  const { HONOR_TIER_ICONS } = await load('models/King/Codex/Consts.js')
  const want = {
    country: 'Honor/ShareRank1.webp',
    smallCountry: 'Honor/ShareRank2.webp',
    province: 'Honor/ShareRank3.webp',
    city: 'Honor/ShareRank4.webp',
    county: 'Honor/ShareRank5.webp'
  }
  for (const [tier, file] of Object.entries(want)) {
    assert.equal(HONOR_TIER_ICONS[tier], file, `${tier} 档的图标不对`)
    assert.ok(exists('resources', 'Icon', 'King', file), `${file} 不存在`)
  }
})

test('熟练度 1-8 有图有名字，图标路径按 PascalCase 落在 Proficiency/', async () => {
  const { SKILLED_NAME, SKILLED_ICON } = await load('models/King/Codex/Consts.js')
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8].map(n => SKILLED_NAME[n]),
    ['见习', '资深', '精英', '宗师', '超凡', '巅峰', '传说', '神话']
  )
  assert.equal(SKILLED_ICON(3), 'Proficiency/Lv3.webp')
  assert.equal(SKILLED_ICON(0), '', '没有等级不该给图')
  assert.equal(SKILLED_ICON(9), '', '超出 8 级不该给图')
  for (let n = 1; n <= 8; n++) assert.ok(exists('resources', 'Icon', 'King', 'Proficiency', `Lv${n}.webp`), `Lv${n}.webp 不存在`)
})

test('常用英雄表头：战力金色，其余跟胜率同一个蓝', () => {
  const css = read('resources', 'King', 'King.css')
  const headBlock = css.slice(css.indexOf('.k-myhero-row.is-head .k-myhero-no,'))
  const head = headBlock.slice(0, headBlock.indexOf('\n}'))
  for (const cls of ['no', 'tag', 'skill', 'play', 'rate', 'honor']) {
    assert.ok(head.includes(`.k-myhero-${cls}`), `表头少了 .k-myhero-${cls}`)
  }
  assert.match(head, /color:\s*#4467a0/i, '表头其余格应该是胜率那个蓝')
  const powerAt = css.lastIndexOf('.k-myhero-row.is-head .k-myhero-power')
  const power = css.slice(powerAt, css.indexOf('\n}', powerAt))
  assert.match(power, /--k-gold-ink-deep/, '表头战力应该是金色')
  assert.match(power, /text-shadow:\s*none/, '表头战力不该带数据行那层阴影')
})

test('熟练度那一格渲染成「图标 + 名称」，图标在前', () => {
  const tpl = read('resources', 'King', 'MyHeroes.html')
  const cell = tpl.slice(tpl.indexOf('k-myhero-skill'))
  assert.match(cell, /k-myhero-skill-icon/, '数据行要有图标')
  assert.ok(cell.indexOf('k-myhero-skill-icon') < cell.indexOf('k-myhero-skill-text'), '图标要在名称前面')
  assert.match(read('resources', 'King', 'King.css'), /\.k-myhero-skill-icon\s*\{[^}]*object-fit:\s*contain/)
})

test('代码里点名的模板都真的存在', async () => {
  const { execSync } = await import('node:child_process')
  const src = execSync('grep -rhoE "(renderKing\\(e, |cardImage\\(e, )\'[A-Za-z]+" apps models components utils || true', {
    cwd: PLUGIN,
    shell: '/bin/bash',
    encoding: 'utf8'
  })
  const names = new Set([...src.matchAll(/'([A-Za-z]+)/g)].map(m => m[1]))
  assert.ok(names.size >= 10, `只找到 ${names.size} 个模板名，正则没匹配上？`)
  for (const name of names) assert.ok(exists('resources', 'King', `${name}.html`), `${name}.html 不存在`)
})

test('模板里不许用 art-template 的 include（宿主渲染器不认）', () => {
  const dir = path.join(PLUGIN, 'resources', 'King')
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.html'))) {
    assert.ok(!read('resources', 'King', file).includes('{{include'), `${file} 里不该用 include`)
  }
})

test('表单主机的 -32002 操作太频繁算频控：只短退避，不按小时停号', async () => {
  const { classifyBusinessCode, BUSINESS_CODE } = await load('models/King/Common.js')
  assert.equal(classifyBusinessCode(-32002), BUSINESS_CODE.RATE_LIMITED, '-32002 与 -30107 是同一个意思')
  const { decideGame } = await load('models/King/Api/Fallback.js')
  const decision = decideGame({ code: -32002, returnMsg: '操作太频繁' }, { id: '363138606' })
  assert.equal(decision.action, 'rate-limit')
  assert.equal(decision.persist, false, '这类限流几分钟就松，停满 12 小时会把能查的时间一起停掉')
  assert.match(decision.error.message, /-32002/)
})

test('常用英雄拿到非 0 业务码就报真原因，不再一律说「去开陌生人可见」', () => {
  const src = read('models', 'King', 'Codex', 'Heroes.js')
  assert.match(src, /classifyBusinessCode\(code\) !== BUSINESS_CODE\.SUCCESS/, '非 0 业务码要往上抛')
  assert.match(src, /error\.code = code/, '把码挂在错误上，isHiddenError 之类的判据才认得')
  const fallback = read('models', 'King', 'Api', 'Fallback.js')
  assert.match(fallback, /persist === false/, '短退避的频控不该走 markRateLimited')
  assert.match(fallback, /busyUntil\.set/, '要记住退避到什么时候，别一直撞')
})

test('常用英雄被限流就退回主页生涯前 5：主表仍优先，被藏/登录态失效照旧往上抛', () => {
  const src = read('models', 'King', 'Codex', 'Heroes.js')
  assert.match(src, /getProfileHeroList\(\{ targetUserId: campIdOf\(ctx\)/, '限流时要打主页英雄列表')
  assert.match(src, /error instanceof RateLimitError/, '-32002 这类限流才兜底')
  assert.match(src, /if \(!throttled\) throw error/, '被藏（-10107）与登录态失效（-30107）不许用假数据盖掉')
  assert.match(src, /const basic = item\?\.basicInfo/, '主页接口的行裹在 basicInfo 里，要摊平')
  assert.match(src, /scope: 'career'/, '要标出这次是生涯前 5，卡片文案才分得清')
  const flow = read('models', 'King', 'Codex', 'Flows.js')
  assert.match(flow, /loaded\.scope === 'career'/, '卡片说明要跟着换')
})

test('营地给的对局段位名是「查那一下时」的：星数超大段上限一律按王者算，否则会拼出「星耀II 50星」', async () => {
  const { RankBandOfStars } = await load('models/King/Trend.js')
  const king = RankBandOfStars('至尊星耀II', 50)
  assert.equal(king.name, '王者', '星耀单档最多 5 颗星，50 星只可能是王者')
  assert.equal(king.fixed, true)
  assert.equal(RankBandOfStars('至尊星耀II', 5).jobShort, '星耀II', '没超上限就照原样，小段位要带出来')
  assert.equal(RankBandOfStars('最强王者', 52).jobShort, '王者')
  assert.equal(RankBandOfStars('永恒钻石III', 4).jobShort, '钻石III')
})

test('最近 30 把全画出来：上赛季的王者 50 星按王者标注，不许串成「星耀II 50星」', async () => {
  const { campRankTrendOf } = await load('models/King/Gallery/Trend.js')
  const list = [
    { dtEventTime: 3000, roleJobName: '至尊星耀II', stars: 2 },
    { dtEventTime: 2000, roleJobName: '至尊星耀II', stars: 4 },
    { dtEventTime: 1000, roleJobName: '至尊星耀II', stars: 50 }
  ]
  const points = campRankTrendOf(list)
  assert.deepEqual(points.map(item => item.stars), [50, 4, 2], '一条都不许切掉，最近 30 把全画')
  assert.deepEqual(points.map(item => item.jobShort), ['王者', '星耀II', '星耀II'], '50 星那局是王者，名字要跟着改判')
  assert.equal(points[0].jobName, '王者', 'jobName 也换掉，拼「最高 X 星」时才不会又串回星耀')
})
