import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import * as utils from '../utils/index.js'
import { loadModule } from './helpers/modules.js'

test('personal data writes skip identical content and preserve unrelated parts', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yiyi-store-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  let writes = 0
  const store = await loadModule('models/King/core/store.js', {
    mocks: {
      '#yiyi.utils': {
        ...utils,
        dataDir: path.join(dir, 'data'),
        cacheDir: path.join(dir, 'cache'),
        writeText: (file, text) => { writes += 1; return utils.writeText(file, text) }
      }
    }
  })
  assert.equal(store.writeUserPart('123456', 'auth', { token: 'local-test' }), true)
  assert.equal(store.writeUserPart('123456', 'push', { battle: true }), true)
  const before = writes
  assert.equal(store.writeUserPart('123456', 'push', { battle: true }), true)
  assert.equal(writes, before)
  assert.equal(store.writeUserPart('123456', 'push', null), true)
  assert.equal(store.readUserPart('123456', 'push'), null)
  assert.equal(store.readUserPart('123456', 'auth').token, 'local-test')
})
