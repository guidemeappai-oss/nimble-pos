import type { MerchantAsset } from './merchant'
export type DiscoveryCursor={checkpoint?:string;before?:string;head?:string;nextBlock?:number;nextLogIndex?:number}
export interface WalletObservation { eventKey:string;asset:MerchantAsset;network:string;recipient:string;hash:string;eventIndex:number;sender:string|null;amountAtomic:string;blockNumber:number;blockHash:string|null;occurredAt:string|null;confirmation:'OBSERVED'|'FINALIZED'|'REMOVED' }
export interface WalletDiscoveryPage { events:WalletObservation[];cursor:DiscoveryCursor;done:boolean;coveredThrough:number|null }
export interface WalletDiscoveryState { asset:MerchantAsset;network:string;recipient:string;enabled:boolean;cursor:DiscoveryCursor;lastScannedAt:string|null;lastError:string|null;coveredThrough:number|null }
export interface WalletDiscoveryView { states:WalletDiscoveryState[];items:(WalletObservation&{id:string;reportedOrderIds:string[];resolution?:import('./depositResolution').DepositResolution})[];hasMore:boolean }
