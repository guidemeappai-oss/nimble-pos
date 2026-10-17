import {stockMenuProjection} from './stockMenu'
import {applyRecipes} from './recipes'
import { eq } from 'drizzle-orm'
import type { MerchantProduct, MenuSchedule } from '@nimble/shared'
import { MenuScheduleConfig } from '@nimble/shared'
export { MenuScheduleConfig, defaultMenuSchedule } from '@nimble/shared'
import type { Db } from '../db/client'
import * as s from '../db/schema'
import type { z } from 'zod'
import { ScheduleRule } from '@nimble/shared'
const minutes = (v:string) => Number(v.slice(0,2))*60+Number(v.slice(3))
/** Windows are local wall-clock intervals, start inclusive/end exclusive. Overnight tails belong to their starting day; date exceptions replace the entire destination date. */
export function scheduledAvailable(rule:z.infer<typeof ScheduleRule>,timezone:string,now:Date) {
  if(rule.disabledUntil && now.getTime()<Date.parse(rule.disabledUntil)) return false
  if(!rule.weekly.length && !rule.exceptions.length) return true
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]))
  const localDate=`${p.year}-${p.month}-${p.day}`, minute=Number(p.hour)*60+Number(p.minute)
  const calendar=new Date(`${localDate}T12:00:00Z`), day=calendar.getUTCDay()
  const exception=rule.exceptions.find(x=>x.date===localDate)
  const contains=(windows:{start:string,end:string}[])=>windows.some(w=>minutes(w.start)<minutes(w.end)?minute>=minutes(w.start)&&minute<minutes(w.end):minute>=minutes(w.start))
  if(exception) return contains(exception.windows)
  if(!rule.weekly.length) return true
  const today=rule.weekly.find(x=>x.day===day)?.windows??[]
  if(contains(today)) return true
  calendar.setUTCDate(calendar.getUTCDate()-1)
  const previousDate=calendar.toISOString().slice(0,10)
  const previous=rule.exceptions.find(x=>x.date===previousDate)?.windows??rule.weekly.find(x=>x.day===(day+6)%7)?.windows??[]
  return previous.some(w=>minutes(w.start)>minutes(w.end)&&minute<minutes(w.end))
}
export function applyMenuSchedule(products:MerchantProduct[],config:MenuSchedule,now=new Date()):MerchantProduct[] {
  const available=(productId:string,kind:'product'|'variant'|'extra',optionId?:string)=>{
    const r=config.rules.find(r=>r.productId===productId&&r.kind===kind&&r.optionId===optionId)
    return !r||scheduledAvailable(r,config.timezone,now)
  }
  const scheduled = products.map(p=>{
    const variants=p.variants.filter(v=>available(p.id,'variant',v.id))
    return {...p,available:p.available&&available(p.id,'product')&&variants.length>0,variants,
      extras:p.extras.map(e=>({...e,available:e.available&&available(p.id,'extra',e.id)}))}
  })
  const componentAvailable=(ref: {productId:string;variantId:string})=>{
    const child=scheduled.find(p=>p.id===ref.productId)
    return !!child?.available&&child.variants.some(v=>v.id===ref.variantId)
  }
  return scheduled.map(p=>{
    const extras=p.extras.map(e=>({...e,available:e.available&&(!e.component||componentAvailable(e.component))}))
    return {...p,extras,available:p.available&&(p.components??[]).every(componentAvailable)&&(p.choiceGroups??[]).every(g=>g.extraIds.filter(id=>extras.some(e=>e.id===id&&e.available)).length>=g.min)}
  })
}
export async function effectiveCatalog(db:Db,venueId:string,products:MerchantProduct[],now=new Date(),includeCosts=false) {
  const [state]=await db.select().from(s.merchantMenuSchedule).where(eq(s.merchantMenuSchedule.venueId,venueId))
  const resolved=await applyRecipes(db,venueId,products,includeCosts)
  const scheduled=state?applyMenuSchedule(resolved,state.config,now):resolved
  if(includeCosts)return scheduled // Existing frozen holds are validated by the reservation transaction, not the public catalog.
  const stock=await stockMenuProjection(db,venueId,scheduled)
  return applyMenuSchedule(stock.products,state?.config??{timezone:'UTC',rules:[]},now)
}
