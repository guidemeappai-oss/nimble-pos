import { merchantComponentTarget } from '@nimble/shared';
import { uuid } from '../lib/uuid';
import type { ProductInput } from './client';
import type { MerchantProduct } from './contract';
type Component = {
    productId: string;
    variantId: string;
    quantity: number;
};
export function ProductCompositionEditor({ input, products, onChange }: {
    input: ProductInput;
    products: MerchantProduct[];
    onChange: (input: ProductInput) => void;
}) {
    const targets = products.filter(p => p.id !== input.id && merchantComponentTarget(p));
    const selector = (label: string, value: Component | undefined, change: (value: Component | undefined) => void) => <div className="m-row">
        <label>{label}<select value={value ? `${value.productId}:${value.variantId}` : ''} onChange={e => { const [productId, variantId] = e.target.value.split(':'); change(productId && variantId ? { productId, variantId, quantity: value?.quantity ?? 1 } : undefined); }}>
        <option value="">No component</option>{targets.flatMap(p => p.variants.map(v => <option key={`${p.id}:${v.id}`} value={`${p.id}:${v.id}`}>{p.name} · {v.name}
        </option>))}
        </select>
        </label>{value && <label>{label} quantity<input type="number" min="1" max="100" required value={value.quantity} onChange={e => change({ ...value, quantity: Number(e.target.value) })}/>
        </label>}
        </div>;
    return <section>
        <h3>Choices & included components</h3>
        <p className="m-muted">The bundle price includes fixed components. Each selected extra adds its surcharge once.</p>{(input.choiceGroups ?? []).map((group, i) => <fieldset key={group.id}>
        <legend>Choice group {i + 1}
        </legend>
        <label>Choice group {i + 1} name<input required value={group.name} onChange={e => onChange({ ...input, choiceGroups: input.choiceGroups!.map(g => g.id === group.id ? { ...g, name: e.target.value } : g) })}/>
        </label>{(['min', 'max'] as const).map(field => <label key={field}>Choice group {i + 1} {field === 'min' ? 'minimum' : 'maximum'}<input type="number" min={field === 'min' ? 0 : 1} max="20" required value={group[field]} onChange={e => onChange({ ...input, choiceGroups: input.choiceGroups!.map(g => g.id === group.id ? { ...g, [field]: Number(e.target.value) } : g) })}/>
        </label>)}{input.extras.map(extra => <label className="m-check" key={extra.id}>
        <input type="checkbox" checked={group.extraIds.includes(extra.id)} disabled={input.choiceGroups!.some(g => g.id !== group.id && g.extraIds.includes(extra.id))} onChange={e => onChange({ ...input, choiceGroups: input.choiceGroups!.map(g => g.id === group.id ? { ...g, extraIds: e.target.checked ? [...g.extraIds, extra.id] : g.extraIds.filter(id => id !== extra.id) } : g) })}/>{group.name || 'Group'}: {extra.name || 'Unnamed extra'}
        </label>)}<button type="button" onClick={() => onChange({ ...input, choiceGroups: input.choiceGroups!.filter(g => g.id !== group.id) })}>Remove choice group {i + 1}
        </button>
        </fieldset>)}<button type="button" disabled={(input.choiceGroups?.length ?? 0) >= 10} onClick={() => onChange({ ...input, choiceGroups: [...(input.choiceGroups ?? []), { id: uuid(), name: '', min: 0, max: 1, extraIds: [] }] })}>Add choice group +</button>
 {(input.components ?? []).map((component, i) => <div key={i}>{selector(`Included component ${i + 1}`, component, value => onChange({ ...input, components: input.components!.flatMap((c, index) => index !== i ? [c] : value ? [value] : []) }))}<button type="button" onClick={() => onChange({ ...input, components: input.components!.filter((_, index) => index !== i) })}>Remove included component {i + 1}
        </button>
        </div>)}<button type="button" disabled={!targets.length || (input.components?.length ?? 0) >= 20} onClick={() => { const p = targets[0]; if (p?.variants[0])
        onChange({ ...input, components: [...(input.components ?? []), { productId: p.id, variantId: p.variants[0].id, quantity: 1 }] }); }}>Add included component +</button>
 {input.extras.map((extra, i) => <div key={extra.id}>{selector(`Extra ${i + 1} component`, extra.component, value => onChange({ ...input, extras: input.extras.map(e => e.id === extra.id ? { ...e, component: value } : e) }))}
        </div>)}
 </section>;
}
export function ProductCompositionSummary({ product, products }: {
    product: MerchantProduct;
    products: MerchantProduct[];
}) {
    return <>{product.choiceGroups?.map(g => <p key={g.id}>{g.name} · choose {g.min}–{g.max}: {g.extraIds.map(id => product.extras.find(e => e.id === id)?.name ?? 'Missing extra').join(', ')}
        </p>)}{product.components?.map((c, i) => { const p = products.find(p => p.id === c.productId); return <p key={i}>Includes {c.quantity} × {p?.name ?? 'Missing product'} · {p?.variants.find(v => v.id === c.variantId)?.name ?? 'Missing variant'}
        </p>; })}{product.extras.filter(e => e.component).map(e => { const c = e.component!; const p = products.find(p => p.id === c.productId); return <p key={e.id}>{e.name}: {c.quantity} × {p?.name ?? 'Missing product'} · {p?.variants.find(v => v.id === c.variantId)?.name ?? 'Missing variant'}
        </p>; })}
        </>;
}
