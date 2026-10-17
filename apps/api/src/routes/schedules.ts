import { and, asc, desc, eq, inArray, max } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { MerchantPermission } from '@nimble/shared'
import type { Db } from '../db/client'
import * as s from '../db/schema'

type Actor = { kind: 'owner'; userId: string } | { kind: 'cashier'; employeeId: string; venueId: string; name?: string; permissions?: MerchantPermission[] }
type Store = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>
type Helpers = {
  actor(req: FastifyRequest): Promise<Actor>
  venueFor(actor: Actor, venueId: string, ownerOnly?: boolean, store?: any): Promise<typeof s.merchantVenue.$inferSelect>
  audit(store: any, actor: Actor, venueId: string, action: string, reason: string, before: unknown, after: unknown): Promise<void>
}

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const iso = z.string().datetime({ offset: true })
const coverageInput = z.array(z.object({ startsAt: iso, endsAt: iso, minimumWorkers: z.number().int().min(1).max(20).default(1) })).max(100)
const shiftInput = z.array(z.object({ employeeId: z.string().uuid(), startsAt: iso, endsAt: iso, role: z.string().trim().min(1).max(60) })).max(300)
const createInput = z.object({ weekStart: dateText, timeZone: z.string().trim().min(3).max(80), coverageHours: coverageInput, shifts: shiftInput, idempotencyKey: z.string().uuid() })
const shiftView = (x: typeof s.merchantScheduleShift.$inferSelect) => ({ id: x.id, employeeId: x.employeeId, startsAt: x.startsAt.toISOString(), endsAt: x.endsAt.toISOString(), role: x.role })
const canonicalCoverage = (hours: { startsAt: string; endsAt: string; minimumWorkers?: number }[]) => JSON.stringify(hours.map(x => ({ startsAt: new Date(x.startsAt).toISOString(), endsAt: new Date(x.endsAt).toISOString(), minimumWorkers: x.minimumWorkers ?? 1 })).sort((a, b) => a.startsAt.localeCompare(b.startsAt)))
const canonicalShifts = (shifts: { employeeId: string; startsAt: string; endsAt: string; role: string }[]) => JSON.stringify(shifts.map(x => ({ employeeId: x.employeeId, startsAt: new Date(x.startsAt).toISOString(), endsAt: new Date(x.endsAt).toISOString(), role: x.role })).sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.employeeId.localeCompare(b.employeeId)))

function zonedLocalInstant(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split('-').map(Number), [hour, minute] = time.split(':').map(Number)
  const target = Date.UTC(year, month - 1, day, hour, minute)
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const offsets = new Set<number>()
  for (let offset = -36 * 60; offset <= 36 * 60; offset += 30) {
    const probe = target + offset * 60_000
    const parts = Object.fromEntries(formatter.formatToParts(new Date(probe)).map(x => [x.type, x.value]))
    offsets.add(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) - probe)
  }
  const matches = [...offsets].map(offset => target - offset).filter(instant => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(x => [x.type, x.value]))
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) === target
  })
  if (!matches.length) throw Object.assign(new Error('NONEXISTENT_LOCAL_TIME'), { status: 400, code: 'VALIDATION' })
  if (matches.length > 1) throw Object.assign(new Error('AMBIGUOUS_LOCAL_TIME'), { status: 400, code: 'VALIDATION' })
  return new Date(matches[0])
}
function localParts(instant: number, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return Object.fromEntries(formatter.formatToParts(new Date(instant)).map(x => [x.type, x.value]))
}
function weekBounds(weekStart: string, timeZone: string) {
  const calendarDate = new Date(`${weekStart}T00:00:00.000Z`)
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.getUTCDay() !== 1 || calendarDate.toISOString().slice(0, 10) !== weekStart) throw Object.assign(new Error('INVALID_WEEK_START'), { status: 400, code: 'VALIDATION' })
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(calendarDate)
  } catch {
    throw Object.assign(new Error('INVALID_TIME_ZONE'), { status: 400, code: 'VALIDATION' })
  }
  const start = zonedLocalInstant(weekStart, '00:00', timeZone)
  const next = new Date(calendarDate.getTime() + 7 * 86400000).toISOString().slice(0, 10)
  return { start, end: zonedLocalInstant(next, '00:00', timeZone), calendarDate }
}

