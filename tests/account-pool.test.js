import assert from 'node:assert/strict'
import test from 'node:test'
import { loadModule } from './helpers/modules.js'

test('owner lookup reads one personal file and never scans the pool', async () => {
  let scans = 0
  let reads = 0
  const { listAccounts } = await loadModule('models/King/auth/pool.js', {
    mocks: {
      '#yiyi.utils': { createLogger: () => ({}), toText: value => String(value ?? '') },
      '../core/store.js': {
        kingPoolFile: 'unused',
        readUserPart: owner => { reads += 1; return { accounts: [{ id: 'a', userId: 'camp', ownerId: owner }] } },
        writeUserPart: () => true,
        listUserIds: () => { scans += 1; return ['u1', 'u2', 'u3', 'u4', 'u5'] }
      },
      '../core/schema.js': { normalizeAccount: value => ({ ...value }) },
      '../core/pool.js': { readPoolIds: () => ['u1', 'u2', 'u3', 'u4', 'u5'], writePoolIds: () => true },
      '../Common.js': { isUsableAuth: () => true },
      './state.js': { ownerOf: value => value.ownerId, isSilenced: () => false }
    }
  })
  for (let i = 0; i < 20; i += 1) assert.equal(listAccounts('u1')[0].ownerId, 'u1')
  assert.equal(reads, 20)
  assert.equal(scans, 0)
  assert.equal(listAccounts().length, 5)
  assert.equal(scans, 1)
})
