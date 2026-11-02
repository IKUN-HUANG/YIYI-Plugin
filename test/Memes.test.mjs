/**
 * @file 表情包的「别抢别人指令」自检。
 *
 * 关掉功能时规则表必须直接空掉（宿主拿不到规则就不会拦截），
 * 开着时也要把点歌/王者/设置这类别家指令排除在表情识别之外。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { read, load, PLUGIN, ROOT } from './Harness.mjs'

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

test('宿主里别的插件认领这条消息时，表情直接放行', async () => {
  const { claimedByOthers } = await load('models/Memes/Claim.js')
  const music = { name: 'xiaofei', rule: [{ reg: '^#?(小飞)?(QQ|网易)?(点歌|来一首).*$', fnc: 'search' }] }
  const chat = { name: 'chat', rule: [{ reg: /^#?(\S{1,60})$/ }] }
  const saved = globalThis.Bot
  globalThis.Bot = { plugin: new Map([['xiaofei', music], ['chat', chat]]) }
  try {
    assert.equal(await claimedByOthers('点歌 普泊', {}), true, '别人的点歌规则匹配了，却没让出去')
    assert.equal(await claimedByOthers('摸鱼', {}), false, '兜底规则不该算认领')
    assert.equal(await claimedByOthers('点歌 普泊', music), false, '对自己的规则不该让')
    globalThis.Bot = { plugin: new Map() }
    assert.equal(await claimedByOthers('点歌 普泊', {}), false, '没有别的插件时不该拦')
  } finally {
    globalThis.Bot = saved
  }
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
   * 关键词表在 `data/Memes/keyMap.json`（运行期数据，插件仓里没有），
   * 所以另开一个进程、把 `YIYI_DATA_DIR` 指到工作区那份真实数据上再跑，
   * 免得进程内已经缓存过一份空索引。
   */
  const script = `
    const { memeMatchReg } = await import(${JSON.stringify('file://' + PLUGIN + '/models/Memes/Lookup.js')})
    const re = memeMatchReg()
    process.stdout.write(JSON.stringify({
      isRegExp: re instanceof RegExp,
      hit: re.test('#摸头'),
      missCmd: re.test('#点歌 晴天'),
      missWord: re.test('#随便一句并不存在的话')
    }))
  `
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, YIYI_DATA_DIR: path.join(ROOT, 'data') },
    encoding: 'utf8'
  })
  const { isRegExp, hit, missCmd, missWord } = JSON.parse(out)
  assert.ok(isRegExp)
  assert.ok(hit, '数据里的关键词必须能命中')
  assert.ok(!missCmd, '别家指令不该被表情的规则接走')
  assert.ok(!missWord, '不在关键词表里的短句不该命中')
})
