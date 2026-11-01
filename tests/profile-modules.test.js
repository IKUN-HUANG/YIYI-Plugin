import test from 'node:test'
import assert from 'node:assert/strict'
import { loadModule } from './helpers/modules.js'

const text = value => String(value ?? '')
const log = { info () {}, warn () {} }

async function rolesFixture ({ cache, getProfile = async () => ({ roles: [] }) }) {
  const writes = []
  let calls = 0
  const roles = await loadModule('models/King/profile/roles.js', {
    mocks: {
      '../Store.js': {
        readUserPart: () => cache,
        writeUserPart: (owner, part, value) => { writes.push({ owner, part, value }); return true }
      },
      '../Common.js': { toText: text, AuthAccountError: class extends Error {}, describeError: error => error.message },
      './names.js': { cleanName: value => text(value).trim() },
      '../Say.js': { kingLog: log },
      '../Hot.js': { hotMap: () => new Map() },
      '../Api.js': { getProfile: async (...args) => { calls += 1; return getProfile(...args) } },
      '../Auth.js': { usableAccounts: () => [{ id: 'account', userId: 'camp' }] },
      './map.js': { mapProfile: value => value },
      '../Account.js': { platformText: () => 'QQ' }
    }
  })
  return { roles, writes, calls: () => calls }
}

test('fresh role cache avoids another profile request and write', async () => {
  const fixture = await rolesFixture({
    cache: { account: { at: Date.now(), roles: [{ roleId: 'role', roleName: '角色' }] } }
  })
  const entries = await fixture.roles.readOwnerRoleEntries('owner')
  assert.equal(entries[0].roles[0].roleId, 'role')
  assert.equal(fixture.calls(), 0)
  assert.equal(fixture.writes.length, 0)
})

test('an empty refresh preserves previous roles and their original freshness', async () => {
  const at = Date.now() - 7 * 3600000
  const fixture = await rolesFixture({
    cache: { account: { at, roles: [{ roleId: 'role', roleName: '旧角色' }] } }
  })
  const entries = await fixture.roles.readOwnerRoleEntries('owner')
  assert.equal(fixture.calls(), 1)
  assert.equal(entries[0].roles[0].roleName, '旧角色')
  assert.equal(fixture.writes[0].value.account.at, at)
  assert.equal(fixture.writes[0].value.account.roles[0].roleId, 'role')
})

test('role numbering and hidden selection preserve IDs after deduplication', async () => {
  const { roles } = await rolesFixture({ cache: {} })
  const pool = roles.rolePool([
    { roleId: 'first', roleName: '甲' },
    { roleId: 'first', roleName: '重复项' },
    { roleId: 'second', roleName: '乙' }
  ], 'second')
  assert.deepEqual(Array.from(pool, role => role.index), [1, 2])
  assert.equal(pool[1].current, true)
  const view = roles.campRoleView(pool, ['first'])
  assert.deepEqual(Array.from(view.roles, role => role.roleId), ['second'])
  assert.equal(view.roles[0].index, 2)
})
