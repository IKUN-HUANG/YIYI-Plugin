/**
 * @file 表情包的「别抢别人指令」自检。
 *
 * 关掉功能时规则表必须直接空掉（宿主拿不到规则就不会拦截），
 * 开着时也要把点歌/王者/设置这类别家指令排除在表情识别之外。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { read, load } from './Harness.mjs'

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

test('兜底规则排在最后，且只在有数据时才认', () => {
  const src = read('apps', 'Memes.js')
  const rules = src.slice(src.indexOf('rule: ['), src.indexOf(']\n  })'))
  assert.ok(rules.lastIndexOf('fnc: \'meme\'') > rules.lastIndexOf('fnc: \'update\''), '兜底规则必须在最后')
  assert.match(read('models', 'Memes', 'Lookup.js'), /export const OTHER_CMD_RE/)
})
