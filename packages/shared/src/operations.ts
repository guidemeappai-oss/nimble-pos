import type { MerchantAsset, MerchantFiat, MerchantOrderStatus } from './merchant';
export interface OperationOrder {
    id: string;
    number: number;
    status: MerchantOrderStatus;
    source: 'COUNTER' | 'REMOTE';
    totalMinor: number;
    createdAt: string;
    decisionAt: string | null;
    delayMinutes: number;
    requiresRefund: boolean;
    fulfillmentRejectedAt: string | null;
}
export interface MerchantOperations {
    updatedAt: string;
    window: {
        from: string;
        to: string;
    };
    fiatCurrency: MerchantFiat;
    acceptedSalesMinor: string;
    receivedPayments: {
        asset: MerchantAsset;
        network: string;
        amountAtomic: string;
        count: number;
    }[];
    openOrderCount: number;
    delayedOrderCount: number;
    refundCount: number;
    orders: OperationOrder[];
    shifts: {
        id: string;
        employeeId: string;
        employeeName: string;
        openedAt: string;
    }[];
    terminal: {
        state: 'ACTIVE' | 'STALE' | 'UNKNOWN' | 'REVOKED';
        lastSeenAt: string | null;
    };
    truncated: boolean;
}
export interface PaymentException {
    order: OperationOrder;
    kind: 'UNVERIFIED' | 'REFUND_REQUIRED';
    contextTruncated: boolean;
    attempts: {
        id: string;
        purpose: 'PAYMENT' | 'REFUND';
        hash: string;
        asset: MerchantAsset;
        amountAtomic: string;
        createdAt: string;
        checks: number;
        nextCheckAt: string;
        lastCheckedAt: string | null;
        verificationCode: string | null;
        verification: 'UNVERIFIED' | 'VERIFIED';
    }[];
    holds: {
        itemId: string;
        quantity: number;
    }[];
    quoteExpiresAt: string | null;
    lastRecheckAt: string | null;
}
export interface PaymentExceptions {
    updatedAt: string;
    items: PaymentException[];
    hasMore: boolean;
}
export interface OperationActionResult {
    operationId: string;
    state: 'PENDING' | 'COMPLETE';
    orderId: string;
    orderStatus: MerchantOrderStatus;
    requiresRefund: boolean;
    outcome: 'UNVERIFIED' | 'VERIFIED' | 'REJECTED' | 'VERIFICATION_UNAVAILABLE';
}
