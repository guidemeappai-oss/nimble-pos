import {expect,it} from 'vitest'
import {applyMenuSchedule,MenuScheduleConfig,scheduledAvailable} from '../src/services/menuSchedule'
const productId='00000000-0000-4000-8000-000000000001'
const rule={productId,kind:'product' as const,weekly:[{day:6,windows:[{start:'22:00',end:'03:00'}]}],exceptions:[],disabledUntil:null}
it('serves an overnight window across a weekday and both occurrences of the DST repeated hour',()=>{
 expect(scheduledAvailable(rule,'Europe/Warsaw',new Date('2026-10-25T00:30:00Z'))).toBe(true)
 expect(scheduledAvailable(rule,'Europe/Warsaw',new Date('2026-10-25T01:30:00Z'))).toBe(true)
 expect(scheduledAvailable(rule,'Europe/Warsaw',new Date('2026-10-25T02:00:00Z'))).toBe(false)
 expect(scheduledAvailable(rule,'Europe/Warsaw',new Date('2026-03-29T00:30:00Z'))).toBe(true)
 expect(scheduledAvailable(rule,'Europe/Warsaw',new Date('2026-03-29T01:00:00Z'))).toBe(false)
})
it('date closures override incoming overnight windows and timed return respects recurring restrictions',()=>{
 expect(scheduledAvailable({...rule,exceptions:[{date:'2026-10-25',windows:[]}]},'Europe/Warsaw',new Date('2026-10-25T00:30:00Z'))).toBe(false)
 expect(scheduledAvailable({...rule,disabledUntil:'2026-10-25T00:00:00Z'},'Europe/Warsaw',new Date('2026-10-25T03:00:00Z'))).toBe(false)
 expect(scheduledAvailable({...rule,disabledUntil:'2026-10-25T02:00:00Z'},'Europe/Warsaw',new Date('2026-10-25T00:30:00Z'))).toBe(false)
})
it('never restores manually missing stock and removes scheduled variants from new cart options only',()=>{
 const products=[{id:productId,name:'Coffee',category:'Drinks',available:false,variants:[{id:'large',name:'Large',priceMinor:100}],extras:[]}]
 const result=applyMenuSchedule(products,{timezone:'Europe/Warsaw',rules:[]})
 expect(result[0].available).toBe(false)
 expect(products[0].variants).toHaveLength(1)
 const disabled=applyMenuSchedule([{...products[0],available:true}],{timezone:'Europe/Warsaw',rules:[{...rule,kind:'variant',optionId:'large',weekly:[],disabledUntil:'2099-01-01T00:00:00Z'}]})
 expect(disabled[0].variants).toEqual([])
 expect(disabled[0].available).toBe(false)
})
it('rejects invalid zones, duplicate weekdays and impossible calendar dates',()=>{
 expect(MenuScheduleConfig.safeParse({timezone:'invalid',rules:[]}).success).toBe(false)
 expect(MenuScheduleConfig.safeParse({timezone:'Europe/Warsaw',rules:[{...rule,weekly:[...rule.weekly,...rule.weekly]}]}).success).toBe(false)
 expect(MenuScheduleConfig.safeParse({timezone:'Europe/Warsaw',rules:[{...rule,exceptions:[{date:'2026-02-30',windows:[]}]}]}).success).toBe(false)
})

it('a single date exception does not close every other date',()=>{
 expect(scheduledAvailable({...rule,weekly:[],exceptions:[{date:'2026-10-25',windows:[]}]},'Europe/Warsaw',new Date('2026-10-26T10:00:00Z'))).toBe(true)
})
it('propagates a paused component to its fixed bundle and required choices',()=>{
 const child={id:productId,name:'Coffee',category:'Drinks',available:true,variants:[{id:'cup',name:'Cup',priceMinor:100}],extras:[]}
 const fixed={...child,id:'fixed',components:[{productId,variantId:'cup',quantity:1}]}
 const choices={...child,id:'choices',extras:[{id:'coffee',name:'Coffee option',priceMinor:0,available:true,component:{productId,variantId:'cup',quantity:1}}],choiceGroups:[{id:'required',name:'Choose drink',min:1,max:1,extraIds:['coffee']}]}
 const result=applyMenuSchedule([child,fixed,choices],{timezone:'Europe/Warsaw',rules:[{...rule,weekly:[],disabledUntil:'2099-01-01T00:00:00Z'}]})
 expect(result.map(p=>p.available)).toEqual([false,false,false])
 expect(result[2].extras[0].available).toBe(false)
})
