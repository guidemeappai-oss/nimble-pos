import {z} from 'zod';
export const InventoryLotMetadata=z.object({label:z.string().trim().max(120).default(''),expiresAt:z.string().datetime({offset:true}).nullable().default(null)}).strict();
export type LotDelta={lotId:string;delta:number;label?:string;expiresAt?:string|null};
export type LotQuantity={lotId:string;quantity:number;label?:string;expiresAt?:string|null};
export type InventoryLot={id:string;venueId:string;itemId:string;quantity:number;label:string;expiresAt:string|null;receivedAt:string|null;source:string;sourceId:string|null;createdAt:string;expired:boolean};
export type InventoryLotsView={items:InventoryLot[];hasMore:boolean;page:number;suggested:LotQuantity[];expiryPolicy:'ALERT_ONLY';physicalQuantity:number;requestedQuantity:number|null};
