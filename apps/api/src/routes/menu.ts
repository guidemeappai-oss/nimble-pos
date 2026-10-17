import { validateMenuImages } from './menuImages';
import { validateMenuStock } from './menuStock';
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { MerchantProductInput, validateMerchantCatalog, type MerchantProduct, type MenuWorkspace } from "@nimble/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "../db/client";
import * as s from "../db/schema";
import type { MerchantActor, MerchantTaskHelpers } from "./tasks";
const reason = z.string().trim().min(1).max(500);
const rev = z.number().int().min(0).max(2147483646);
const products = z.array(MerchantProductInput.extend({
  id: z.string().uuid()
})).max(500);
const draftCommand = z.object({
  revision: rev.nullable(), basePublishedRevision: rev, products, reason, idempotencyKey: z.string().uuid()
}).strict();
const restoreCommand = z.object({
  draftRevision: rev.nullable(), basePublishedRevision: rev, reason, idempotencyKey: z.string().uuid()
}).strict();
const publishCommand = z.object({
  draftRevision: rev, basePublishedRevision: rev, idempotencyKey: z.string().uuid(), reason
}).strict();
export async function bumpMenuRevision(db: Db, venueId: string) {
  await db.insert(s.merchantMenuState).values({
    venueId
  }).onConflictDoNothing();
  const [state] = await db.select().from(s.merchantMenuState).where(eq(s.merchantMenuState.venueId, venueId));
  await db.update(s.merchantMenuState).set({
    publishedRevision: state.publishedRevision + 1
  }).where(eq(s.merchantMenuState.venueId, venueId));
}
type Helpers = {
  actor: (req: FastifyRequest) => Promise<MerchantActor>;
  permittedVenue: (req: FastifyRequest, permission: "menu.manage") => Promise<typeof s.merchantVenue.$inferSelect>;
  audit: MerchantTaskHelpers["audit"];
  protectLoyaltyProduct: (db: Db, id: string, input: {
    variants: {
      id: string;
    }[];
    components?: MerchantProduct["components"];
    extras?: MerchantProduct["extras"];
    choiceGroups?: MerchantProduct["choiceGroups"];
  }) => Promise<void>;
  fail: (status: number, code: string) => never;
};
export async function menuRoutes(app: FastifyInstance, h: Helpers) {
  const db = app.deps.db;
  const base = "/v1/merchant/venues/:venueId/menu";
  const key = (a: MerchantActor) => a.kind === "owner" ? `owner:${a.userId}` : `cashier:${a.employeeId}`;
  async function locked<T>(venueId: string, run: (tx: Db) => Promise<T>) {
    return db.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      await tx.select().from(s.merchantVenue).where(eq(s.merchantVenue.id, venueId)).for("update");
      await tx.insert(s.merchantMenuState).values({
        venueId
      }).onConflictDoNothing();
      return run(tx);
    });
  }
  async function state(tx: Db, venueId: string) {
    return (await tx.select().from(s.merchantMenuState).where(eq(s.merchantMenuState.venueId, venueId)))[0];
  }
  async function workspace(tx: Db, venueId: string): Promise<MenuWorkspace> {
    const st = await state(tx, venueId);
    return {
      publishedRevision: st.publishedRevision, products: (await tx.select().from(s.merchantProduct).where(eq(s.merchantProduct.venueId, venueId))).map(p => p.catalog), draft: st.draftProducts ? {
        revision: st.draftRevision, basePublishedRevision: st.draftBaseRevision!, products: st.draftProducts, updatedAt: st.updatedAt.toISOString()
      } : null
    };
  }
  async function replay(tx: Db, venueId: string, a: MerchantActor, action: string, input: {
    idempotencyKey: string;
  }, run: () => Promise<MenuWorkspace>) {
    const actor = key(a), hash = createHash("sha256").update(JSON.stringify({
      action, ...input
    })).digest("hex");
    const [prior] = await tx.select().from(s.merchantMenuRequest).where(and(eq(s.merchantMenuRequest.venueId, venueId), eq(s.merchantMenuRequest.actor, actor), eq(s.merchantMenuRequest.key, input.idempotencyKey)));
    if (prior) {
      if (prior.requestHash !== hash)
        h.fail(409, "IDEMPOTENCY_CONFLICT");
      return prior.response;
    }
    const response = await run();
    await tx.insert(s.merchantMenuRequest).values({
      venueId, actor, key: input.idempotencyKey, requestHash: hash, response
    });
    return response;
  }
  function check(st: Awaited<ReturnType<typeof state>>, revision: number | null, baseRevision: number) {
    if (st.publishedRevision !== baseRevision || (st.draftProducts ? st.draftRevision : null) !== revision)
      h.fail(409, "MENU_CONFLICT");
  }
  async function validate(tx: Db, venueId: string, all: MerchantProduct[]) {
    try {
      validateMerchantCatalog(all);
    } catch (error) {
      h.fail(400, (error as Error).message);
    }
    await validateMenuStock(tx, venueId, all);
    await validateMenuImages(tx, venueId, all);
  }
  async function save(tx: Db, venueId: string, input: z.infer<typeof draftCommand>) {
    const st = await state(tx, venueId);
    check(st, input.revision, input.basePublishedRevision);
    await validate(tx, venueId, input.products);
    const collisions = input.products.length ? await tx.select().from(s.merchantProduct).where(inArray(s.merchantProduct.id, input.products.map(p => p.id))) : [];
    if (collisions.some(p => p.venueId !== venueId))
      h.fail(404, "NOT_FOUND");
    await tx.update(s.merchantMenuState).set({
      draftRevision: st.draftRevision + 1, draftBaseRevision: st.publishedRevision, draftProducts: input.products, updatedAt: new Date()
    }).where(eq(s.merchantMenuState.venueId, venueId));
    return workspace(tx, venueId);
  }
  app.get(base, async (req) => {
    const v = await h.permittedVenue(req, "menu.manage");
    return locked(v.id, tx => workspace(tx, v.id));
  });
  app.put(`${base}/draft`, async (req) => {
    const v = await h.permittedVenue(req, "menu.manage"), a = await h.actor(req), input = draftCommand.parse(req.body);
    return locked(v.id, async (tx) => replay(tx, v.id, a, "save", input, async () => {
      const result = await save(tx, v.id, input);
      await h.audit(tx, a, v.id, "menu.draft.saved", input.reason, null, {
        draftRevision: result.draft!.revision
      });
      return result;
    }));
  });
  app.get(`${base}/versions`, async (req) => {
    const v = await h.permittedVenue(req, "menu.manage");
    const q = z.object({
      page: z.coerce.number().int().min(0).max(100000).default(0), limit: z.coerce.number().int().min(1).max(100).default(20)
    }).parse(req.query);
    const rows = await db.select().from(s.merchantMenuVersion).where(eq(s.merchantMenuVersion.venueId, v.id)).orderBy(desc(s.merchantMenuVersion.revision)).limit(q.limit + 1).offset(q.page * q.limit);
    return {
      versions: rows.slice(0, q.limit).map(({ actor, venueId, ...r }) => ({
        ...r, createdAt: r.createdAt.toISOString()
      })), hasMore: rows.length > q.limit
    };
  });
  app.post(`${base}/versions/:versionId/restore`, async (req) => {
    const v = await h.permittedVenue(req, "menu.manage"), a = await h.actor(req), input = restoreCommand.parse(req.body), versionId = z.string().uuid().parse((req.params as any).versionId);
    return locked(v.id, async (tx) => replay(tx, v.id, a, "restore:" + versionId, input, async () => {
      const [version] = await tx.select().from(s.merchantMenuVersion).where(and(eq(s.merchantMenuVersion.id, versionId), eq(s.merchantMenuVersion.venueId, v.id)));
      if (!version)
        h.fail(404, "NOT_FOUND");
      const result = await save(tx, v.id, {
        revision: input.draftRevision, basePublishedRevision: input.basePublishedRevision, products: version.products, reason: input.reason, idempotencyKey: input.idempotencyKey
      });
      await h.audit(tx, a, v.id, "menu.draft.restored", input.reason, null, {
        versionId, draftRevision: result.draft!.revision
      });
      return result;
    }));
  });
  app.post(`${base}/publish`, async (req) => {
    const v = await h.permittedVenue(req, "menu.manage"), a = await h.actor(req), input = publishCommand.parse(req.body), actor = key(a), hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    return locked(v.id, async (tx) => {
      const [prior] = await tx.select().from(s.merchantMenuRequest).where(and(eq(s.merchantMenuRequest.venueId, v.id), eq(s.merchantMenuRequest.actor, actor), eq(s.merchantMenuRequest.key, input.idempotencyKey)));
      if (prior) {
        if (prior.requestHash !== hash)
          h.fail(409, "IDEMPOTENCY_CONFLICT");
        return prior.response;
      }
      const st = await state(tx, v.id);
      check(st, input.draftRevision, input.basePublishedRevision);
      if (!st.draftProducts || st.draftBaseRevision !== st.publishedRevision)
        h.fail(409, "MENU_CONFLICT");
      const all = st.draftProducts!;
      await validate(tx, v.id, all);
      const old = await tx.select().from(s.merchantProduct).where(eq(s.merchantProduct.venueId, v.id));
      for (const p of old) {
        const replacement = all.find(n => n.id === p.id);
        await h.protectLoyaltyProduct(tx, p.id, replacement ?? {
          variants: []
        });
        if (!replacement) {
          const [promise] = await tx.select({
            id: s.loyaltyProgram.id
          }).from(s.loyaltyProgram).where(eq(s.loyaltyProgram.productId, p.id)).limit(1);
          if (promise)
            h.fail(409, "LOYALTY_REWARD_PRODUCT_LOCKED");
        }
      }
      if (old.length) {
        const [baseline] = await tx.select().from(s.merchantMenuVersion).where(and(eq(s.merchantMenuVersion.venueId, v.id), eq(s.merchantMenuVersion.revision, st.publishedRevision)));
        if (!baseline)
          await tx.insert(s.merchantMenuVersion).values({
            venueId: v.id, revision: st.publishedRevision, products: old.map(p => p.catalog), reason: "Menu before publication", actor
          });
      }
      for (const p of all) {
        const [existing] = await tx.select().from(s.merchantProduct).where(eq(s.merchantProduct.id, p.id));
        if (existing && existing.venueId !== v.id)
          h.fail(404, "NOT_FOUND");
        const saved = await tx.insert(s.merchantProduct).values({
          id: p.id, venueId: v.id, catalog: p
        }).onConflictDoUpdate({
          target: s.merchantProduct.id, set: {
            catalog: p
          }, setWhere: eq(s.merchantProduct.venueId, v.id)
        }).returning({
          id: s.merchantProduct.id
        });
        if (!saved.length)
          h.fail(404, "NOT_FOUND");
      }
      const removed = old.filter(p => !all.some(n => n.id === p.id));
      if (removed.length)
        await tx.delete(s.merchantProduct).where(inArray(s.merchantProduct.id, removed.map(p => p.id)));
      const revision = st.publishedRevision + 1;
      await tx.insert(s.merchantMenuVersion).values({
        venueId: v.id, revision, products: all, reason: input.reason, actor
      });
      await tx.update(s.merchantMenuState).set({
        publishedRevision: revision, draftProducts: null, draftBaseRevision: null, updatedAt: new Date()
      }).where(eq(s.merchantMenuState.venueId, v.id));
      await h.audit(tx, a, v.id, "menu.published", input.reason, {
        revision: st.publishedRevision
      }, {
        revision, productCount: all.length
      });
      const response = await workspace(tx, v.id);
      await tx.insert(s.merchantMenuRequest).values({
        venueId: v.id, actor, key: input.idempotencyKey, requestHash: hash, response
      });
      return response;
    });
  });
}
