import { ProductCompositionSummary } from './ProductCompositionEditor';
import { validateMerchantChoices } from '@nimble/shared';
import type { MerchantFiat, MerchantProduct, MerchantOrderLine } from './contract';
import { money } from './format';
function componentAvailable(component: {
    productId: string;
    variantId: string;
} | undefined, products: MerchantProduct[]) {
    if (!component)
        return true;
    const target = products.find(p => p.id === component.productId);
    return !!target?.available && target.variants.some(v => v.id === component.variantId);
}
export function validProductChoices(product: MerchantProduct, extras: string[], products: MerchantProduct[] = [], variantId?:string) {
    try {
        validateMerchantChoices(product, extras);
        const replacements=product.extras.filter(e=>extras.includes(e.id)&&e.replacesBaseRecipe);
        if(replacements.length>1 || product.variants.find(v=>v.id===variantId)?.requiresRecipeReplacement && !replacements.length)return false;
        return (product.components ?? []).every(c => componentAvailable(c, products)) && product.extras.filter(e => extras.includes(e.id)).every(e => e.available && componentAvailable(e.component, products));
    }
    catch {
        return false;
    }
}
export function ProductChoices({ product, selected, onChange, currency, products = [], disabled = false, variantId }: {
    product: MerchantProduct;
    selected: string[];
    onChange: (ids: string[]) => void;
    currency: MerchantFiat;
    products?: MerchantProduct[];
    variantId?: string;
    disabled?: boolean;
}) {
    const groups = product.choiceGroups ?? [];
    const option = (extra: MerchantProduct['extras'][number]) => {
        const group = groups.find(g => g.extraIds.includes(extra.id));
        const checked = selected.includes(extra.id);
        return <label className="m-check" key={extra.id}>
        <input type="checkbox" checked={checked} disabled={disabled || (!extra.available || !componentAvailable(extra.component, products)) || (!checked && !!group && selected.filter(id => group.extraIds.includes(id)).length >= group.max)} onChange={e => onChange(e.target.checked ? [...selected, extra.id] : selected.filter(id => id !== extra.id))}/>
        <span>{extra.name} · +{money(extra.priceMinor, currency)}{(!extra.available || !componentAvailable(extra.component, products)) && ' · unavailable'}
        </span>
        </label>;
    };
    return <>
        <ProductCompositionSummary product={product} products={products}/>{groups.map(group => <fieldset key={group.id}>
        <legend>{group.name} · choose {group.min}–{group.max}{group.min > 0 ? ' · required' : ''}
        </legend>{product.extras.filter(e => group.extraIds.includes(e.id)).map(option)}
        </fieldset>)}{product.extras.filter(e => !groups.some(g => g.extraIds.includes(e.id))).map(option)}{!validProductChoices(product, selected, products,variantId) && <p role="status">Complete the required choices using available components before adding to the basket.</p>}
        </>;
}
export function OrderComposition({ line }: {
    line: MerchantOrderLine;
}) { return <>{line.components?.map((c, i) => <small key={i} className="m-muted"> · {c.quantity * line.quantity} × {c.productName} ({c.variantName})</small>)}
        </>; }
