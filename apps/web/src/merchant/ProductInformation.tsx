import { MENU_ALLERGENS, MENU_LANGUAGES, menuInformation, type MerchantProduct, type MenuInformation } from '@nimble/shared'
import { locale } from '../i18n'
export function ProductInformation({product,products,language=locale}:{product:MerchantProduct;products:MerchantProduct[];language?:string}) {
 const info=menuInformation(product,products,language)
 return <span className="m-product-information">
  {info.name!==product.name && <strong lang={info.language}>{info.name}</strong>}
  {info.description && <span lang={info.language}>{info.description}</span>}
  {info.fallback && <small>Translation unavailable · showing {info.language.toUpperCase()}</small>}
  <small>Allergens{product.components?.length || product.extras.some(e=>e.component) ? ' · all possible components and choices' : ''}: {info.allergens.length?info.allergens.join(', '):info.allergensKnown?'none declared by the venue':'unknown'}</small>
  {!info.allergensKnown && <small>Allergen information incomplete. Ask staff before ordering.</small>}
 </span>
}
export function ProductInformationEditor({value,onChange}:{value?:MenuInformation;onChange:(value:MenuInformation)=>void}) {
 const info:MenuInformation=value??{sourceLanguage:'en',allergensReviewed:false,allergens:[],translations:{}}
 const update=(next:Partial<MenuInformation>)=>onChange({...info,...next})
 return <fieldset><legend>Product information · approved with menu publication</legend>
  <label>Source language<select value={info.sourceLanguage} onChange={e=>update({sourceLanguage:e.target.value as MenuInformation['sourceLanguage']})}>{MENU_LANGUAGES.map(l=><option key={l}>{l}</option>)}</select></label>
  <label>Product description<textarea maxLength={2000} value={info.description??''} onChange={e=>update({description:e.target.value})}/></label>
  <p>Declare allergens for every variant and non-product add-on. Linked products and all possible choices are included automatically. Missing data is unknown.</p>
  {MENU_ALLERGENS.map(a=><label key={a}><input type="checkbox" checked={info.allergens.includes(a)} onChange={e=>update({allergens:e.target.checked?[...info.allergens,a]:info.allergens.filter(v=>v!==a),allergensReviewed:false})}/>{a}</label>)}
  <label><input type="checkbox" checked={info.allergensReviewed} onChange={e=>update({allergensReviewed:e.target.checked})}/>I reviewed allergens for all variants and add-ons</label>
  {MENU_LANGUAGES.filter(l=>l!==info.sourceLanguage).map(l=><fieldset key={l}><legend>Translation · {l.toUpperCase()}</legend><label>{l.toUpperCase()} product name<input maxLength={120} value={info.translations[l]?.name??''} onChange={e=>{const translations={...info.translations};if(e.target.value.trim())translations[l]={...translations[l],name:e.target.value};else delete translations[l];update({translations})}}/></label><label>{l.toUpperCase()} description<textarea maxLength={2000} disabled={!info.translations[l]} value={info.translations[l]?.description??''} onChange={e=>update({translations:{...info.translations,[l]:{name:info.translations[l]!.name,description:e.target.value}}})}/></label></fieldset>)}
 </fieldset>
}
