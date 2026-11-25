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

test('营地把一整批对局都写成同一个段位名（查询时刻的），逐局名要按 roleJob 编号推回去', async () => {
  const { resolveBatchRankNames } = await load('models/King/Push/Rank.js')
  /** 真实样本：11-19 连打七局，roleJobName 全是「永恒钻石II」，roleJob 才逐局不同（倒序，最新在前） */
  const list = [
    { roleJobName: '永恒钻石II', roleJob: 14, stars: 2, gameresult: 1 },
    { roleJobName: '永恒钻石II', roleJob: 13, stars: 5, gameresult: 2 },
    { roleJobName: '永恒钻石II', roleJob: 13, stars: 4, gameresult: 1 },
    { roleJobName: '永恒钻石II', roleJob: 13, stars: 1, gameresult: 1 },
    { roleJobName: '永恒钻石II', roleJob: 21, stars: 4, gameresult: 1 },
    { roleJobName: '永恒钻石II', roleJob: 21, stars: 1, gameresult: 1 },
    { roleJobName: '永恒钻石II', roleJob: 20, stars: 3, gameresult: 1 }
  ]
  const names = resolveBatchRankNames(list)
  assert.equal(names[0], '永恒钻石II', '最新一局的名字是查询时刻的，可信')
  assert.equal(names[1], '永恒钻石III', '编号 14 → 13 退一档小段：钻石II 往回是钻石III')
  assert.equal(names[3], '永恒钻石III', '编号没变就是同一小段，照抄上一个名字')
  assert.equal(names[4], '', '编号 13 → 21 大跳又不在端点，推不出来就留空，交给原来的保守文案')
  assert.equal(names.length, list.length, '一条都不许少')

  /** 跨大段停在端点才能推：星耀 V 往回是钻石 I */
  const across = resolveBatchRankNames([
    { roleJobName: '至尊星耀V', roleJob: 22, stars: 0 },
    { roleJobName: '至尊星耀V', roleJob: 15, stars: 4 }
  ])
  assert.equal(across[1], '永恒钻石I', '较新那局停在「星耀 V」端点，往回就是上一大段的 I')
})

test('升王者那局名字会慢一拍：赢了、名字没变、星数变小、编号已经是 16 → 名字改成最强王者', async () => {
  const { resolveBattleRankName } = await load('models/King/Push/Rank.js')
  const item = { roleJobName: '至尊星耀I', roleJob: 16, stars: 3, gameresult: 1 }
  const prev = { roleJobName: '至尊星耀I', stars: 5, gameresult: 1 }
  assert.equal(resolveBattleRankName(item, prev), '最强王者', '这是升王者那一局')
  assert.equal(resolveBattleRankName({ ...item, gameresult: 2 }, prev), '至尊星耀I', '输了就不是升段')
  assert.equal(resolveBattleRankName(item, null), '至尊星耀I', '没有前一场就不猜')
  assert.equal(resolveBattleRankName({ ...item, roleJob: 25 }, prev), '至尊星耀I', '编号没到 16 不算王者')
})

test('跨段的方向只看这一局胜负：升段后接着赢、终点星数反而更大，也不能播成掉段', async () => {
  const { formatScoreDelta } = await load('models/King/Push/Rows.js')
  /** 2026-10 上游实测那组：星耀I 3星 → 王者 4星，星数变大了，但这是升段 */
  const up = formatScoreDelta(
    { roleJobName: '最强王者', roleJob: 16, stars: 4, gameresult: 1 },
    { roleJobName: '至尊星耀I', roleJob: 26, stars: 3, gameresult: 1 }
  )
  assert.equal(up.tone, 'up', '这是升段')
  assert.equal(up.text, '段位 至尊星耀I → 最强王者（4 星）', '两边段位都要写全')

  /** 营地把名字停在星耀 I 没刷新时，也得判成升王者 */
  const stale = formatScoreDelta(
    { roleJobName: '至尊星耀I', roleJob: 16, stars: 4, gameresult: 1 },
    { roleJobName: '至尊星耀I', roleJob: 26, stars: 3, gameresult: 1 }
  )
  assert.equal(stale.tone, 'up')
  assert.equal(stale.text, '段位 至尊星耀I → 最强王者（4 星）')

  const down = formatScoreDelta(
    { roleJobName: '至尊星耀V', roleJob: 22, stars: 4, gameresult: 2 },
    { roleJobName: '最强王者', roleJob: 16, stars: 0, gameresult: 2 }
  )
  assert.equal(down.tone, 'down', '掉出王者就是掉段')
  assert.equal(down.text, '段位 最强王者 → 至尊星耀V（4 星）')
})

