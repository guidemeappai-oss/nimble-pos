import type { InventoryItem, MerchantStockBinding } from '@nimble/shared'

export function StockBindingEditor({ label, bindings = [], stocks, derived, onChange }: {
  label: string
  bindings?: MerchantStockBinding[]
  stocks?: InventoryItem[]
  derived?: string[]
  onChange: (bindings: MerchantStockBinding[]) => void
}) {
  const available = stocks?.filter(item => !bindings.some(binding => binding.itemId === item.id)) ?? []
  return <fieldset className="m-soft">
    <legend>Stock · {label}</legend>
    {derived ? <><p>Resources come from the included components. Edit their variants to change stock usage.</p>{derived.map((text, i) => <p key={i}>{text}</p>)}{bindings.length > 0 && <p role="alert">Remove direct resource links before using component resources.</p>}</> : null}
    {stocks === undefined && <p>Stock resources are unavailable. Existing links are preserved; reload stock resources before changing them.</p>}
    {bindings.map((binding, index) => {
      const item = stocks?.find(item => item.id === binding.itemId)
      return <div className="m-row" key={binding.itemId}>
        <label>Stock resource for {label} {index + 1}<select disabled={!stocks || !!derived} value={binding.itemId} onChange={e => onChange(bindings.map((b, i) => i === index ? {...b,itemId:e.target.value} : b))}>
          {!item && <option value={binding.itemId}>Unavailable resource · {binding.itemId}</option>}
          {stocks?.filter(item => item.id === binding.itemId || !bindings.some(b => b.itemId === item.id)).map(item => <option key={item.id} value={item.id}>{item.name} · {item.unit.toLowerCase()}{!item.tracked ? ' · not tracked' : ''}</option>)}
        </select></label>
        <label>Stock quantity for {label} {index + 1}<input disabled={!stocks || !!derived} required type="number" min="1" max="100" step="1" value={binding.quantity} onChange={e => onChange(bindings.map((b,i) => i === index ? {...b,quantity:Number(e.target.value)} : b))}/></label>
        <button type="button" disabled={!stocks} onClick={() => onChange(bindings.filter((_,i) => i !== index))}>Remove stock resource for {label} {index + 1}</button>
      </div>
    })}
    {!derived && <button type="button" disabled={!available.length || bindings.length >= 20} onClick={() => onChange([...bindings,{itemId:available[0].id,quantity:1}])}>Add stock resource for {label}</button>}
    {!bindings.length && !derived && <p>No stock resource linked.</p>}
  </fieldset>
}
