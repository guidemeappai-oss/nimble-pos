import type { MerchantPermission, MerchantAuditEntry } from '@nimble/shared';
import { ApiError } from '../api/client';
import type { CoverageHour, MerchantAsset, MerchantCartLine, MerchantEmployee, MerchantOrder, MerchantProduct, MerchantReport, MerchantSchedule, MerchantShift, MerchantVenue, ScheduleShift, SubstitutionRequest } from './contract';
export type DisplayRates = Record<MerchantAsset, {
  value: string;
  at: string;
  source: string;
} | null>;
export type VenueInput = Omit<MerchantVenue, 'id'>;
export type ProductInput = Omit<MerchantProduct, 'id'> & {
  id?: string;
};
type Authority = 'owner' | 'cashier' | 'terminal' | 'public';
export class MerchantApi {
  constructor(private base: string, private owner: () => string | null, private cashier: () => string | null, private terminal: () => string | null) { }
  async request<T>(authority: Authority, method: string, path: string, body?: object, key?: string): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = authority === 'owner' ? this.owner() : authority === 'cashier' ? this.cashier() : null;
    if (token)
      headers.authorization = `Bearer ${token}`;
    if (authority === 'terminal' && this.terminal())
      headers['x-terminal-token'] = this.terminal()!;
    if (key)
      headers['idempotency-key'] = key;
    const response = await fetch(`${this.base}/v1/merchant${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}), signal: AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new ApiError(data.error?.code ?? 'UNKNOWN', data.error?.message ?? `HTTP ${response.status}`, response.status);
    return data;
  }
  menuImageUrl(id: string) { return `${this.base}/v1/merchant/menu-images/${encodeURIComponent(id)}`; }
  async authenticatedPhotoBlob(path: string, cashier = false): Promise<Blob> {
    const token = cashier ? this.cashier() : this.owner();
    const response = await fetch(`${this.base}/v1/merchant${path}`, {
      headers: token ? {authorization: `Bearer ${token}`} : {}, cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new ApiError(response.status === 403 ? 'FORBIDDEN' : 'PHOTO_UNAVAILABLE', 'Photo unavailable', response.status);
    return response.blob();
  }
  venues() { return this.request<MerchantVenue[]>('owner', 'GET', '/venues'); }
  saveVenue(input: VenueInput, id?: string) { return this.request<MerchantVenue>('owner', id ? 'PATCH' : 'POST', id ? `/venues/${id}` : '/venues', input); }
  catalog(id: string, owner = false) { return this.request<MerchantProduct[]>(owner ? 'owner' : 'cashier', 'GET', `/venues/${id}/catalog`); }
  saveProduct(id: string, input: ProductInput, cashier = false) { return this.request<MerchantProduct>(cashier ? 'cashier' : 'owner', 'POST', `/venues/${id}/catalog`, input); }
  availability(id: string, productId: string, available: boolean, extraId?: string, owner = false) { return this.request<MerchantProduct>(owner ? 'owner' : 'cashier', 'PATCH', `/venues/${id}/catalog/${productId}/availability`, { available, extraId }); }
  rates(id: string, owner = false) { return this.request<DisplayRates>(owner ? 'owner' : 'cashier', 'GET', `/venues/${id}/rates`); }
  employees(id: string) { return this.request<MerchantEmployee[]>('owner', 'GET', `/venues/${id}/employees`); }
  addEmployee(id: string, name: string, pin: string) { return this.request<MerchantEmployee>('owner', 'POST', `/venues/${id}/employees`, { name, pin }); }
  editEmployee(id: string, changes: {
    name?: string;
    pin?: string;
    active?: boolean;
    role?: 'CASHIER' | 'MANAGER';
    permissions?: MerchantPermission[];
    reason?: string;
  }) { return this.request<MerchantEmployee>('owner', 'PATCH', `/employees/${id}`, changes); }
  pair(id: string) {
    return this.request<{
      terminalToken: string;
      terminalId: string;
    }>('owner', 'POST', `/venues/${id}/terminal`);
  }
  revoke(id: string) {
    return this.request<{
      ok: true;
    }>('owner', 'POST', `/venues/${id}/terminal/revoke`);
  }
  profiles() {
    return this.request<{
      venue: MerchantVenue;
      employees: MerchantEmployee[];
    }>('terminal', 'GET', '/terminal/profiles');
  }
  login(employeeId: string, pin: string) {
    return this.request<{
      token: string;
      employee: MerchantEmployee;
      venue: MerchantVenue;
    }>('terminal', 'POST', '/terminal/login', { employeeId, pin });
  }
  session() { return this.request<{employee: MerchantEmployee; venue: MerchantVenue}>('cashier', 'GET', '/session'); }
  audit(id: string, cashier = false, page = 1) { return this.request<MerchantAuditEntry[]>(cashier ? 'cashier' : 'owner', 'GET', `/venues/${id}/audit?page=${page}&limit=50`); }
  venueReport(id: string) { return this.request<MerchantReport>('cashier', 'GET', `/venues/${id}/report`); }
  logout() { return this.request('cashier', 'POST', '/logout'); }
  shift() { return this.request<MerchantShift | null>('cashier', 'GET', '/shifts/current'); }
  openShift() { return this.request<MerchantShift>('cashier', 'POST', '/shifts'); }
  closeShift(id: string) { return this.request<MerchantReport>('cashier', 'POST', `/shifts/${id}/close`); }
  report(id: string, shift = false) { return this.request<MerchantReport>(shift ? 'cashier' : 'owner', 'GET', shift ? `/shifts/${id}/report` : `/venues/${id}/report`); }
  orders(id: string, owner = false) { return this.request<MerchantOrder[]>(owner ? 'owner' : 'cashier', 'GET', `/venues/${id}/orders`); }
  createOrder(lines: MerchantCartLine[], key: string) { return this.request<MerchantOrder>('cashier', 'POST', '/orders', { lines }, key); }
  editOrder(order: MerchantOrder, lines: MerchantCartLine[]) { return this.request<MerchantOrder>('cashier', 'PATCH', `/orders/${order.id}`, { revision: order.revision, lines }); }
  status(order: MerchantOrder, status: 'READY' | 'COLLECTED' | 'CANCELLED') { return this.request<MerchantOrder>('cashier', 'POST', `/orders/${order.id}/status`, { revision: order.revision, status }); }
  claim(id: string, code: string) { return this.request<MerchantOrder>('cashier', 'POST', `/orders/${id}/claim`, { code }); }
  checkout(token: string) { return this.request<MerchantOrder>('owner', 'GET', `/checkout/${token}`); }
  quote(token: string, revision: number, asset: MerchantAsset, sender: string, nimAddress?: string) { return this.request<MerchantOrder>('owner', 'POST', `/checkout/${token}/quote`, { revision, asset, sender, nimAddress }); }
  payment(token: string, revision: number, quoteId: string, hash: string) { return this.request<MerchantOrder>('owner', 'POST', `/checkout/${token}/payment`, { revision, quoteId, hash }); }
  refund(id: string, reason?: string) { return this.request<MerchantOrder>('cashier', 'POST', `/orders/${id}/refund`, { reason }); }
  approveRefund(id: string) { return this.request<MerchantOrder>('owner', 'POST', `/orders/${id}/refund/approve`); }
  refundPayment(id: string, hash: string, quoteId?: string) { return this.request<MerchantOrder>('owner', 'POST', `/orders/${id}/refund/payment`, { hash, quoteId }); }
  mySchedule(weekStart: string) { return this.request<{ schedule: Pick<MerchantSchedule, 'id' | 'weekStart' | 'timeZone' | 'version' | 'status' | 'publishedAt'> | null; shifts: ScheduleShift[]; employees: MerchantEmployee[] }>('cashier', 'GET', `/schedule/me?weekStart=${encodeURIComponent(weekStart)}`); }
  venueSchedule(id: string, weekStart: string, owner = false) { return this.request<{ schedule: MerchantSchedule | null; employees: MerchantEmployee[]; pendingSubstitutions: SubstitutionRequest[] }>(owner ? 'owner' : 'cashier', 'GET', `/venues/${id}/schedules/${weekStart}`); }
  createSchedule(id: string, input: { weekStart: string; timeZone: string; coverageHours: CoverageHour[]; shifts: Omit<ScheduleShift, 'id'>[]; idempotencyKey: string }, owner = false) { return this.request<MerchantSchedule>(owner ? 'owner' : 'cashier', 'POST', `/venues/${id}/schedules`, input, input.idempotencyKey); }
  publishSchedule(id: string, scheduleId: string, owner = false) { return this.request<MerchantSchedule>(owner ? 'owner' : 'cashier', 'POST', `/venues/${id}/schedules/${scheduleId}/publish`); }
  requestSubstitution(id: string, scheduleId: string, shiftId: string, input: { substituteEmployeeId: string; reason: string }) { return this.request<SubstitutionRequest>('cashier', 'POST', `/venues/${id}/schedules/${scheduleId}/shifts/${shiftId}/substitutions`, input); }
  decideSubstitution(id: string, requestId: string, decision: 'APPROVE' | 'REJECT', owner = false) { return this.request<{ id: string; status: string; newVersion: number | null }>(owner ? 'owner' : 'cashier', 'POST', `/venues/${id}/substitutions/${requestId}/decision`, { decision }); }
}