function diagnostics(weekStart: string, timeZone: string, hours: { startsAt: string; endsAt: string; minimumWorkers?: number }[], shifts: { employeeId: string; startsAt: string; endsAt: string }[]) {
  const { start: week, end: weekEnd, calendarDate } = weekBounds(weekStart, timeZone)
  const conflicts: { employeeId: string; firstShift: number; secondShift: number }[] = []
  for (let i = 0; i < shifts.length; i++) {
    const a = shifts[i], aStart = Date.parse(a.startsAt), aEnd = Date.parse(a.endsAt)
    if (!(aStart < aEnd) || aStart < week.getTime() || aEnd > weekEnd.getTime()) throw Object.assign(new Error('INVALID_SHIFT_RANGE'), { status: 400, code: 'VALIDATION' })
    for (let j = i + 1; j < shifts.length; j++) {
      const b = shifts[j]
      if (a.employeeId === b.employeeId && aStart < Date.parse(b.endsAt) && Date.parse(b.startsAt) < aEnd) conflicts.push({ employeeId: a.employeeId, firstShift: i, secondShift: j })
    }
  }
  for (const h of hours) {
    if (!(Date.parse(h.startsAt) < Date.parse(h.endsAt)) || Date.parse(h.startsAt) < week.getTime() || Date.parse(h.endsAt) > weekEnd.getTime()) throw Object.assign(new Error('INVALID_COVERAGE_RANGE'), { status: 400, code: 'VALIDATION' })
  }
  if (conflicts.length) throw Object.assign(new Error('SCHEDULE_CONFLICT'), { status: 409, code: 'SCHEDULE_CONFLICT', conflicts })
  const uncovered: { day: number; from: string; to: string; missingWorkers: number; startsAt: string; endsAt: string }[] = []
  for (const h of hours) {
    const hStart = Date.parse(h.startsAt), hEnd = Date.parse(h.endsAt)
    const points = [...new Set([hStart, hEnd, ...shifts.flatMap(x => [Date.parse(x.startsAt), Date.parse(x.endsAt)]).filter(x => x > hStart && x < hEnd)])].sort((a, b) => a - b)
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i], to = points[i + 1]
      if (from >= to) continue
      const active = shifts.filter(x => Date.parse(x.startsAt) <= from && Date.parse(x.endsAt) >= to).length
      const missing = Math.max(0, (h.minimumWorkers ?? 1) - active)
      if (!missing) continue
      const previous = uncovered[uncovered.length - 1]
      if (previous && previous.endsAt === new Date(from).toISOString() && previous.missingWorkers === missing) {
        previous.endsAt = new Date(to).toISOString(); previous.to = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(to))
      } else {
        const fromLocal = localParts(from, timeZone), toLocal = localParts(to, timeZone)
        const localDate = Date.UTC(Number(fromLocal.year), Number(fromLocal.month) - 1, Number(fromLocal.day))
        uncovered.push({ day: Math.floor((localDate - calendarDate.getTime()) / 86400000), from: `${fromLocal.hour}:${fromLocal.minute}`, to: `${toLocal.hour}:${toLocal.minute}`, missingWorkers: missing, startsAt: new Date(from).toISOString(), endsAt: new Date(to).toISOString() })
      }
    }
  }
  return { conflicts: [], uncovered }
}

