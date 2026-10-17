import { afterAll, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { cleanMenuImages } from '../src/routes/menuImages'
import { freshDb } from './helpers/db'
import { authedApp, makeUser } from './helpers/actors'
const directory = await mkdtemp(join(tmpdir(), 'nimble-menu-images-'))
process.env.MENU_IMAGE_DIR = directory
const { db, close } = await freshDb()
const { app, tokenFor } = authedApp(db)
afterAll(async () => { await app.close(); await close(); delete process.env.MENU_IMAGE_DIR; await rm(directory, { recursive: true, force: true }) })
it('keeps uploaded images private until publication, retries once, and unpublishes removed images', async () => {
  const token = await tokenFor(await makeUser(db, 'NQ-menu-image-owner'))
  const headers = { authorization: `Bearer ${token}` }
  const venue = (await app.inject({ method: 'POST', url: '/v1/merchant/venues', headers, payload: { name: 'Photo menu', fiatCurrency: 'EUR', nimAddress: 'NQ-menu-image-owner' } })).json()
  const base = `/v1/merchant/venues/${venue.id}/menu`
  const bytes = await sharp({ create: { width: 100, height: 60, channels: 3, background: '#ffaa00' } }).png().toBuffer()
  const payload = { idempotencyKey: crypto.randomUUID(), base64: bytes.toString('base64') }
  const upload = await app.inject({ method: 'POST', url: `${base}/images`, headers, payload })
  expect(upload.statusCode).toBe(201)
  const image = upload.json()
  expect((await app.inject({ method: 'POST', url: `${base}/images`, headers, payload })).json().id).toBe(image.id)
  expect((await app.inject({ url: `/v1/merchant/menu-images/${image.id}` })).statusCode).toBe(404)
  const preview = await app.inject({ url: `${base}/images/${image.id}`, headers })
  expect(preview.statusCode).toBe(200)
  expect(preview.headers['content-type']).toContain('image/jpeg')
  expect((await sharp(preview.rawPayload).metadata()).format).toBe('jpeg')
  const product = { id: crypto.randomUUID(), name: 'Cake', category: 'Food', available: true, imageId: image.id, variants: [{ id: crypto.randomUUID(), name: 'Slice', priceMinor: 500 }], extras: [] }
  const save = await app.inject({ method: 'PUT', url: `${base}/draft`, headers, payload: { products: [product], revision: null, basePublishedRevision: 0, reason: 'Photo', idempotencyKey: crypto.randomUUID() } })
  expect(save.statusCode).toBe(200)
  expect((await app.inject({ url: `/v1/merchant/menu-images/${image.id}` })).statusCode).toBe(404)
  expect((await app.inject({ method: 'POST', url: `${base}/publish`, headers, payload: { draftRevision: save.json().draft.revision, basePublishedRevision: 0, reason: 'Publish', idempotencyKey: crypto.randomUUID() } })).statusCode).toBe(200)
  expect((await app.inject({ url: `/v1/merchant/menu-images/${image.id}` })).statusCode).toBe(200)
  // Removing a photograph is a menu change; old public URLs stop serving it.
  const without = { ...product, imageId: undefined }
  const next = await app.inject({ method: 'PUT', url: `${base}/draft`, headers, payload: { products: [without], revision: null, basePublishedRevision: 1, reason: 'Remove photo', idempotencyKey: crypto.randomUUID() } })
  await app.inject({ method: 'POST', url: `${base}/publish`, headers, payload: { draftRevision: next.json().draft.revision, basePublishedRevision: 1, reason: 'Remove photo', idempotencyKey: crypto.randomUUID() } })
  expect((await app.inject({ url: `/v1/merchant/menu-images/${image.id}` })).statusCode).toBe(404)
})
it('rejects foreign image references and invalid image uploads without making them public', async () => {
  const setup = async (name: string) => {
    const headers = { authorization: `Bearer ${await tokenFor(await makeUser(db, `NQ-${name}-images`))}` }
    const venue = (await app.inject({ method: 'POST', url: '/v1/merchant/venues', headers, payload: { name, fiatCurrency: 'EUR', nimAddress: `NQ-${name}-images` } })).json()
    return { headers, base: `/v1/merchant/venues/${venue.id}/menu` }
  }
  const a = await setup('image-owner-a'), b = await setup('image-owner-b')
  const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer()
  const image = (await app.inject({ method: 'POST', url: `${a.base}/images`, headers: a.headers, payload: { idempotencyKey: crypto.randomUUID(), base64: bytes.toString('base64') } })).json()
  expect((await app.inject({ url: `${b.base}/images/${image.id}`, headers: b.headers })).statusCode).toBe(404)
  const product = { id: crypto.randomUUID(), name: 'Cake', category: 'Food', available: true, imageId: image.id, variants: [{ id: crypto.randomUUID(), name: 'Slice', priceMinor: 500 }], extras: [] }
  expect((await app.inject({ method: 'PUT', url: `${b.base}/draft`, headers: b.headers, payload: { products: [product], revision: null, basePublishedRevision: 0, reason: 'Foreign', idempotencyKey: crypto.randomUUID() } })).statusCode).toBe(400)
  expect((await app.inject({ method: 'POST', url: `${a.base}/images`, headers: a.headers, payload: { idempotencyKey: crypto.randomUUID(), base64: Buffer.from('<svg/>').toString('base64') } })).statusCode).toBe(400)
  expect((await app.inject({ method: 'POST', url: `${a.base}/images`, payload: { idempotencyKey: crypto.randomUUID(), base64: bytes.toString('base64') } })).statusCode).toBe(401)
})

it('cleans abandoned uploads after the grace period while keeping menu history images', async () => {
  const headers = { authorization: `Bearer ${await tokenFor(await makeUser(db, 'NQ-image-orphan-owner'))}` }
  const venue = (await app.inject({ method: 'POST', url: '/v1/merchant/venues', headers, payload: { name: 'Orphans', fiatCurrency: 'EUR', nimAddress: 'NQ-image-orphan-owner' } })).json()
  const base = `/v1/merchant/venues/${venue.id}/menu/images`
  const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ddd' } }).png().toBuffer()
  const input = { idempotencyKey: crypto.randomUUID(), base64: bytes.toString('base64') }
  const image = (await app.inject({ method: 'POST', url: base, headers, payload: input })).json()
  expect((await app.inject({ method: 'POST', url: base, headers, payload: { ...input, base64: Buffer.from('different').toString('base64') } })).statusCode).toBe(409)
  await cleanMenuImages(db, Date.now() + 2 * 86400000)
  expect((await app.inject({ url: `${base}/${image.id}`, headers })).statusCode).toBe(404)
})
