import type { MerchantOrderStatus } from './merchant';
export interface OrderReadiness {
    orderId: string;
    revision: number;
    cartRevision: number;
    status: MerchantOrderStatus;
    lines: {
        lineIndex: number;
        quantity: number;
        readyQuantity: number;
    }[];
    allReady: boolean;
}
export interface OrderReadinessInput {
    revision: number;
    cartRevision: number;
    idempotencyKey: string;
    lineIndex: number;
    readyQuantity: number;
}
