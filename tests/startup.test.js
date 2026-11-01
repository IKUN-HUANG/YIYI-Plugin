import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('all eight apps load with real dependencies and isolated runtime directories', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yiyi-startup-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const config = path.join(dir, 'config')
  fs.mkdirSync(config)
  fs.writeFileSync(path.join(config, 'config.yaml'), 'autoUpdate: false\nmemes:\n  enable: false\n  autoUpdate: false\n', 'utf8')
  fs.writeFileSync(path.join(config, 'king.yaml'), 'enable: false\n', 'utf8')
  const entry = new URL('../index.js', import.meta.url).href
  const code = `
    globalThis.plugin = class {};
    globalThis.logger = { mark: console.log, info: console.log, warn: console.warn, error: console.error, debug: console.debug };
    globalThis.fetch = async () => { throw new Error('Unexpected startup network request'); };
    const { apps } = await import(${JSON.stringify(entry)});
    console.log('APPS=' + JSON.stringify(Object.entries(apps).filter(([, value]) => typeof value === 'function').map(([name]) => name).sort()));
  `
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    windowsHide: true,
    timeout: 15000,
    env: { ...process.env, YIYI_CONFIG_DIR: config, YIYI_DATA_DIR: path.join(dir, 'data'), YIYI_CACHE_DIR: path.join(dir, 'cache') }
  })
  assert.equal(/载入错误|ReferenceError|ERR_MODULE/.test(stdout + stderr), false, stdout + stderr)
  assert.deepEqual(JSON.parse(stdout.match(/APPS=(\[[^\n]+\])/)[1]), [
    'Admin', 'Bilibili', 'Douyin', 'King', 'Kuaishou', 'Memes', 'Music', 'Xiaohongshu'
  ])
})
