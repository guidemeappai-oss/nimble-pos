import { createHash } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import type { MerchantProduct } from '@nimble/shared'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import { createTaskPhotoStorage, TASK_PHOTO_MAX_BYTES } from '../services/taskPhotoStorage'
import { loyaltyFail as fail } from '../services/loyalty'
const uuid = z.string().uuid()
const storage = () => createTaskPhotoStorage(process.env.MENU_IMAGE_DIR ?? '.public/menu-images')
export async function validateMenuImages(db: Db, venueId: string, products: MerchantProduct[]) {
  const ids = [...new Set(products.flatMap(p => p.imageId ? [p.imageId] : []))]
  if (!ids.length) return
  const images = await db.select({ id: s.merchantMenuImage.id }).from(s.merchantMenuImage).where(and(eq(s.merchantMenuImage.venueId, venueId), inArray(s.merchantMenuImage.id, ids)))
  if (images.length !== ids.length) fail(400, 'INVALID_MENU_IMAGE')
}
type Helpers = { permittedVenue(req: FastifyRequest, permission: 'menu.manage'): Promise<{ id: string }> }
export async function menuImageRoutes(app: FastifyInstance, h: Helpers) {
  const db = app.deps.db, base = '/v1/merchant/venues/:venueId/menu/images'
  const imageFor = async (id: string, venueId?: string) => {
    const [image] = await db.select().from(s.merchantMenuImage).where(venueId ? and(eq(s.merchantMenuImage.id, id), eq(s.merchantMenuImage.venueId, venueId)) : eq(s.merchantMenuImage.id, id))
    if (!image) fail(404, 'PHOTO_NOT_FOUND')
    return image
  }
  app.post(base, { bodyLimit: Math.ceil(TASK_PHOTO_MAX_BYTES * 4 / 3) + 4096 }, async (req, reply) => {
    const venue = await h.permittedVenue(req, 'menu.manage')
    const input = z.object({ idempotencyKey: uuid, base64: z.string().min(4).max(Math.ceil(TASK_PHOTO_MAX_BYTES * 4 / 3)).regex(/^[A-Za-z0-9+/]*={0,2}$/) }).strict().parse(req.body)
    const bytes = Buffer.from(input.base64, 'base64')
    if (bytes.length > TASK_PHOTO_MAX_BYTES) fail(413, 'PHOTO_TOO_LARGE')
    const hash = createHash('sha256').update(bytes).digest('hex')
    let newKey: string | undefined
    try {
      const image = await db.transaction(async raw => {
        const tx = raw as unknown as Db
        await tx.select({ id: s.merchantVenue.id }).from(s.merchantVenue).where(eq(s.merchantVenue.id, venue.id)).for('update')
        const [old] = await tx.select().from(s.merchantMenuImage).where(and(eq(s.merchantMenuImage.venueId, venue.id), eq(s.merchantMenuImage.requestKey, input.idempotencyKey)))
        if (old) { if (old.requestHash !== hash) fail(409, 'IDEMPOTENCY_CONFLICT'); return old }
        const existingImages = await tx.select({ bytes: s.merchantMenuImage.bytes }).from(s.merchantMenuImage).where(eq(s.merchantMenuImage.venueId, venue.id)).limit(1001)
        if (existingImages.length >= 1000 || existingImages.reduce((sum, row) => sum + row.bytes, 0) + bytes.length > 100 * 1024 * 1024) fail(409, 'MENU_IMAGE_STORAGE_LIMIT')
        const saved = await storage().save(bytes); newKey = saved.key
        return (await tx.insert(s.merchantMenuImage).values({ venueId: venue.id, storageKey: saved.key, bytes: saved.bytes, requestKey: input.idempotencyKey, requestHash: hash }).returning())[0]
      })
      return reply.code(201).send({ id: image.id, bytes: image.bytes })
    } catch (error) { if (newKey) await storage().remove(newKey); throw error }
  })
  const serve = async (id: string, reply: FastifyReply, venueId?: string) => {
    const image = await imageFor(id, venueId)
    if (!venueId) {
      const products = await db.select({ catalog: s.merchantProduct.catalog }).from(s.merchantProduct).where(eq(s.merchantProduct.venueId, image.venueId))
      if (!products.some(p => p.catalog.imageId === id)) fail(404, 'PHOTO_NOT_FOUND')
    }
    try { return reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').type('image/jpeg').send(await storage().read(image.storageKey)) }
    catch { fail(404, 'PHOTO_NOT_FOUND') }
  }
  app.get(`${base}/:imageId`, async (req, reply) => {
    const venue = await h.permittedVenue(req, 'menu.manage')
    return serve(uuid.parse((req.params as any).imageId), reply, venue.id)
  })
  app.get('/v1/merchant/menu-images/:imageId', async (req, reply) => serve(uuid.parse((req.params as any).imageId), reply))
}

/** Remove abandoned uploads, retaining photographs used by restorable versions. */
export async function cleanMenuImages(db: Db, now = Date.now()) {
  const images = await db.select().from(s.merchantMenuImage)
  for (const image of images) {
    if (image.createdAt.getTime() > now - 86400000) continue
    await db.transaction(async raw => {
      const tx = raw as unknown as Db
      await tx.select({ id: s.merchantVenue.id }).from(s.merchantVenue).where(eq(s.merchantVenue.id, image.venueId)).for('update')
      const [current] = await tx.select().from(s.merchantMenuImage).where(eq(s.merchantMenuImage.id, image.id))
      if (!current) return
      const products = await tx.select({ catalog: s.merchantProduct.catalog }).from(s.merchantProduct).where(eq(s.merchantProduct.venueId, image.venueId))
      const states = await tx.select({ draft: s.merchantMenuState.draftProducts }).from(s.merchantMenuState).where(eq(s.merchantMenuState.venueId, image.venueId))
      const versions = await tx.select({ products: s.merchantMenuVersion.products }).from(s.merchantMenuVersion).where(eq(s.merchantMenuVersion.venueId, image.venueId))
      const referenced = [...products.map(p => p.catalog), ...states.flatMap(x => x.draft ?? []), ...versions.flatMap(x => x.products)].some(p => p.imageId === image.id)
      if (referenced) return
      await storage().remove(image.storageKey)
      await tx.delete(s.merchantMenuImage).where(eq(s.merchantMenuImage.id, image.id))
    })
  }
  const active = await db.select({ key: s.merchantMenuImage.storageKey }).from(s.merchantMenuImage)
  await storage().cleanOrphans(new Set(active.map(x => x.key)), now)
}
