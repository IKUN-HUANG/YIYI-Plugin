/**
 * @file 三个工具层的既有修复：文本缓存、内存缓存、图片下载超时。
 *
 * 都是「以前踩过的坑」，用最小代价钉住行为，避免以后又被改回去。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { read, load } from './Harness.mjs'

test('readText：读到的就是新的，文件删了回落到默认值', async () => {
  const { readText } = await load('utils/FS.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yiyi-fs-'))
  const file = path.join(dir, 'a.txt')
  try {
    fs.writeFileSync(file, 'one')
    assert.equal(readText(file, 'fallback'), 'one')
    fs.writeFileSync(file, 'two-two')
    assert.equal(readText(file, 'fallback'), 'two-two', '改了内容还回旧值（缓存没按指纹失效）')
    fs.unlinkSync(file)
    assert.equal(readText(file, 'fallback'), 'fallback', '文件没了应该回落，不该吐旧内容')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('内存缓存不拿空结果占位', async () => {
  const { createMemoryCache } = await load('utils/Cache.js')
  const cache = createMemoryCache({ max: 1 })
  let calls = 0
  const load1 = () => { calls++; return Promise.resolve(undefined) }
  await cache.load('empty', load1)
  await cache.load('empty', load1)
  assert.equal(calls, 2, '空结果不该被缓存')
  assert.equal(cache.size, 0, '空结果不该留在表里')
})

test('图片下载的超时把正文也罩住，非图片响应直接放弃', () => {
  const src = read('utils', 'Image.js')
  const start = src.indexOf('export async function fetchImage')
  const body = src.slice(start, start + 1600)
  assert.match(body, /return await withTimeout\(async signal =>/, '整个请求（含读正文）都要在超时之内')
  assert.ok(body.indexOf('await res.arrayBuffer()') > body.indexOf('return await withTimeout'), '读正文必须在 withTimeout 里面')
  assert.match(body, /body\?\.cancel\(\)/, '非图片响应要把流关掉')
  assert.doesNotMatch(body, /const MIME =/, '没用的 MIME 表不该留')
})
