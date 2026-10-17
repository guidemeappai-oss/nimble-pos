import { createHash } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { TaskActionInput, TaskTemplateInput, type TaskInstance, type TaskTemplate, type MerchantPermission } from '@nimble/shared';
import type { Db } from '../db/client';
import * as s from '../db/schema';
import { loyaltyFail as fail } from '../services/loyalty';
export type MerchantActor = {
    kind: 'owner';
    userId: string;
} | {
    kind: 'cashier';
    employeeId: string;
    venueId: string;
    sessionId: string;
    name?: string;
    permissions?: MerchantPermission[];
};
export type MerchantTaskHelpers = {
    actor: (req: FastifyRequest) => Promise<MerchantActor>;
    venueFor: (a: MerchantActor, id: string, ownerOnly?: boolean, store?: Db) => Promise<typeof s.merchantVenue.$inferSelect>;
    audit: (store: Db, a: MerchantActor, venueId: string, action: string, reason: string, before: unknown, after: unknown) => Promise<void>;
    evidenceCheck?: (store: Db, task: typeof s.merchantTask.$inferSelect) => Promise<void>;
};
const uuid = z.string().uuid(), params = (r: FastifyRequest) => r.params as Record<string, string>;
export const taskActorKey = (a: MerchantActor) => a.kind === 'owner' ? `owner:${a.userId}` : `employee:${a.employeeId}`;
export const taskManage = (a: MerchantActor) => a.kind === 'owner' || !!a.permissions?.includes('tasks.manage');
export const taskView = (t: typeof s.merchantTask.$inferSelect): TaskInstance => ({ id: t.id, venueId: t.venueId, templateId: t.templateId, templateVersion: t.templateVersion, title: t.snapshot.title, instructions: t.snapshot.instructions, category: t.snapshot.category, dueAt: t.dueAt.toISOString(), status: t.status, revision: t.revision, assigneeEmployeeId: t.assigneeEmployeeId, reviewerEmployeeId: t.reviewerEmployeeId, requiredPhotos: t.snapshot.requiredPhotos, submissionNumber: t.submissionNumber, submissionComment: t.submissionComment, reviewComment: t.reviewComment, completedBy: t.completedBy, ownerDeclared: t.ownerDeclared, photoExceptionReason: t.ownerDeclared && t.reviewComment?.startsWith('PHOTO_EXCEPTION: ') ? t.reviewComment.slice(17) : null, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() });
const templateView = (t: typeof s.merchantTaskTemplate.$inferSelect): TaskTemplate => ({ ...t.config, id: t.id, venueId: t.venueId, version: t.version, revision: t.revision, createdAt: t.createdAt.toISOString() });
const localDay = (date: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
// Convert wall-clock time using timezone offset iteration. Ambiguous autumn times use the second occurrence;
// nonexistent spring times move forward by the daylight-saving gap. The occurrence key remains the local day.
function zonedDue(day: string, time: string, tz: string) {
    const target = Date.parse(`${day}T${time}:00Z`);
    let value = target;
    for (let n = 0; n < 4; n++) {
        const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(value));
        const wall = Date.parse(parts.replace(' ', 'T') + 'Z');
        const next = value + target - wall;
        if (next === value)
            return new Date(value);
        if (n === 3)
            return new Date(Math.max(value, next));
        value = next;
    }
    return new Date(value);
}
const nextDay = (day: string) => new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
export async function taskRoutes(app: FastifyInstance, h: MerchantTaskHelpers) {
    const db = app.deps.db, base = '/v1/merchant/venues/:venueId';
    async function context(req: FastifyRequest, manage = false) { const a = await h.actor(req), venueId = uuid.parse(params(req).venueId); await h.venueFor(a, venueId); if (manage && !taskManage(a))
        fail(403, 'FORBIDDEN'); return { a, venueId }; }
    async function validatePeople(store: Db, venueId: string, input: TaskTemplateInput) {
        for (const [person, reviewer] of [[input.assigneeEmployeeId, false], [input.reviewerEmployeeId, true]] as const) {
            if (!person)
                continue;
            const [e] = await store.select().from(s.merchantEmployee).where(and(eq(s.merchantEmployee.id, person), eq(s.merchantEmployee.venueId, venueId), eq(s.merchantEmployee.active, true)));
            if (!e)
                fail(400, 'INVALID_EMPLOYEE');
            if (reviewer && (e.role !== 'MANAGER' || !e.permissions.includes('tasks.manage')))
                fail(400, 'INVALID_REVIEWER');
        }
        if (input.assigneeEmployeeId && input.assigneeEmployeeId === input.reviewerEmployeeId)
            fail(400, 'SELF_REVIEW');
    }
    async function retry<T>(store: Db, a: MerchantActor, key: string, payload: unknown, run: () => Promise<T>): Promise<T> {
        const actor = taskActorKey(a), hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        await store.execute(sql `select pg_advisory_xact_lock(hashtext(${actor + key}))`);
        const [old] = await store.select().from(s.merchantTaskRequest).where(and(eq(s.merchantTaskRequest.actor, actor), eq(s.merchantTaskRequest.key, key)));
        if (old) {
            if (old.requestHash !== hash)
                fail(409, 'IDEMPOTENCY_CONFLICT');
            return old.response as T;
        }
        const result = await run();
        await store.insert(s.merchantTaskRequest).values({ actor, key, requestHash: hash, response: result });
        return result;
    }
    async function materialize(venueId: string) {
        await db.transaction(async (tx) => {
            await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${'tasks:' + venueId}))`);
            const templates = await tx.select().from(s.merchantTaskTemplate).where(eq(s.merchantTaskTemplate.venueId, venueId));
            const now = new Date();
            for (const t of templates) {
                if (!t.config.active)
                    continue;
                const c = t.config;
                const occurrences: {
                    key: string;
                    due: Date;
                    assignee: string | null;
                }[] = [];
                if (c.schedule === 'ONCE')
                    occurrences.push({ key: 'once', due: new Date(c.scheduledFor!), assignee: c.assigneeEmployeeId });
                if (c.schedule === 'DAILY') {
                    const [latest] = await tx.select().from(s.merchantTask).where(and(eq(s.merchantTask.templateId, t.id), sql `${s.merchantTask.occurrence} like 'day:%'`)).orderBy(desc(s.merchantTask.occurrence)).limit(1);
                    // Re-enabling never manufactures deadlines from the paused window. Existing task snapshots remain untouched.
                    const activationDay = localDay(t.scheduleFrom ?? t.createdAt, c.timeZone);
                    const cursorDay = latest ? nextDay(latest.occurrence.slice(4)) : activationDay;
                    let day = cursorDay > activationDay ? cursorDay : activationDay, today = localDay(now, c.timeZone);
                    for (let n = 0; day <= today && n < 366; n++, day = nextDay(day))
                        { const due = zonedDue(day, c.dueTime, c.timeZone); if (!t.scheduleFrom || due >= t.scheduleFrom) occurrences.push({ key: 'day:' + day, due, assignee: c.assigneeEmployeeId }); }
                }
                if (c.schedule === 'SHIFT') {
                    const shifts = await tx.select().from(s.merchantShift).where(and(eq(s.merchantShift.venueId, venueId), sql `(${s.merchantShift.openedAt} >= ${(t.scheduleFrom ?? t.createdAt).toISOString()} or ${s.merchantShift.closedAt} is null)`, ...(c.assigneeEmployeeId ? [eq(s.merchantShift.employeeId, c.assigneeEmployeeId)] : [])));
                    for (const shift of shifts)
                        occurrences.push({ key: 'shift:' + shift.id, due: zonedDue(localDay(shift.openedAt, c.timeZone), c.dueTime, c.timeZone), assignee: shift.employeeId });
                }
                for (const o of occurrences)
                    await tx.insert(s.merchantTask).values({ venueId, templateId: t.id, templateVersion: t.version, occurrence: o.key, snapshot: c, dueAt: o.due, assigneeEmployeeId: o.assignee, reviewerEmployeeId: c.reviewerEmployeeId }).onConflictDoNothing();
            }
        });
    }
    app.get(`${base}/task-people`, async (req) => { const { venueId } = await context(req, true); return { employees: (await db.select().from(s.merchantEmployee).where(and(eq(s.merchantEmployee.venueId, venueId), eq(s.merchantEmployee.active, true)))).map(e => ({ id: e.id, name: e.name, role: e.role, permissions: e.permissions, active: e.active })) }; });
    app.get(`${base}/task-templates`, async (req) => { const { venueId } = await context(req, true); return { templates: (await db.select().from(s.merchantTaskTemplate).where(eq(s.merchantTaskTemplate.venueId, venueId)).orderBy(asc(s.merchantTaskTemplate.createdAt))).map(templateView) }; });
    app.post(`${base}/task-templates`, async (req, reply) => {
        const { a, venueId } = await context(req, true);
        const { idempotencyKey, ...raw } = req.body as Record<string, unknown>;
        const key = uuid.parse(idempotencyKey), input = TaskTemplateInput.parse(raw);
        const value = await db.transaction(async (tx) => retry(tx as unknown as Db, a, key, { venueId, input }, async () => { await validatePeople(tx as unknown as Db, venueId, input); const [t] = await tx.insert(s.merchantTaskTemplate).values({ venueId, config: input, createdAt: new Date() }).returning(); await h.audit(tx as unknown as Db, a, venueId, 'task.template.created', 'Created task template', null, templateView(t)); return templateView(t); }));
        reply.code(201);
        return value;
    });
    app.patch(`${base}/task-templates/:templateId`, async (req) => {
        const { a, venueId } = await context(req, true);
        const { revision, reason, ...raw } = req.body as Record<string, unknown>;
        const rev = z.number().int().positive().parse(revision), why = z.string().trim().min(1).max(1000).parse(reason), input = TaskTemplateInput.parse(raw);
        return db.transaction(async (tx) => { await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'tasks:' + venueId}))`); const [t] = await tx.select().from(s.merchantTaskTemplate).where(and(eq(s.merchantTaskTemplate.id, uuid.parse(params(req).templateId)), eq(s.merchantTaskTemplate.venueId, venueId))).for('update'); if (!t)
            fail(404, 'NOT_FOUND'); if (JSON.stringify(TaskTemplateInput.parse(t.config)) === JSON.stringify(input))
            return templateView(t); if (t.revision !== rev)
            fail(409, 'STALE_REVISION'); await validatePeople(tx as unknown as Db, venueId, input); const [next] = await tx.update(s.merchantTaskTemplate).set({ config: input, revision: rev + 1, version: t.version + 1, ...((!t.config.active && input.active) || t.config.schedule !== input.schedule ? { scheduleFrom: new Date() } : {}) }).where(eq(s.merchantTaskTemplate.id, t.id)).returning(); await h.audit(tx as unknown as Db, a, venueId, 'task.template.updated', why, templateView(t), templateView(next)); return templateView(next); });
    });
    app.get(`${base}/tasks`, async (req) => { const { a, venueId } = await context(req); await materialize(venueId); const tasks = await db.select().from(s.merchantTask).where(eq(s.merchantTask.venueId, venueId)).orderBy(asc(s.merchantTask.dueAt)); return { tasks: tasks.filter(t => taskManage(a) || a.kind === 'cashier' && (!t.assigneeEmployeeId || t.assigneeEmployeeId === a.employeeId)).map(taskView) }; });
    app.post(`${base}/tasks/:taskId/actions`, async (req) => {
        const { a, venueId } = await context(req), input = TaskActionInput.parse(req.body), taskId = uuid.parse(params(req).taskId);
        return db.transaction(async (tx) => retry(tx as unknown as Db, a, input.idempotencyKey, { venueId, taskId, input }, async () => {
            const [t] = await tx.select().from(s.merchantTask).where(and(eq(s.merchantTask.id, taskId), eq(s.merchantTask.venueId, venueId))).for('update');
            if (!t)
                fail(404, 'NOT_FOUND');
            if (t.revision !== input.revision)
                fail(409, 'STALE_REVISION');
            const who = taskActorKey(a), own = a.kind === 'cashier' ? t.assigneeEmployeeId === a.employeeId : t.completedBy === who || !t.assigneeEmployeeId;
            const patch: Partial<typeof s.merchantTask.$inferInsert> = { revision: t.revision + 1, updatedAt: new Date() };
            switch (input.action) {
                case 'ASSIGN':
                    if (!taskManage(a))
                        fail(403, 'FORBIDDEN');
                    if (t.status !== 'TODO')
                        fail(409, 'INVALID_TRANSITION');
                    if (!input.reason)
                        fail(400, 'REASON_REQUIRED');
                    await validatePeople(tx as unknown as Db, venueId, { ...t.snapshot, assigneeEmployeeId: input.assigneeEmployeeId ?? null, reviewerEmployeeId: input.reviewerEmployeeId ?? null });
                    patch.assigneeEmployeeId = input.assigneeEmployeeId ?? null;
                    patch.reviewerEmployeeId = input.reviewerEmployeeId ?? null;
                    break;
                case 'CLAIM':
                    if (a.kind !== 'cashier')
                        return fail(403, 'FORBIDDEN');
                    if (t.assigneeEmployeeId || t.status !== 'TODO')
                        fail(409, 'CANNOT_CLAIM');
                    patch.assigneeEmployeeId = a.employeeId;
                    break;
                case 'START':
                    if (!own)
                        fail(403, 'FORBIDDEN');
                    if (!['TODO', 'CHANGES_REQUESTED'].includes(t.status))
                        fail(409, 'INVALID_TRANSITION');
                    patch.status = 'IN_PROGRESS';
                    patch.completedBy = who;
                    break;
                case 'SUBMIT':
                    if (!own || t.completedBy !== who)
                        fail(403, 'FORBIDDEN');
                    if (!['IN_PROGRESS', 'CHANGES_REQUESTED'].includes(t.status))
                        fail(409, 'INVALID_TRANSITION');
                    if (h.evidenceCheck)
                        await h.evidenceCheck(tx as unknown as Db, t);
                    else if (t.snapshot.requiredPhotos !== 'NONE')
                        fail(409, 'PHOTOS_REQUIRED');
                    patch.status = 'SUBMITTED';
                    patch.submissionNumber = t.submissionNumber + 1;
                    patch.submissionComment = input.comment ?? null;
                    patch.reviewComment = null;
                    break;
                case 'APPROVE':
                case 'REQUEST_CHANGES':
                    if (!taskManage(a))
                        fail(403, 'FORBIDDEN');
                    if (t.completedBy === who)
                        fail(403, 'SELF_REVIEW');
                    if (a.kind === 'cashier' && t.reviewerEmployeeId && t.reviewerEmployeeId !== a.employeeId)
                        fail(403, 'REVIEWER_REQUIRED');
                    if (t.status !== 'SUBMITTED')
                        fail(409, 'INVALID_TRANSITION');
                    if (input.action === 'APPROVE') {
                        if (a.kind === 'cashier' && t.snapshot.requiredPhotos !== 'NONE' && !a.permissions?.includes('photos.view'))
                            fail(403, 'PHOTO_REVIEW_FORBIDDEN');
                        if (h.evidenceCheck)
                            await h.evidenceCheck(tx as unknown as Db, t);
                    }
                    if (input.action === 'REQUEST_CHANGES' && !input.reason)
                        fail(400, 'REASON_REQUIRED');
                    patch.status = input.action === 'APPROVE' ? 'APPROVED' : 'CHANGES_REQUESTED';
                    patch.reviewComment = input.reason ?? input.comment ?? null;
                    break;
                case 'OWNER_EXCEPTION':
                    if (a.kind !== 'owner')
                        fail(403, 'FORBIDDEN');
                    if (!['IN_PROGRESS', 'CHANGES_REQUESTED', 'SUBMITTED'].includes(t.status) || t.snapshot.requiredPhotos === 'NONE')
                        fail(409, 'INVALID_TRANSITION');
                    if (!input.reason)
                        fail(400, 'REASON_REQUIRED');
                    patch.status = 'APPROVED';
                    patch.ownerDeclared = true;
                    patch.reviewComment = 'PHOTO_EXCEPTION: ' + input.reason;
                    patch.submissionNumber = t.submissionNumber + (t.status === 'SUBMITTED' ? 0 : 1);
                    break;
                case 'OWNER_DECLARE':
                    if (a.kind !== 'owner' || t.completedBy !== who)
                        fail(403, 'OWNER_DECLARATION_REQUIRED');
                    if (t.status !== 'SUBMITTED')
                        fail(409, 'INVALID_TRANSITION');
                    if (!input.reason)
                        fail(400, 'REASON_REQUIRED');
                    if (h.evidenceCheck)
                        await h.evidenceCheck(tx as unknown as Db, t);
                    patch.status = 'APPROVED';
                    patch.ownerDeclared = true;
                    patch.reviewComment = input.reason;
                    break;
                case 'SKIP':
                    if (!taskManage(a))
                        fail(403, 'FORBIDDEN');
                    if (['APPROVED', 'SKIPPED'].includes(t.status))
                        fail(409, 'INVALID_TRANSITION');
                    if (!input.reason)
                        fail(400, 'REASON_REQUIRED');
                    patch.status = 'SKIPPED';
                    patch.reviewComment = input.reason;
                    break;
            }
            const [next] = await tx.update(s.merchantTask).set(patch).where(eq(s.merchantTask.id, t.id)).returning();
            await h.audit(tx as unknown as Db, a, venueId, `task.${input.action.toLowerCase()}`, input.reason ?? input.comment ?? input.action, taskView(t), taskView(next));
            return taskView(next);
        }));
    });
}
