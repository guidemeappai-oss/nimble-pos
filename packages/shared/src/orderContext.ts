/** Staff-only context, deliberately independent of customer order snapshots. */
export type OrderContextPriority = 'NORMAL' | 'HIGH';
export type OrderContextSummary = {
    orderId: string;
    revision: number;
    priority: OrderContextPriority;
    delayReason: string | null;
};
export type OrderContextEntry = {
    id: string;
    kind: 'NOTE' | 'PRIORITY' | 'DELAY';
    text: string;
    priority?: OrderContextPriority;
    actor: {
        kind: 'owner' | 'cashier';
        id: string;
        name: string;
    };
    createdAt: string;
};
export type OrderContextMutation = {
    revision: number;
    idempotencyKey: string;
    kind: 'NOTE' | 'PRIORITY' | 'DELAY';
    text: string;
    priority?: OrderContextPriority;
};
export type OrderContextResult = {
    summary: OrderContextSummary;
    entry: OrderContextEntry;
};
