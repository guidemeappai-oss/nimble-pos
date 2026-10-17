#!/usr/bin/env node
// Native PostgreSQL gate: disposable cluster or explicitly resettable dedicated database.
import { mkdtemp, cp, mkdir, chown, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(new URL('../apps/api/package.json', import.meta.url))
const postgres = require('postgres')
const run = (command, args, options = {}) => new Promise((done, reject) => {
  const child = spawn(command, args, { stdio: 'inherit', ...options })
  child.once('error', reject)
  child.once('exit', (code, signal) => code === 0 ? done() : reject(new Error(`${command} failed (${code ?? signal})`)))
})
async function suite(url) {
  const target = new URL(url)
  if (!['postgres:', 'postgresql:'].includes(target.protocol) || !/^\/[A-Za-z0-9_]+_test$/.test(target.pathname)) throw new Error('Refusing destructive fixtures: dedicated database name must end in _test')
  if (process.env.NATIVE_POSTGRES_ALLOW_RESET !== 'yes' && process.env.NATIVE_POSTGRES_TEST_URL) throw new Error('External dedicated database requires NATIVE_POSTGRES_ALLOW_RESET=yes; fixtures truncate data')
  const sessions = [postgres(url, { max: 1, connect_timeout: 5 }), postgres(url, { max: 1, connect_timeout: 5 })]
  try {
    const [a, b] = await Promise.all(sessions.map(sql => sql`select version() as version, pg_backend_pid() as pid`))
    if (a[0].pid === b[0].pid || /pglite|wasm|emscripten/i.test(a[0].version)) throw new Error('Independent native database sessions required')
    console.log(`Native session verification: ${a[0].version}; backend PIDs ${a[0].pid}, ${b[0].pid}`)
  } finally { await Promise.all(sessions.map(sql => sql.end())) }
  await run(process.execPath, [join(root, 'apps/api/node_modules/vitest/vitest.mjs'), 'run', ...process.argv.slice(2), '--reporter=verbose'], {
    cwd: join(root, 'apps/api'), env: { ...process.env, TEST_DATABASE_URL: url },
  })
}
if (process.env.NATIVE_POSTGRES_TEST_URL) {
  await suite(process.env.NATIVE_POSTGRES_TEST_URL)
  process.exit(0)
}
const binaries = process.env.NATIVE_POSTGRES_BIN
if (!binaries) throw new Error('Set NATIVE_POSTGRES_BIN for a disposable cluster, or NATIVE_POSTGRES_TEST_URL for an explicitly resettable dedicated _test database.')
if (process.getuid?.() === 0 && process.platform === 'linux') {
  const mappings = (await readFile('/proc/self/uid_map', 'utf8')).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number))
  if (!mappings.some(([inside, , count]) => inside <= 65534 && inside + count > 65534)) {
    throw new Error('Native PostgreSQL blocked: this container maps only root and cannot run initdb as an unprivileged UID. Run this script on a host/container with an unprivileged user; PGlite does not satisfy this gate.')
  }
}
const temporary = await mkdtemp(join(tmpdir(), 'nimble-native-'))
// initdb forbids root. A disposable cluster may run under the unprivileged nobody UID.
const identity = process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {}
let started = false
try {
  // Copy to an accessible location: source workspace ancestors can be root-only.
  await cp(resolve(binaries, '..'), join(temporary, 'postgres'), { recursive: true, dereference: true })
  const bin = join(temporary, 'postgres', 'bin')
  const data = join(temporary, 'data')
  const socket = join(temporary, 'socket')
  await mkdir(socket)
  if (identity.uid !== undefined) {
    await chown(temporary, identity.uid, identity.gid)
    await chown(socket, identity.uid, identity.gid)
  }
  await run(join(bin, 'initdb'), ['-D', data, '-U', 'nimble_test', '--auth=trust', '--no-locale', '--encoding=UTF8'], identity)
  // Private Unix socket and no TCP listener isolate the disposable database.
  await writeFile(join(data, 'postgresql.auto.conf'), `listen_addresses = ''\nunix_socket_directories = '${socket}'\nfsync = off\n`)
  await run(join(bin, 'pg_ctl'), ['-D', data, '-l', join(temporary, 'server.log'), '-w', 'start'], identity)
  started = true
  const admin = postgres({ host: socket, user: 'nimble_test', database: 'postgres', max: 1 })
  try { await admin.unsafe('CREATE DATABASE nimble_native_test') } finally { await admin.end() }
  const url = `postgres://nimble_test@localhost/nimble_native_test?host=${encodeURIComponent(socket)}`
  await suite(url)
} finally {
  if (started) await run(join(temporary, 'postgres/bin/pg_ctl'), ['-D', join(temporary, 'data'), '-m', 'immediate', '-w', 'stop'], identity)
  await rm(temporary, { recursive: true, force: true })
}
