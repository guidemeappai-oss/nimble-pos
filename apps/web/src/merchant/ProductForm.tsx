import { ProductImageEditor, type ProductImageApi } from './ProductImage'
import { ProductInformationEditor } from './ProductInformation'
import { t } from '../i18n'
import { validateMerchantCatalog } from '@nimble/shared'
import { merchantError } from './errors'
import { ProductCompositionEditor } from './ProductCompositionEditor'
import { StockBindingEditor } from './StockBindingEditor'
import type { InventoryItem, RecipeVersion } from '@nimble/shared'
import { useState } from 'react'
import { uuid } from '../lib/uuid'
import type { ProductInput } from './client'
import type { MerchantProduct, MerchantFiat } from './contract'

export function ProductForm({
  product,
  products = [],
  currency,
  stocks,
  recipes = [],
  imageApi,
  busy,
  onSave,
  onClose,
}: {
  imageApi?: ProductImageApi
  recipes?: RecipeVersion[]
  stocks?: InventoryItem[]
  products?: MerchantProduct[]
  product?: MerchantProduct
  currency: MerchantFiat
  busy: boolean
  onSave: (input: ProductInput) => Promise<void>
  onClose: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState<ProductInput>(
    product ?? {
      name: '',
      category: 'Coffee',
      available: true,
      variants: [{ id: uuid(), name: 'Classic', priceMinor: 0 }],
      extras: [],
    },
  )
  const derived = (components: NonNullable<MerchantProduct['components']>) => components.flatMap(component => {
    const child = products.find(p => p.id === component.productId)
    const variant = child?.variants.find(v => v.id === component.variantId)
    const prefix = `${component.quantity} × ${child?.name ?? 'Missing product'} · ${variant?.name ?? 'Missing variant'}`
    return variant?.stockBindings?.length ? variant.stockBindings.map(binding => {
      const item = stocks?.find(s => s.id === binding.itemId)
      return `${prefix}: ${component.quantity * binding.quantity} × ${item?.name ?? binding.itemId}${item ? ` · ${item.unit.toLowerCase()}${item.tracked ? '' : ' · not tracked'}` : ' · unavailable resource'}`
    }) : [`${prefix}: no stock resource linked`]
  })
  return (
    <form
      className="m-panel m-form"
      onSubmit={(e) => {
        e.preventDefault()
        try {
          const candidate = {...input,id:input.id ?? uuid()}
          validateMerchantCatalog([...products.filter(p => p.id !== candidate.id),candidate])
          setError(null)
          void onSave(input)
        } catch (e) { setError(merchantError(e)) }
      }}
    >
      <div className="m-row">
        <h2>{product ? 'Edit product' : 'Something delicious.'}</h2>
        <button type="button" onClick={onClose}>
          Close ×
        </button>
      </div>
      <label>
        Product name
        <input
          required
          value={input.name}
          onChange={(e) => setInput({ ...input, name: e.target.value })}
        />
      </label>
      <label>
        Category
        <input
          required
          value={input.category}
          onChange={(e) => setInput({ ...input, category: e.target.value })}
        />
      </label>
      {imageApi && <ProductImageEditor imageId={input.imageId} api={imageApi} onChange={imageId => setInput({ ...input, imageId })} />}
      <ProductInformationEditor value={input.information} onChange={information => setInput({...input,information})}/>
      <h3>Sizes & variants · {currency}</h3>
      {input.variants.map((v, i) => (
        <div className="m-option-editor" key={v.id}>
          <input
            required
            aria-label={`Variant ${i + 1} name`}
            value={v.name}
            onChange={(e) =>
              setInput({
                ...input,
                variants: input.variants.map((x) =>
                  x.id === v.id ? { ...x, name: e.target.value } : x,
                ),
              })
            }
          />
          <input
            required
            aria-label={`Variant ${i + 1} price`}
            type="number"
            step="0.01"
            min="0"
            max="1000000"
            value={v.priceMinor / 100}
            onChange={(e) =>
              setInput({
                ...input,
                variants: input.variants.map((x) =>
                  x.id === v.id
                    ? {
                        ...x,
                        priceMinor: Math.round(Number(e.target.value) * 100),
                      }
                    : x,
                ),
              })
            }
          />
          <button
            type="button"
            aria-label={`Remove ${v.name}`}
            disabled={input.variants.length === 1}
            onClick={() =>
              setInput({
                ...input,
                variants: input.variants.filter((x) => x.id !== v.id),
              })
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setInput({
            ...input,
            variants: [
              ...input.variants,
              { id: uuid(), name: '', priceMinor: 0 },
            ],
          })
        }
      >
        Add size +
      </button>
      <p className="m-muted">{t('Linked, tracked resources are reserved at checkout and deducted after counter payment confirmation or remote order acceptance. Unlinked and untracked resources are unaffected.')}</p>
      {input.variants.map(v=><label key={v.id}>Recipe · {v.name}<select value={v.recipeVersionId??''} onChange={e=>setInput({...input,variants:input.variants.map(x=>x.id===v.id?{...x,recipeVersionId:e.target.value||undefined,stockBindings:undefined}:x)})}><option value="">Ready stock or no recipe</option>{v.recipeVersionId&&!recipes.some(r=>r.id===v.recipeVersionId)&&<option value={v.recipeVersionId}>Selected recipe version</option>}{recipes.map(r=><option key={r.id} value={r.id}>{r.name} · v{r.version}</option>)}</select></label>)}
      {input.variants.map(v => <StockBindingEditor key={v.id} label={`variant ${v.name}`} stocks={stocks} bindings={v.stockBindings} derived={v.recipeVersionId ? (recipes.find(r=>r.id===v.recipeVersionId)?.requirements??[]).map(b=>`${stocks?.find(i=>i.id===b.itemId)?.name??b.itemId}: ${b.quantity}`) : input.components?.length ? derived(input.components) : undefined} onChange={stockBindings => setInput({...input,variants:input.variants.map(x => x.id === v.id ? {...x,stockBindings} : x)})} />)}
      <h3>Paid extras · {currency}</h3>
      {input.extras.map((x, i) => (
        <div className="m-option-editor" key={x.id}>
          <input
            required
            aria-label={`Extra ${i + 1} name`}
            value={x.name}
            onChange={(e) =>
              setInput({
                ...input,
                extras: input.extras.map((v) =>
                  v.id === x.id ? { ...v, name: e.target.value } : v,
                ),
              })
            }
          />
          <input
            required
            aria-label={`Extra ${i + 1} price`}
            type="number"
            min="0"
            step="0.01"
            max="1000000"
            value={x.priceMinor / 100}
            onChange={(e) =>
              setInput({
                ...input,
                extras: input.extras.map((v) =>
                  v.id === x.id
                    ? {
                        ...v,
                        priceMinor: Math.round(Number(e.target.value) * 100),
                      }
                    : v,
                ),
              })
            }
          />
          <button
            type="button"
            aria-label={`Remove ${x.name}`}
            onClick={() =>
              setInput({
                ...input,
                extras: input.extras.filter((v) => v.id !== x.id),
                choiceGroups: input.choiceGroups?.map(g => ({...g,extraIds:g.extraIds.filter(id => id !== x.id)})),
              })
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          setInput({
            ...input,
            extras: [
              ...input.extras,
              { id: uuid(), name: '', priceMinor: 0, available: true },
            ],
          })
        }
      >
        Add extra +
      </button>
      {input.extras.map(extra=><fieldset key={extra.id}><legend>Recipe · {extra.name}</legend><select aria-label={`Recipe for extra ${extra.name}`} value={extra.recipeVersionId??''} onChange={e=>setInput({...input,extras:input.extras.map(x=>x.id===extra.id?{...x,recipeVersionId:e.target.value||undefined,stockBindings:undefined,replacesBaseRecipe:e.target.value?x.replacesBaseRecipe:undefined}:x)})}><option value="">Ready stock or no recipe</option>{extra.recipeVersionId&&!recipes.some(r=>r.id===extra.recipeVersionId)&&<option value={extra.recipeVersionId}>Selected recipe version</option>}{recipes.map(r=><option key={r.id} value={r.id}>{r.name} · v{r.version}</option>)}</select>{extra.recipeVersionId&&<label><input type="checkbox" checked={!!extra.replacesBaseRecipe} onChange={e=>setInput({...input,extras:input.extras.map(x=>x.id===extra.id?{...x,replacesBaseRecipe:e.target.checked}:x)})}/>Replace the base recipe (complete alternative recipe)</label>}</fieldset>)}
      {input.extras.map(extra => <StockBindingEditor key={extra.id} label={`extra ${extra.name}`} stocks={stocks} bindings={extra.stockBindings} derived={extra.recipeVersionId ? (recipes.find(r=>r.id===extra.recipeVersionId)?.requirements??[]).map(b=>`${stocks?.find(i=>i.id===b.itemId)?.name??b.itemId}: ${b.quantity}`) : extra.component ? derived([extra.component]) : undefined} onChange={stockBindings => setInput({...input,extras:input.extras.map(x => x.id === extra.id ? {...x,stockBindings} : x)})} />)}
      <ProductCompositionEditor input={input} products={products} onChange={setInput} />
      <label className="m-check">
        <input
          type="checkbox"
          checked={input.available}
          onChange={(e) => setInput({ ...input, available: e.target.checked })}
        />
        Available for orders
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="m-primary" disabled={busy}>
        Save product →
      </button>
    </form>
  )
}