export async function scheduleRoutes(app: FastifyInstance, h: Helpers) {
  const { db } = app.deps
  const requireManager = async (req: FastifyRequest, venueId: string) => {
    const a = await h.actor(req)
    const venue = await h.venueFor(a, venueId)
    if (a.kind === 'cashier' && !a.permissions?.includes('schedule.manage')) throw Object.assign(new Error('FORBIDDEN'), { status: 403, code: 'FORBIDDEN' })
    return { a, venue }
  }
  const scheduleFor = async (store: Store, venueId: string, weekStart: string) => {
    const [schedule] = await store.select().from(s.merchantSchedule).where(and(eq(s.merchantSchedule.venueId, venueId), eq(s.merchantSchedule.weekStart, weekStart), eq(s.merchantSchedule.status, 'PUBLISHED'))).orderBy(desc(s.merchantSchedule.version)).limit(1)
    if (!schedule) return null
    const shifts = await store.select().from(s.merchantScheduleShift).where(eq(s.merchantScheduleShift.scheduleId, schedule.id)).orderBy(asc(s.merchantScheduleShift.startsAt))
    return { id: schedule.id, venueId: schedule.venueId, weekStart: schedule.weekStart, timeZone: schedule.timeZone, version: schedule.version, status: schedule.status, coverageHours: schedule.coverageHours, coverage: diagnostics(schedule.weekStart, schedule.timeZone, schedule.coverageHours, shifts.map(x => ({ employeeId: x.employeeId, startsAt: x.startsAt.toISOString(), endsAt: x.endsAt.toISOString() }))), shifts: shifts.map(shiftView), publishedAt: schedule.publishedAt?.toISOString() ?? null }
  }
  const loadDraft = async (store: Store, schedule: typeof s.merchantSchedule.$inferSelect) => {
    const shifts = await store.select().from(s.merchantScheduleShift).where(eq(s.merchantScheduleShift.scheduleId, schedule.id)).orderBy(asc(s.merchantScheduleShift.startsAt))
    return { id: schedule.id, venueId: schedule.venueId, weekStart: schedule.weekStart, timeZone: schedule.timeZone, version: schedule.version, status: schedule.status, coverageHours: schedule.coverageHours, coverage: diagnostics(schedule.weekStart, schedule.timeZone, schedule.coverageHours, shifts.map(x => ({ employeeId: x.employeeId, startsAt: x.startsAt.toISOString(), endsAt: x.endsAt.toISOString() }))), shifts: shifts.map(shiftView), publishedAt: schedule.publishedAt?.toISOString() ?? null }
  }

  app.get('/v1/merchant/schedule/me', async (req) => {
    const a = await h.actor(req)
    if (a.kind !== 'cashier') throw Object.assign(new Error('CASHIER_REQUIRED'), { status: 403, code: 'CASHIER_REQUIRED' })
    const query = z.object({ weekStart: dateText }).parse(req.query)
    const schedule = await scheduleFor(db, a.venueId, query.weekStart)
    const employees = await db.select({ id: s.merchantEmployee.id, name: s.merchantEmployee.name, active: s.merchantEmployee.active }).from(s.merchantEmployee).where(and(eq(s.merchantEmployee.venueId, a.venueId), eq(s.merchantEmployee.active, true))).orderBy(asc(s.merchantEmployee.name))
    return { schedule: schedule ? { id: schedule.id, weekStart: schedule.weekStart, timeZone: schedule.timeZone, version: schedule.version, status: schedule.status, publishedAt: schedule.publishedAt } : null, shifts: schedule?.shifts.filter(x => x.employeeId === a.employeeId) ?? [], employees }
  })

  app.get('/v1/merchant/venues/:venueId/schedules/:weekStart', async (req) => {
    const params = z.object({ venueId: z.string().uuid(), weekStart: dateText }).parse(req.params)
    const { a } = await requireManager(req, params.venueId)
    const [latest] = await db.select().from(s.merchantSchedule).where(and(eq(s.merchantSchedule.venueId, params.venueId), eq(s.merchantSchedule.weekStart, params.weekStart))).orderBy(desc(s.merchantSchedule.version)).limit(1)
    const schedule = latest ? await loadDraft(db, latest) : null
    const pending = await db.select({ request: s.merchantSubstitution }).from(s.merchantSubstitution).innerJoin(s.merchantSchedule, eq(s.merchantSchedule.id, s.merchantSubstitution.scheduleId)).where(and(eq(s.merchantSubstitution.venueId, params.venueId), eq(s.merchantSchedule.weekStart, params.weekStart), eq(s.merchantSubstitution.status, 'PENDING'))).orderBy(asc(s.merchantSubstitution.createdAt)).then(rows => rows.map(x => x.request))
    const employees = await db.select({ id: s.merchantEmployee.id, name: s.merchantEmployee.name, active: s.merchantEmployee.active }).from(s.merchantEmployee).where(eq(s.merchantEmployee.venueId, params.venueId)).orderBy(asc(s.merchantEmployee.name))
    return { schedule, employees, pendingSubstitutions: pending.map(x => ({ ...x, createdAt: x.createdAt.toISOString(), reviewedAt: x.reviewedAt?.toISOString() ?? null })) , actor: a.kind }
  })

  app.post('/v1/merchant/venues/:venueId/schedules', async (req, reply) => {
    const params = z.object({ venueId: z.string().uuid() }).parse(req.params)
    const input = createInput.parse(req.body)
    const { a, venue } = await requireManager(req, params.venueId)
    const diag = diagnostics(input.weekStart, input.timeZone, input.coverageHours, input.shifts)
    const employeeIds = [...new Set(input.shifts.map(x => x.employeeId))]
    if (employeeIds.length) {
      const employees = await db.select({ id: s.merchantEmployee.id }).from(s.merchantEmployee).where(and(eq(s.merchantEmployee.venueId, venue.id), eq(s.merchantEmployee.active, true), inArray(s.merchantEmployee.id, employeeIds)))
      if (employees.length !== employeeIds.length) throw Object.assign(new Error('INVALID_EMPLOYEE'), { status: 400, code: 'INVALID_EMPLOYEE' })
    }
    const result = await db.transaction(async tx => {
      const [existing] = await tx.select().from(s.merchantSchedule).where(and(eq(s.merchantSchedule.venueId, venue.id), eq(s.merchantSchedule.requestKey, input.idempotencyKey)))
      if (existing) {
        const prior = await loadDraft(tx, existing)
        if (prior.weekStart !== input.weekStart || prior.timeZone !== input.timeZone || canonicalCoverage(prior.coverageHours) !== canonicalCoverage(input.coverageHours) || canonicalShifts(prior.shifts) !== canonicalShifts(input.shifts)) throw Object.assign(new Error('IDEMPOTENCY_KEY_REUSED'), { status: 409, code: 'IDEMPOTENCY_KEY_REUSED' })
        return { schedule: prior, replay: true }
      }
      await tx.select({ id: s.merchantVenue.id }).from(s.merchantVenue).where(eq(s.merchantVenue.id, venue.id)).for('update')
      const [afterLock] = await tx.select().from(s.merchantSchedule).where(and(eq(s.merchantSchedule.venueId, venue.id), eq(s.merchantSchedule.requestKey, input.idempotencyKey)))
      if (afterLock) {
        const prior = await loadDraft(tx, afterLock)
        if (prior.weekStart !== input.weekStart || prior.timeZone !== input.timeZone || canonicalCoverage(prior.coverageHours) !== canonicalCoverage(input.coverageHours) || canonicalShifts(prior.shifts) !== canonicalShifts(input.shifts)) throw Object.assign(new Error('IDEMPOTENCY_KEY_REUSED'), { status: 409, code: 'IDEMPOTENCY_KEY_REUSED' })
        return { schedule: prior, replay: true }
      }
      const [latest] = await tx.select({ version: max(s.merchantSchedule.version) }).from(s.merchantSchedule).where(and(eq(s.merchantSchedule.venueId, venue.id), eq(s.merchantSchedule.weekStart, input.weekStart)))
      const [created] = await tx.insert(s.merchantSchedule).values({ venueId: venue.id, weekStart: input.weekStart, timeZone: input.timeZone, version: Number(latest.version ?? 0) + 1, requestKey: input.idempotencyKey, coverageHours: input.coverageHours, createdByEmployeeId: a.kind === 'cashier' ? a.employeeId : null, createdByOwnerId: a.kind === 'owner' ? a.userId : null }).returning()
      const entries = input.shifts.length ? await tx.insert(s.merchantScheduleShift).values(input.shifts.map(x => ({ scheduleId: created.id, venueId: venue.id, employeeId: x.employeeId, startsAt: new Date(x.startsAt), endsAt: new Date(x.endsAt), role: x.role }))).returning() : []
      await h.audit(tx, a, venue.id, 'schedule.draft.created', 'Schedule draft created', null, { scheduleId: created.id, weekStart: created.weekStart, version: created.version, shifts: entries.length, uncovered: diag.uncovered.length })
      return { schedule: await loadDraft(tx, created), replay: false }
    })
    return reply.code(result.replay ? 200 : 201).send(result.schedule)
  })

  app.post('/v1/merchant/venues/:venueId/schedules/:scheduleId/publish', async (req) => {
    const params = z.object({ venueId: z.string().uuid(), scheduleId: z.string().uuid() }).parse(req.params)
    const { a, venue } = await requireManager(req, params.venueId)
    return db.transaction(async tx => {
      await tx.select({ id: s.merchantVenue.id }).from(s.merchantVenue).where(eq(s.merchantVenue.id, venue.id)).for('update')
      const [draft] = await tx.select().from(s.merchantSchedule).where(and(eq(s.merchantSchedule.id, params.scheduleId), eq(s.merchantSchedule.venueId, venue.id))).for('update')
      if (!draft) throw Object.assign(new Error('NOT_FOUND'), { status: 404, code: 'NOT_FOUND' })
      if (draft.status === 'PUBLISHED') return loadDraft(tx, draft)
      const current = await scheduleFor(tx, venue.id, draft.weekStart)
      if (current && current.version > draft.version) throw Object.assign(new Error('SCHEDULE_STALE'), { status: 409, code: 'SCHEDULE_STALE' })
      const entries = await tx.select().from(s.merchantScheduleShift).where(eq(s.merchantScheduleShift.scheduleId, draft.id))
      if (entries.length) {
        const active = await tx.select({ id: s.merchantEmployee.id }).from(s.merchantEmployee).where(and(eq(s.merchantEmployee.venueId, venue.id), eq(s.merchantEmployee.active, true), inArray(s.merchantEmployee.id, [...new Set(entries.map(x => x.employeeId))])))
        if (active.length !== new Set(entries.map(x => x.employeeId)).size) throw Object.assign(new Error('SCHEDULE_EMPLOYEE_INACTIVE'), { status: 409, code: 'SCHEDULE_EMPLOYEE_INACTIVE' })
      }
      const coverage = diagnostics(draft.weekStart, draft.timeZone, draft.coverageHours, entries.map(x => ({ employeeId: x.employeeId, startsAt: x.startsAt.toISOString(), endsAt: x.endsAt.toISOString() })))
      const [updated] = await tx.update(s.merchantSchedule).set({ status: 'PUBLISHED', publishedAt: new Date() }).where(eq(s.merchantSchedule.id, draft.id)).returning()
      await h.audit(tx, a, venue.id, 'schedule.published', 'Schedule published', { id: draft.id, status: draft.status }, { id: draft.id, version: draft.version, status: updated.status, uncovered: coverage.uncovered.length })
      return loadDraft(tx, updated)
    })
  })

  app.post('/v1/merchant/venues/:venueId/schedules/:scheduleId/shifts/:shiftId/substitutions', async (req, reply) => {
    const params = z.object({ venueId: z.string().uuid(), scheduleId: z.string().uuid(), shiftId: z.string().uuid() }).parse(req.params)
    const input = z.object({ substituteEmployeeId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).parse(req.body)
    const a = await h.actor(req)
    if (a.kind !== 'cashier') throw Object.assign(new Error('CASHIER_REQUIRED'), { status: 403, code: 'CASHIER_REQUIRED' })
    const venue = await h.venueFor(a, params.venueId)
    const [slot] = await db.select({ employeeId: s.merchantScheduleShift.employeeId, weekStart: s.merchantSchedule.weekStart }).from(s.merchantScheduleShift).innerJoin(s.merchantSchedule, eq(s.merchantSchedule.id, s.merchantScheduleShift.scheduleId)).where(and(eq(s.merchantScheduleShift.id, params.shiftId), eq(s.merchantScheduleShift.scheduleId, params.scheduleId), eq(s.merchantScheduleShift.venueId, venue.id), eq(s.merchantSchedule.status, 'PUBLISHED')))
    if (!slot || slot.employeeId !== a.employeeId) throw Object.assign(new Error('NOT_FOUND'), { status: 404, code: 'NOT_FOUND' })
    const current = await scheduleFor(db, venue.id, slot.weekStart)
    if (!current || current.id !== params.scheduleId) throw Object.assign(new Error('SCHEDULE_STALE'), { status: 409, code: 'SCHEDULE_STALE' })
    if (input.substituteEmployeeId === a.employeeId) throw Object.assign(new Error('INVALID_SUBSTITUTE'), { status: 400, code: 'INVALID_SUBSTITUTE' })
    const [substitute] = await db.select({ id: s.merchantEmployee.id }).from(s.merchantEmployee).where(and(eq(s.merchantEmployee.id, input.substituteEmployeeId), eq(s.merchantEmployee.venueId, venue.id), eq(s.merchantEmployee.active, true)))
    if (!substitute) throw Object.assign(new Error('INVALID_SUBSTITUTE'), { status: 400, code: 'INVALID_SUBSTITUTE' })
    const result = await db.transaction(async tx => {
      await tx.select({ id: s.merchantVenue.id }).from(s.merchantVenue).where(eq(s.merchantVenue.id, venue.id)).for('update')
      const current = await scheduleFor(tx, venue.id, slot.weekStart)
      if (current?.id !== params.scheduleId) throw Object.assign(new Error('SCHEDULE_STALE'), { status: 409, code: 'SCHEDULE_STALE' })
      await tx.select({ id: s.merchantScheduleShift.id }).from(s.merchantScheduleShift).where(and(eq(s.merchantScheduleShift.id, params.shiftId), eq(s.merchantScheduleShift.scheduleId, params.scheduleId))).for('update')
      const [existing] = await tx.select().from(s.merchantSubstitution).where(and(eq(s.merchantSubstitution.scheduleShiftId, params.shiftId), eq(s.merchantSubstitution.status, 'PENDING')))
      if (existing) {
        if (existing.requestedByEmployeeId !== a.employeeId || existing.substituteEmployeeId !== input.substituteEmployeeId || existing.reason !== input.reason) throw Object.assign(new Error('SUBSTITUTION_ALREADY_PENDING'), { status: 409, code: 'SUBSTITUTION_ALREADY_PENDING' })
        return existing
      }
      const [created] = await tx.insert(s.merchantSubstitution).values({ venueId: venue.id, scheduleId: params.scheduleId, scheduleShiftId: params.shiftId, requestedByEmployeeId: a.employeeId, substituteEmployeeId: input.substituteEmployeeId, reason: input.reason }).returning()
      await h.audit(tx, a, venue.id, 'schedule.substitution.requested', 'Employee requested a shift substitute', null, { requestId: created.id, shiftId: params.shiftId, substituteEmployeeId: input.substituteEmployeeId })
      return created
    })
    return reply.code(201).send({ ...result, createdAt: result.createdAt.toISOString(), reviewedAt: result.reviewedAt?.toISOString() ?? null })
  })

  app.post('/v1/merchant/venues/:venueId/substitutions/:requestId/decision', async (req) => {
    const params = z.object({ venueId: z.string().uuid(), requestId: z.string().uuid() }).parse(req.params)
    const input = z.object({ decision: z.enum(['APPROVE', 'REJECT']) }).parse(req.body)
    const { a, venue } = await requireManager(req, params.venueId)
    return db.transaction(async tx => {
      await tx.select({ id: s.merchantVenue.id }).from(s.merchantVenue).where(eq(s.merchantVenue.id, venue.id)).for('update')
      const [request] = await tx.select().from(s.merchantSubstitution).where(and(eq(s.merchantSubstitution.id, params.requestId), eq(s.merchantSubstitution.venueId, venue.id))).for('update')
      if (!request) throw Object.assign(new Error('NOT_FOUND'), { status: 404, code: 'NOT_FOUND' })
      if (request.status !== 'PENDING') return { id: request.id, status: request.status, newVersion: request.newScheduleId ? (await tx.select({ version: s.merchantSchedule.version }).from(s.merchantSchedule).where(eq(s.merchantSchedule.id, request.newScheduleId)))[0]?.version : null }
      if (input.decision === 'REJECT') {
        const [updated] = await tx.update(s.merchantSubstitution).set({ status: 'REJECTED', reviewedByEmployeeId: a.kind === 'cashier' ? a.employeeId : null, reviewedByOwnerId: a.kind === 'owner' ? a.userId : null, reviewedAt: new Date() }).where(eq(s.merchantSubstitution.id, request.id)).returning()
        await h.audit(tx, a, venue.id, 'schedule.substitution.rejected', 'Substitution rejected', { id: request.id, status: request.status }, { id: request.id, status: updated.status })
        return { id: request.id, status: updated.status, newVersion: null }
      }
      const [original] = await tx.select().from(s.merchantSchedule).where(and(eq(s.merchantSchedule.id, request.scheduleId), eq(s.merchantSchedule.status, 'PUBLISHED'))).for('update')
      const [oldShift] = await tx.select().from(s.merchantScheduleShift).where(eq(s.merchantScheduleShift.id, request.scheduleShiftId))
      if (!original || !oldShift) throw Object.assign(new Error('SCHEDULE_STALE'), { status: 409, code: 'SCHEDULE_STALE' })
      const [current] = await tx.select({ id: s.merchantSchedule.id }).from(s.merchantSchedule).where(and(eq(s.merchantSchedule.venueId, venue.id), eq(s.merchantSchedule.weekStart, original.weekStart), eq(s.merchantSchedule.status, 'PUBLISHED'))).orderBy(desc(s.merchantSchedule.version)).limit(1)
      if (current?.id !== original.id) throw Object.assign(new Error('SCHEDULE_STALE'), { status: 409, code: 'SCHEDULE_STALE' })
      const [substitute] = await tx.select({ id: s.merchantEmployee.id }).from(s.merchantEmployee).where(and(eq(s.merchantEmployee.id, request.substituteEmployeeId), eq(s.merchantEmployee.venueId, venue.id), eq(s.merchantEmployee.active, true)))
      if (!substitute) throw Object.assign(new Error('SCHEDULE_EMPLOYEE_INACTIVE'), { status: 409, code: 'SCHEDULE_EMPLOYEE_INACTIVE' })
      const all = await tx.select().from(s.merchantScheduleShift).where(eq(s.merchantScheduleShift.scheduleId, original.id)).orderBy(asc(s.merchantScheduleShift.startsAt))
      const replacements = all.map(x => ({ employeeId: x.id === oldShift.id ? request.substituteEmployeeId : x.employeeId, startsAt: x.startsAt.toISOString(), endsAt: x.endsAt.toISOString() }))
      for (let i = 0; i < replacements.length; i++) for (let j = i + 1; j < replacements.length; j++) if (replacements[i].employeeId === replacements[j].employeeId && Date.parse(replacements[i].startsAt) < Date.parse(replacements[j].endsAt) && Date.parse(replacements[j].startsAt) < Date.parse(replacements[i].endsAt)) throw Object.assign(new Error('SUBSTITUTE_CONFLICT'), { status: 409, code: 'SUBSTITUTE_CONFLICT' })
      const [latest] = await tx.select({ version: max(s.merchantSchedule.version) }).from(s.merchantSchedule).where(and(eq(s.merchantSchedule.venueId, venue.id), eq(s.merchantSchedule.weekStart, original.weekStart)))
      const [next] = await tx.insert(s.merchantSchedule).values({ venueId: venue.id, weekStart: original.weekStart, timeZone: original.timeZone, version: Number(latest.version ?? original.version) + 1, requestKey: `substitution:${request.id}`, status: 'PUBLISHED', coverageHours: original.coverageHours, createdByEmployeeId: a.kind === 'cashier' ? a.employeeId : null, createdByOwnerId: a.kind === 'owner' ? a.userId : null, publishedAt: new Date() }).returning()
      const copied = await tx.insert(s.merchantScheduleShift).values(all.map(x => ({ scheduleId: next.id, venueId: venue.id, employeeId: x.id === oldShift.id ? request.substituteEmployeeId : x.employeeId, startsAt: x.startsAt, endsAt: x.endsAt, role: x.role }))).returning()
      const [updated] = await tx.update(s.merchantSubstitution).set({ status: 'APPROVED', reviewedByEmployeeId: a.kind === 'cashier' ? a.employeeId : null, reviewedByOwnerId: a.kind === 'owner' ? a.userId : null, reviewedAt: new Date(), newScheduleId: next.id }).where(eq(s.merchantSubstitution.id, request.id)).returning()
      await h.audit(tx, a, venue.id, 'schedule.substitution.approved', 'Substitution approved and new version published', { id: request.id, scheduleVersion: original.version }, { id: updated.id, scheduleVersion: next.version, shifts: copied.length })
      return { id: request.id, status: updated.status, newVersion: next.version }
    })
  })
}
