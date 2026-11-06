/**
 * @file 表情包的「别抢别人指令」自检。
 *
 * 关掉功能时规则表必须直接空掉（宿主拿不到规则就不会拦截），
 * 开着时也要把点歌/王者/设置这类别家指令排除在表情识别之外；
 * 反过来，数据里的关键词**裸词**就得能触发，不许在出口让给别人的规则。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { read, exists, load, PLUGIN, ROOT } from './Harness.mjs'

test('别家指令不当表情', async () => {
  const { lookupMeme } = await load('models/Memes/Lookup.js')
  const others = ['#点歌 晴天', '点歌告白气球', '#听1', '#选2', '#听下页', '#选上一页', '#伊伊设置', '#王者战绩', '#王者在线']
  for (const msg of others) assert.equal(lookupMeme(msg), null, `「${msg}」被当成了表情`)
})

test('功能开关是热的：三个模块都把 rule 交给 gateRules 管', () => {
  assert.match(read('apps', 'Memes.js'), /gateRules\(this, \(\) => this\.memeOn\)/)
  assert.match(read('apps', 'Music.js'), /gateRules\(this, \(\) => Config\.musicEnable\)/)
  assert.match(read('apps', 'King.js'), /gateRules\(this, \(\) => Config\.kingEnable\)/)
  for (const app of ['Bilibili', 'Douyin', 'Kuaishou', 'Xiaohongshu']) {
    assert.match(read('apps', `${app}.js`), /gateRules\(this, \(\) => Config\.parseEnable && Config\.isEnabled\('/, `${app} 没接解析总开关`)
  }
})

test('王者定时任务到点也看开关，不只看出图指令', () => {
  const src = read('apps', 'King.js')
  assert.match(src, /const guard = fnc => async \(\.\.\.args\) => \(Config\.kingEnable \? fnc\(\.\.\.args\) : undefined\)/)
  assert.match(src, /\.map\(task => \(\{ \.\.\.task, fnc: guard\(task\.fnc\) \}\)\)/)
})

test('别家点歌插件的写法也认成指令，不当表情', async () => {
  const { OTHER_CMD_RE } = await load('models/Memes/Lookup.js')
  const cmds = ['点歌 普泊', '#点歌', '#QQ点歌 晴天', '#网易点歌晴天', '#来首歌', '#点播 稻香',
    '#播放', '#听歌', '#日推', '#我的收藏', '#下一页', '#上一首']
  for (const msg of cmds) assert.ok(OTHER_CMD_RE.test(msg), `「${msg}」没被当成别家指令`)
  for (const msg of ['摸鱼', '#摸头', '#随机表情', '#表情菜单']) {
    assert.ok(!OTHER_CMD_RE.test(msg), `「${msg}」被误判成别家指令`)
  }
})

test('别家插件也认这条消息，也不许把表情关键词让出去', () => {
  /**
   * 「认领让出」曾经在出口把消息交还给别的插件：用户发裸的「摸头」被交出去、
   * 加个 `#` 反而能出图。关键词驱动已经解决了抢指令（`OTHER_CMD_RE` 过滤 + 规则只认关键词），
   * 出口再让一次只会让裸词永远打不过别人的通用规则 —— 所以这条路必须没有。
   */
  const src = read('apps', 'Memes.js')
  assert.ok(!src.includes('claimedByOthers'), 'apps/Memes.js 里不许再向宿主询问「别人认不认这条」')
  assert.ok(!exists('models', 'Memes', 'Claim.js'), 'models/Memes/Claim.js 该删就删，不留死代码')
  assert.ok(!read('models', 'Memes.js').includes('Claim.js'), 'models/Memes.js 不该再导出认领判定')
})

test('最后一条是数据关键词规则，不是「什么短句都收」的兜底', () => {
  const src = read('apps', 'Memes.js')
  assert.ok(!src.includes("reg: /^#?(\\S{1,60})"), 'apps/Memes.js 里不许再有「1~60 字都算表情」的兜底正则')
  assert.match(src, /const memeRule = \{ reg: memeMatchReg\(\), fnc: 'meme' \}/)
  assert.ok(src.indexOf('memeRule') < src.indexOf("fnc: 'meme'") + 200)
  assert.match(read('models', 'Memes', 'Lookup.js'), /export function memeMatchReg/)
})

