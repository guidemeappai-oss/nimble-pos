import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
const script = new URL('./test-native-postgres.mjs', import.meta.url)
for (const [name, url, reset, message] of [
  ['rejects a production-named database before connecting', 'postgres://localhost/production', 'yes', /dedicated database name must end in _test/],
  ['requires explicit permission to reset an existing test database', 'postgres://localhost/nimble_test', '', /requires NATIVE_POSTGRES_ALLOW_RESET=yes/],
]) test(name, () => {
  const result = spawnSync(process.execPath, [script.pathname], { encoding: 'utf8', env: { ...process.env, NATIVE_POSTGRES_TEST_URL: url, NATIVE_POSTGRES_ALLOW_RESET: reset } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, message)
})
