import {recipeVersions} from '../services/recipes'
import { and, eq, inArray } from 'drizzle-orm'
import type { MerchantProduct } from '@nimble/shared'
import { loyaltyFail } from '../services/loyalty'
import type { Db } from '../db/client'
import { merchantInventoryItem } from '../db/schema'

/** Resource membership is venue-scoped; tracked state does not alter the mapping. */
export async function validateMenuStock(db: Db, venueId: string, products: MerchantProduct[]): Promise<void> {
  await recipeVersions(db,venueId,products.flatMap(p=>[...p.variants,...p.extras].flatMap(o=>o.recipeVersionId?[o.recipeVersionId]:[])))
  const ids = [...new Set(products.flatMap(p => [...p.variants, ...p.extras]
    .flatMap(option => (option.stockBindings ?? []).map(b => b.itemId))))]
  if (!ids.length) return
  const resources = await db.select({ id: merchantInventoryItem.id }).from(merchantInventoryItem)
    .where(and(eq(merchantInventoryItem.venueId, venueId), inArray(merchantInventoryItem.id, ids)))
  if (resources.length !== ids.length) loyaltyFail(400, 'INVALID_STOCK_BINDING')
}
