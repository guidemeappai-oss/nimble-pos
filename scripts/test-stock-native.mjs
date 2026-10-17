#!/usr/bin/env node
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Opt-in only: the API fixtures migrate and truncate the dedicated test database.
const value = process.env.NATIVE_STOCK_TEST_DATABASE_URL
if (!value) throw new Error('Set NATIVE_STOCK_TEST_DATABASE_URL to a dedicated PostgreSQL database ending in _test.')
let url
try { url = new URL(value) } catch { throw new Error('NATIVE_STOCK_TEST_DATABASE_URL must be a valid PostgreSQL URL.') }
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^\/[A-Za-z0-9_]+_test$/.test(url.pathname)) {
  throw new Error('Native stock tests require a dedicated PostgreSQL database whose name ends in _test.')
}
const require = createRequire(new URL('../apps/api/package.json', import.meta.url))
const postgres = require('postgres')
const clients = [postgres(value, { max: 1, connect_timeout: 10 }), postgres(value, { max: 1, connect_timeout: 10 })]
try {
  const sessions = await Promise.all(clients.map(client => client`select version() as version, pg_backend_pid() as pid`))
  if (sessions.some(rows => /wasm|emscripten|pglite/i.test(rows[0].version)) || sessions[0][0].pid === sessions[1][0].pid) {
    throw new Error('This gate requires native PostgreSQL with independent backend sessions; no PGlite fallback is allowed.')
  }
  console.log('Native PostgreSQL preflight passed: two independent backend sessions.')
} finally {
  await Promise.all(clients.map(client => client.end({ timeout: 5 })))
}
const cwd = fileURLToPath(new URL('../apps/api/', import.meta.url))
const vitest = fileURLToPath(new URL('../apps/api/node_modules/vitest/vitest.mjs', import.meta.url))
const child = spawn(process.execPath, [vitest, 'run', 'test/stock-bindings.test.ts', 'test/stock-reservations.test.ts', 'test/stock-reward-reservations.test.ts', 'test/owner-release-race.test.ts', '--reporter=verbose'], {
  cwd,
  env: { ...process.env, TEST_DATABASE_URL: value },
  stdio: 'inherit',
})
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code, signal) => {
  if (signal) console.error(`Native stock tests terminated by ${signal}.`)
  process.exitCode = code ?? 1
})