test('数据里的关键词决定规则，换一份数据规则跟着换', () => {
  /**
   * 关键词表是运行期数据（`data/Memes/keyMap.json`，插件仓里没有），
   * 所以现造一份最小数据：另开进程、把 `YIYI_DATA_DIR` 指过去，
   * 既避开进程内已缓存的空索引，也不依赖跑测试的机器上有没有真数据。
   */
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'yiyi-memes-'))
  fs.mkdirSync(path.join(sandbox, 'Memes'), { recursive: true })
  fs.writeFileSync(path.join(sandbox, 'Memes', 'keyMap.json'), JSON.stringify({ 摸头: 'petpet', 摸鱼: 'slacking_off', '5000兆': '5000choyen', 点歌: 'music' }))
  fs.writeFileSync(path.join(sandbox, 'Memes', 'infos.json'), JSON.stringify({
    petpet: { keywords: ['摸头'], params_type: { min_images: 1, max_images: 1 } },
    slacking_off: { keywords: ['摸鱼'], params_type: {} },
    '5000choyen': { keywords: ['5000兆'], params_type: { min_texts: 2, max_texts: 2 } },
    music: { keywords: ['点歌'], params_type: {} }
  }))
  const script = `
    const { memeMatchReg, lookupMeme } = await import(${JSON.stringify('file://' + PLUGIN + '/models/Memes/Lookup.js')})
    const re = memeMatchReg()
    /** 三类参数形状各取一个：要头像图 / 不要图 / 要文字 */
    const kinds = { petpet: '摸头', slacking_off: '摸鱼', '5000choyen': '5000兆' }
    const bare = {}
    for (const [code, kw] of Object.entries(kinds)) {
      bare[code] = {
        rule: re.test(kw),
        hash: re.test('#' + kw),
        look: lookupMeme(kw)?.code ?? null,
        lookHash: lookupMeme('#' + kw)?.code ?? null
      }
    }
    process.stdout.write(JSON.stringify({
      isRegExp: re instanceof RegExp,
      source: re.source,
      hit: re.test('#摸头'),
      hitBare: re.test('摸鱼'),
      bare,
      missCmd: re.test('#点歌 晴天'),
      missWord: re.test('#随便一句并不存在的话'),
      noSteal: ['摸头发', '摸头党', '打工人你好', '#听歌 晴天'].map(msg => re.test(msg)),
      glue: { rule: re.test('摸头114514'), look: lookupMeme('摸头114514')?.qqs ?? null }
    }))
  `
  try {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, YIYI_DATA_DIR: sandbox },
      encoding: 'utf8'
    })
    const { isRegExp, source, hit, hitBare, bare, missCmd, missWord, noSteal, glue } = JSON.parse(out)
    assert.ok(isRegExp)
    assert.ok(hit, '数据里的关键词必须能命中')
    assert.ok(hitBare, '不带 # 的关键词也要命中')
    for (const [code, got] of Object.entries(bare)) {
      assert.ok(got.rule, `裸词「${got.look ?? code}」没被规则接住`)
      assert.ok(got.hash, `带 # 的写法也要接住：${code}`)
      assert.equal(got.look, code, `裸词没查到这个表情：${code}`)
      assert.equal(got.lookHash, code, `带 # 的写法没查到这个表情：${code}`)
    }
    assert.ok(!missCmd, '别家指令不该被表情的规则接走')
    assert.ok(!missWord, '不在关键词表里的短句不该命中')
    assert.ok(noSteal.every(v => !v), `只是拿关键词开头的人话不该被规则接走：${JSON.stringify(noSteal)}`)
    assert.ok(glue.rule, '关键词后面连写 QQ 号仍然要接住')
    assert.deepEqual(glue.look, ['114514'], '连写的 QQ 号要摘出来')
    assert.ok(!source.includes('点歌'), '与别家指令重名的关键词要被剔掉')
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true })
  }
})

test('引用了消息就只用引用里的图（旧版单文件的行为），@ 头像不掺进来', async () => {
  /**
   * 旧版 /workspace/YIYI-Plugin/Memes.js 的 `imgs()`：`if (!imgUrls.length) imgUrls = imgs(...)`
   * —— 引用里有图就只用引用图，没有才回头看本条消息的图和 @ 的人。
   * 新模型改成了「@ 头像 → 引用图」，1 张图的表情一裁就只剩@ 的头像。
   */
  const { memeImageOrder, imageUrlsOf } = await load('models/Memes/Images.js')

  const e = { message: [{ type: 'at', qq: '1994295207' }], getReply: async () => ({ message: [{ type: 'image', url: 'https://a/quote.png' }] }) }
  const quoted = imageUrlsOf(((await e.getReply()) || e.source)?.message)
  assert.deepEqual(memeImageOrder({ quoted, at: ['https://a/at.png'] }), ['https://a/quote.png'])

  /** 引用里没图（引用的是纯文字）：才轮到本条消息的图、点名的 QQ、@ 的人 */
  assert.deepEqual(
    memeImageOrder({ own: ['https://a/own.png'], quoted: [], typed: ['https://a/typed.png'], at: ['https://a/at.png'] }),
    ['https://a/own.png', 'https://a/typed.png', 'https://a/at.png']
  )

  /** 只有 file 名的图片段下载不了，跳过；file 本身就是 http 的照收 */
  assert.deepEqual(imageUrlsOf([{ type: 'image', file: 'abc.image' }]), [])
  assert.deepEqual(imageUrlsOf([{ type: 'image', file: 'https://a/x.png' }]), ['https://a/x.png'])

  const src = read('apps', 'Memes.js')
  assert.match(src, /quoted = imageUrlsOf\(\(\(await e\.getReply\?\.\(\)\) \|\| e\.source\)\?\.message\)/, '引用图要真的捡进 urls')
})
