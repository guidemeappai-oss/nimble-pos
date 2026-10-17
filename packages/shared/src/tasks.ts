import { z } from 'zod';
export const TaskTemplateInput = z.object({
    title: z.string().trim().min(1).max(120),
    instructions: z.string().trim().min(1).max(4000),
    category: z.enum(['OPENING', 'CLOSING', 'CLEANING', 'OTHER']),
    schedule: z.enum(['ONCE', 'DAILY', 'SHIFT']),
    timeZone: z.string().min(1).max(100).refine(value => { try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
    }
    catch {
        return false;
    } }),
    dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    scheduledFor: z.string().datetime().nullable(),
    assigneeEmployeeId: z.string().uuid().nullable(),
    reviewerEmployeeId: z.string().uuid().nullable(),
    requiredPhotos: z.enum(['NONE', 'BEFORE', 'AFTER', 'BOTH']),
    active: z.boolean(),
}).strict().refine(x => x.schedule !== 'ONCE' || x.scheduledFor !== null, { message: 'One-off task requires a due date' });
export type TaskTemplateInput = z.infer<typeof TaskTemplateInput>;
export type TaskTemplate = TaskTemplateInput & {
    id: string;
    venueId: string;
    version: number;
    revision: number;
    createdAt: string;
};
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'SUBMITTED' | 'CHANGES_REQUESTED' | 'APPROVED' | 'SKIPPED';
export type TaskInstance = {
    id: string;
    venueId: string;
    templateId: string;
    templateVersion: number;
    title: string;
    instructions: string;
    category: TaskTemplateInput['category'];
    dueAt: string;
    status: TaskStatus;
    revision: number;
    assigneeEmployeeId: string | null;
    reviewerEmployeeId: string | null;
    requiredPhotos: TaskTemplateInput['requiredPhotos'];
    submissionNumber: number;
    submissionComment: string | null;
    reviewComment: string | null;
    completedBy: string | null;
    ownerDeclared: boolean;
    photoExceptionReason: string | null;
    createdAt: string;
    updatedAt: string;
};
export const TaskActionInput = z.object({
    action: z.enum(['CLAIM', 'START', 'SUBMIT', 'APPROVE', 'REQUEST_CHANGES', 'SKIP', 'OWNER_DECLARE', 'OWNER_EXCEPTION', 'ASSIGN']),
    revision: z.number().int().positive(), idempotencyKey: z.string().uuid(),
    assigneeEmployeeId: z.string().uuid().nullable().optional(),
    reviewerEmployeeId: z.string().uuid().nullable().optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
    comment: z.string().trim().max(2000).optional(),
}).strict();
export type TaskActionInput = z.infer<typeof TaskActionInput>;
