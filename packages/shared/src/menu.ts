import type { MerchantProduct } from "./merchant";
export interface MenuDraft {
  revision: number;
  basePublishedRevision: number;
  products: MerchantProduct[];
  updatedAt: string;
}
export interface MenuWorkspace {
  publishedRevision: number;
  products: MerchantProduct[];
  draft: MenuDraft | null;
}
export interface MenuVersion {
  id: string;
  revision: number;
  products: MerchantProduct[];
  reason: string;
  createdAt: string;
}
export interface MenuVersionPage {
  versions: MenuVersion[];
  hasMore: boolean;
}
export interface MenuDraftCommand {
  idempotencyKey: string;
  revision: number | null;
  basePublishedRevision: number;
  products: MerchantProduct[];
  reason: string;
}
export interface MenuPublishCommand {
  draftRevision: number;
  basePublishedRevision: number;
  idempotencyKey: string;
  reason: string;
}
export interface MenuRestoreCommand {
  idempotencyKey: string;
  draftRevision: number | null;
  basePublishedRevision: number;
  reason: string;
}