test('同一大段里换小段：星数不可比，改报两边小段名', async () => {
  const { formatScoreDelta } = await load('models/King/Push/Rows.js')
  const out = formatScoreDelta(
    { roleJobName: '永恒钻石II', roleJob: 14, stars: 2, gameresult: 1 },
    { roleJobName: '永恒钻石II', roleJob: 13, stars: 4, gameresult: 1 }
  )
  assert.equal(out.tone, 'up')
  assert.equal(out.text, '段位 永恒钻石III → 永恒钻石II（2 星）', '小段变了就不许拿星数相减')

  /** 同一小段、星数自相矛盾（赢了却少了 3 星）时仍旧只报现状 */
  const flat = formatScoreDelta(
    { roleJobName: '永恒钻石II', roleJob: 13, stars: 2, gameresult: 1 },
    { roleJobName: '永恒钻石II', roleJob: 13, stars: 5, gameresult: 2 }
  )
  assert.equal(flat.tone, 'flat')
  assert.equal(flat.text, '永恒钻石II 2 星')
})

test('常用英雄主表改走生涯全量表（/game/itempage/herolist），h5 那份只在它取不到时兜底', async () => {
  const src = read('models/King/Codex/Heroes.js')
  assert.match(src, /getCareerHeroList\(\{ targetUserId: campIdOf\(ctx\), roleId \}/, '先把生涯全量表拿出来')
  assert.match(src, /const career = code && classifyBusinessCode\(code\) !== BUSINESS_CODE\.SUCCESS/, '业务码非 0 不当成「空列表」')
  assert.match(src, /if \(career\) return \{ played: career\.played, ownCount: career\.ownCount, scope: 'all' \}/, '拿到就是全量，口径与 h5 一致')
  assert.match(src, /生涯英雄表没给出行（业务码/, '没给数据时说清楚为什么改道')
  assert.match(src, /const code = Number\(answer\?\.code\)\n    if \(code && classifyBusinessCode\(code\) === BUSINESS_CODE\.PROFILE_HIDDEN\)/, '被藏就直接报，不许绕去别的接口拿半份假数据')
  assert.match(src, /winNum \+ failNum !== playNum/, '胜场 + 负场 必须等于总场，不然整份作废')
  assert.match(src, /roleIdOfShareUrl\(hero\?\.frequencyHeroUrl\)/, '这个接口会忽略 roleId 回登录号自己的角色，要按链接里的 roleId 核对')

  const api = read('models/King/Api/Profile.js')
  assert.match(api, /export async function getCareerHeroList/, '端点包一层，别到处抄路径')
  assert.match(api, /targetUserId: toText\(targetUserId\)/, '主站接口要带 targetUserId')
})

test('编号对照表：编号 + 星数就能给出段位名，推断条目只排高低不起名', async () => {
  const { rankNameOfJob, resolveBatchRankNames } = await load('models/King/Push/Rank.js')
  assert.equal(rankNameOfJob(16, 3), '最强王者')
  assert.equal(rankNameOfJob(16, 9), '最强王者')
  assert.equal(rankNameOfJob(16, 10), '非凡王者', '每 10 星换一档称号')
  assert.equal(rankNameOfJob(16, 46), '至圣王者')
  assert.equal(rankNameOfJob(16, 50), '荣耀王者')
  assert.equal(rankNameOfJob('26', 4), '至尊星耀I')
  assert.equal(rankNameOfJob('22', 3), '至尊星耀V')
  assert.equal(rankNameOfJob('21', 4), '', '钻石那几个编号是推断的，不拿来起名')
  assert.equal(rankNameOfJob('999', 4), '')

  /** 一批里名字全是「非凡王者」（查询那一刻的快照），逐局要按编号纠正 */
  const list = [
    { roleJob: 16, roleJobName: '非凡王者', stars: 10, gameresult: 1 },
    { roleJob: 16, roleJobName: '非凡王者', stars: 8, gameresult: 1 },
    { roleJob: 16, roleJobName: '非凡王者', stars: 6, gameresult: 1 }
  ]
  assert.deepEqual(resolveBatchRankNames(list), ['非凡王者', '最强王者', '最强王者'])
})

test('同一场对局只出一张图：没被选中的同场人不作废，先候着', async () => {
  const { planDetailSends } = await load('models/King/Push/Detail.js')
  const row = (seq, grade) => ({ gameSeq: seq, tries: 0, index: 1, gradeGame: grade, item: { gameSeq: seq, gradeGame: grade } })
  const queued = [
    { qq: '1', campId: '10', details: [row('s1', 11.3)] },
    { qq: '2', campId: '20', details: [row('s1', 6.3), row('s2', 9.9)] }
  ]
  const { pick, skip, hold } = planDetailSends(queued, { now: 0, seen: new Map(), canSend: () => true })
  assert.deepEqual([...pick].sort(), ['0:0', '1:1'], '两个 gameSeq 各挑一位')
  assert.deepEqual([...hold], ['1:0'], '同场评分低的先候着，不许直接作废')
  assert.equal(skip.size, 0, '没有该直接放弃的')
})

test('主体这一场营地不给看时当场换人：同一轮里让同场的其他人出图', async () => {
  /** 推送循环会打日志（换人、放弃都要留痕），单测里给一个静音桩，别为了日志给生产代码加开关 */
  globalThis.logger ??= { info () {}, mark () {}, warn () {}, error () {} }
  const { flushPushQueue } = await load('models/King/Push/Detail.js')
  const row = (seq, grade) => ({ gameSeq: seq, tries: 0, index: 1, gradeGame: grade, item: { gameSeq: seq, gradeGame: grade } })
  const queued = [
    { qq: '1', campId: '10', sub: {}, patch: { pendingDetail: [] }, details: [row('s1', 11.3)] },
    { qq: '2', campId: '20', sub: {}, patch: { pendingDetail: [] }, details: [row('s1', 6.3)] }
  ]
  const data = { pushList: { 1: { campId: '10' }, 2: { campId: '20' } } }
  const tried = []
  const card = await flushPushQueue('99', queued, {
    data,
    sendCard: async () => true,
    sendDetail: async (groupId, campId) => {
      tried.push(campId)
      return campId === '10' ? { sent: false, dead: true, reason: 'hidden' } : { sent: true, dead: false, reason: '' }
    },
    save: () => {},
    sleep: async () => {},
    now: 0
  })
  assert.deepEqual(tried, ['10', '20'], '主体判死后紧接着试同场的下一位')
  assert.equal(card.imaged, 1, '这一场照样出了一张图')
  assert.equal(card.dropped, 1, '被藏的那一位要记一笔，别悄悄吞掉')
  assert.equal(data.pushList['1'].pendingDetail.length, 0, '被判死的这一位不再重试')
  assert.equal(data.pushList['2'].pendingDetail.length, 0, '出了图的那一位不用再留')
})

test('到期提醒只发到真正有他的群，并且每条之间按 500 毫秒隔开', async () => {
  const { sharedGroupIdsOf, notifyExpiringLogins, expireNoticeText, EXPIRE_NOTICE_GAP_MS } = await load('models/King/Account/Expiry.js')
  assert.equal(EXPIRE_NOTICE_GAP_MS, 500, '间隔写死在 500 毫秒')

  const group = (id, members) => ({
    group_id: id,
    /** 成员列表里没有这个人：`pickMember` 那种「没这个人也造一个」的接口一律不认 */
    pickMember: () => ({ user_id: '3084126527' }),
    getMemberMap: async () => new Map(members.map(qq => [qq, { user_id: qq }]))
  })
  const groups = [group('10001', ['3084126527', '1']), group('10002', ['2']), group('10003', ['3084126527'])]

  assert.deepEqual(await sharedGroupIdsOf('3084126527', groups), ['10001', '10003'], '只认成员列表里确切有的那两个群')

  const now = Date.parse('2026-11-25T08:00:00.000Z')
  const account = { id: '462084368', ownerId: '3084126527', loginExpireAt: '2026-11-27T08:00:00.000Z' }
  const text = expireNoticeText(account, now)
  assert.match(text, /462084368/)
  assert.match(text, /还有 2 天到期/)
  assert.match(text, /#王者QQ扫码/)

  const sent = []
  const marked = []
  const out = await notifyExpiringLogins({
    now,
    gap: 0,
    groups,
    accounts: [account],
    send: async (groupId, qq) => { sent.push(`${groupId}:${qq}`); return true },
    mark: (id, patch) => { marked.push({ id, patch }); return { ok: true } }
  })
  assert.deepEqual(sent, ['10001:3084126527', '10003:3084126527'], '两个共同群各发一条，非成员群不碰')
  assert.equal(out.sent, 2)
  assert.equal(out.failed, 0)
  assert.equal(marked.length, 1, '发出去了才记账，一天不会重复提醒')
  assert.equal(marked[0].id, '462084368')
})

test('一个群都没发成时不记账，下一轮还会再试', async () => {
  const { notifyExpiringLogins } = await load('models/King/Account/Expiry.js')
  const now = Date.parse('2026-11-25T08:00:00.000Z')
  const account = { id: '462084368', ownerId: '3084126527', loginExpireAt: '2026-11-27T08:00:00.000Z' }
  let marked = 0
  const out = await notifyExpiringLogins({
    now,
    gap: 0,
    groups: [{ group_id: '10001', getMemberMap: async () => new Map([['3084126527', {}]]) }],
    accounts: [account],
    send: async () => false,
    mark: () => { marked += 1; return { ok: true } }
  })
  assert.equal(out.sent, 0)
  assert.equal(out.failed, 1)
  assert.equal(marked, 0, '一条都没发成，别记账')
})

test('扫码换回来的有效期存进 loginExpireAt，没给有效期的平台留空', async () => {
  const { buildAccountFromLogin } = await load('models/King/Login/Device.js')
  const now = Date.now()
  const qq = buildAccountFromLogin({ userId: '462084368', token: 't', userKey: 'k' }, 'qq', 2592000)
  const at = Date.parse(qq.loginExpireAt)
  assert.ok(Number.isFinite(at), 'QQ 这条要存到期时间')
  assert.ok(at > now + 29 * 86400000 && at < now + 31 * 86400000, '30 天有效期算得对')
  assert.equal(buildAccountFromLogin({ userId: '1', token: 't' }, 'wechat').loginExpireAt, '', '微信那边没给有效期就别瞎编')
})
