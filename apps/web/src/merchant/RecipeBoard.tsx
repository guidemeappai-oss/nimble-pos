import {useRef,useState} from 'react';
import {RecipeUnit,type RecipeInput,type RecipeVersion,type InventoryItem} from '@nimble/shared';
import type {MerchantApi} from './client';
import {merchantError} from './errors';
import {t} from '../i18n';
type Props={api:MerchantApi;venueId:string;cashier:boolean;recipes:RecipeVersion[];stocks?:InventoryItem[];onCreated:(r:RecipeVersion)=>void};
export function RecipeBoard({api,venueId,cashier,recipes,stocks,onCreated}:Props){
 const [recipeId,setRecipeId]=useState(''),[name,setName]=useState(''),[reason,setReason]=useState(''),[ingredients,setIngredients]=useState<RecipeInput['ingredients']>([]),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const retry=useRef<{signature:string;key:string}|null>(null),locked=useRef(false);
 // The containing workspace remounts on venue/session changes; ignore late mutations after it unmounts.
 const mount=useRef<HTMLFormElement|null>(null);
 const choose=(id:string)=>{setRecipeId(id);const r=recipes.find(r=>r.recipeId===id);setName(r?.name??'');setIngredients(r?.ingredients??[]);setReason('');setError(null)};
 const save=async()=>{
  if(locked.current)return;
  const payload={...(recipeId?{recipeId}:{}),name:name.trim(),reason:reason.trim(),ingredients};const signature=JSON.stringify(payload);
  if(retry.current?.signature!==signature)retry.current={signature,key:crypto.randomUUID()};
  locked.current=true;setBusy(true);setError(null);
  try{const r=await api.request<RecipeVersion>(cashier?'cashier':'owner','POST',`/venues/${venueId}/recipes`,{...payload,idempotencyKey:retry.current.key});if(mount.current){onCreated(r);choose('');retry.current=null;}}
  catch(e){if(mount.current)setError(merchantError(e))}finally{locked.current=false;if(mount.current)setBusy(false)}
 };
 const update=(index:number,row:RecipeInput['ingredients'][number])=>setIngredients(old=>old.map((i,n)=>n===index?row:i));
 const families=recipes.filter((r,i)=>recipes.findIndex(v=>v.recipeId===r.recipeId)===i);
 return <section className="m-panel"><h3>{t('Recipes')}</h3><p>{t('Recipe versions are immutable. Publishing a new version does not change existing products or orders. Select the version explicitly in the product editor.')}</p>
 <form ref={mount} onSubmit={e=>{e.preventDefault();void save()}}><fieldset disabled={busy}><label>{t('Recipe to version')}<select value={recipeId} onChange={e=>choose(e.target.value)}><option value="">{t('New recipe')}</option>{families.map(r=><option key={r.recipeId} value={r.recipeId}>{r.name} · v{r.version}</option>)}</select></label><label>{t('Recipe name')}<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
 {ingredients.map((row,index)=><fieldset key={index}><legend>{t('Ingredient')} {index+1}</legend><select aria-label={`${t('Ingredient type')} ${index+1}`} value={row.kind} onChange={e=>update(index,e.target.value==='ITEM'?{kind:'ITEM',itemId:stocks?.[0]?.id??'',quantity:'1',unit:'g'}:{kind:'RECIPE',recipeVersionId:recipes[0]?.id??'',quantity:1})}><option value="ITEM">{t('Stock resource')}</option><option value="RECIPE">{t('Recipe version')}</option></select>
 {row.kind==='ITEM'?<><select aria-label={`${t('Ingredient resource')} ${index+1}`} required value={row.itemId} onChange={e=>update(index,{...row,itemId:e.target.value})}><option value="">{t('Choose stock item')}</option>{stocks?.map(s=><option key={s.id} value={s.id}>{s.name} · {s.unit}</option>)}</select><input aria-label={`${t('Ingredient quantity')} ${index+1}`} required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,3})?" value={row.quantity} onChange={e=>update(index,{...row,quantity:e.target.value})}/><select aria-label={`${t('Ingredient unit')} ${index+1}`} value={row.unit} onChange={e=>update(index,{...row,unit:e.target.value as typeof row.unit})}>{RecipeUnit.options.map(u=><option key={u}>{u}</option>)}</select></>:<><select aria-label={`${t('Nested recipe')} ${index+1}`} required value={row.recipeVersionId} onChange={e=>update(index,{...row,recipeVersionId:e.target.value})}><option value="">{t('Choose recipe')}</option>{recipes.map(r=><option key={r.id} value={r.id}>{r.name} · v{r.version}</option>)}</select><input aria-label={`${t('Recipe portions')} ${index+1}`} required type="number" min="1" max="100" value={row.quantity} onChange={e=>update(index,{...row,quantity:Number(e.target.value)})}/></>}
 <button type="button" onClick={()=>setIngredients(old=>old.filter((_,i)=>i!==index))}>{t('Remove ingredient')}</button></fieldset>)}
 <button type="button" disabled={!stocks?.length||ingredients.length>=20} onClick={()=>setIngredients(old=>[...old,{kind:'ITEM',itemId:stocks![0].id,quantity:'1',unit:stocks![0].unit==='PIECE'?'piece':stocks![0].unit==='PORTION'?'portion':stocks![0].unit==='MILLILITRE'?'ml':'g'}])}>{t('Add ingredient')}</button><label>{t('Reason')}<input required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={!ingredients.length}>{t('Save recipe version')}</button></fieldset>{error&&<p role="alert">{error}</p>}</form>
 {recipes.map(r=><article className="m-soft" key={r.id}><strong>{r.name} · v{r.version}</strong>{r.requirements.map(b=><p key={b.itemId}>{stocks?.find(s=>s.id===b.itemId)?.name??b.itemId}: {b.quantity} {stocks?.find(s=>s.id===b.itemId)?.unit}</p>)}<p>{t('Cost unavailable; no zero-cost assumption.')}</p></article>)}
 </section>;
}
