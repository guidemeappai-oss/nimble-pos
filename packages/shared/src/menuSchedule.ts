import { z } from 'zod'
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const window = z.object({ start: time, end: time }).strict().refine(w => w.start !== w.end, 'Use separate windows; equal times are ambiguous')
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, 'Invalid date')
export const ScheduleRule = z.object({
  productId: z.string().uuid(), kind: z.enum(['product','variant','extra']), optionId: z.string().uuid().optional(),
  weekly: z.array(z.object({ day: z.number().int().min(0).max(6), windows: z.array(window).max(12) }).strict()).max(7),
  exceptions: z.array(z.object({ date, windows: z.array(window).max(12) }).strict()).max(100),
  disabledUntil: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((v,ctx) => {
  if ((v.kind === 'product') === !!v.optionId) ctx.addIssue({ code:'custom',message:'Option identity required only for variants and extras' })
  if (new Set(v.weekly.map(w=>w.day)).size !== v.weekly.length || new Set(v.exceptions.map(w=>w.date)).size !== v.exceptions.length) ctx.addIssue({code:'custom',message:'Duplicate days or exceptions'})
})
export const MenuScheduleConfig = z.object({
  timezone: z.string().max(100).refine(value => {try {new Intl.DateTimeFormat('en',{timeZone:value});return true}catch{return false}}, 'Invalid timezone'),
  rules: z.array(ScheduleRule).max(1000),
}).strict().superRefine((v,ctx)=>{
  if(new Set(v.rules.map(r=>`${r.productId}:${r.kind}:${r.optionId??''}`)).size!==v.rules.length) ctx.addIssue({code:'custom',message:'Duplicate schedule targets'})
})
export type MenuSchedule = z.infer<typeof MenuScheduleConfig>
export const defaultMenuSchedule: MenuSchedule = { timezone:'Europe/Warsaw',rules:[] }
export type MenuScheduleView = MenuSchedule & { revision:number }
