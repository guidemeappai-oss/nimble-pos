import { DemoLoyalty } from '../loyalty/demo'
import { priceMerchantCart } from './contract';
import type { MerchantAsset, MerchantCartLine, MerchantEmployee, MerchantFiat, MerchantOrder, MerchantProduct, MerchantShift, MerchantVenue } from './contract';
// Deliberately ephemeral: no wallet, fetch or persistence dependency.
export class DemoCafe {
  venue: MerchantVenue = { id: 'demo', name: 'Maison Café', fiatCurrency: 'EUR', nimAddress: 'Example Nimiq address · demo', usdtAddress: 'Example Polygon address · demo' };
  loyalty = new DemoLoyalty(this.venue);
  products: MerchantProduct[] = [
    { id: 'flat', name: 'Flat white', category: 'Coffee', available: true, variants: [{ id: 'classic', name: 'Classic', priceMinor: 450 }, { id: 'large', name: 'Large', priceMinor: 550 }], extras: [{ id: 'oat', name: 'Oat milk', priceMinor: 50, available: true }, { id: 'shot', name: 'Extra shot', priceMinor: 80, available: true }] },
    { id: 'croissant', name: 'Butter croissant', category: 'Bakery', available: true, variants: [{ id: 'croissant-classic', name: 'Freshly baked', priceMinor: 320 }], extras: [] },
    { id: 'espresso', name: 'Espresso', category: 'Coffee', available: true, variants: [{ id: 'espresso-single', name: 'Single', priceMinor: 280 }, { id: 'double', name: 'Double', priceMinor: 350 }], extras: [] },
    { id: 'matcha', name: 'Matcha latte', category: 'Coffee', available: true, variants: [{ id: 'matcha-classic', name: 'Classic', priceMinor: 520 }, { id: 'matcha-large', name: 'Large', priceMinor: 620 }], extras: [{ id: 'matcha-oat', name: 'Oat milk', priceMinor: 50, available: true }] },
    { id: 'breakfast', name: 'Morning ritual', category: 'Breakfast sets', available: true, variants: [{ id: 'breakfast-one', name: 'Croissant & coffee', priceMinor: 600 }], components: [{ productId: 'croissant', variantId: 'croissant-classic', quantity: 1 }], choiceGroups: [{ id: 'breakfast-drink', name: 'Your coffee', min: 1, max: 1, extraIds: ['breakfast-espresso', 'breakfast-flat'] }], extras: [{ id: 'breakfast-espresso', name: 'Espresso', priceMinor: 0, available: true, component: { productId: 'espresso', variantId: 'espresso-single', quantity: 1 } }, { id: 'breakfast-flat', name: 'Flat white', priceMinor: 100, available: true, component: { productId: 'flat', variantId: 'classic', quantity: 1 } }] },
  ];
  employees: MerchantEmployee[] = [{ id: 'anna', name: 'Anna Kowalska', active: true }, { id: 'leo', name: 'Leo Martin', active: true }];
  private pins = new Map([['anna', '1234'], ['leo', '5678']]);
  cashier: MerchantEmployee | null = null;
  shift: MerchantShift | null = null;
  shifts: MerchantShift[] = [];
  orders: MerchantOrder[] = [];
  signIn(id: string, pin: string) {
    const employee = this.employees.find(x => x.id === id && x.active);
    if (!employee || this.pins.get(id) !== pin)
      throw new Error('Incorrect profile or PIN.');
    this.cashier = employee;
    this.shift = this.shifts.find(x => x.employeeId === id && !x.closedAt) ?? null;
  }
  signOut() { this.cashier = null; this.shift = null; }
  openShift() {
    if (!this.cashier)
      throw new Error('Sign in with your PIN first.'); if (!this.shift) {
        this.shift = { id: `shift-${this.shifts.length + 1}`, employeeId: this.cashier.id, openedAt: new Date().toISOString(), closedAt: null };
        this.shifts.push(this.shift);
      }
  }
  closeShift() {
    if (this.shift)
      this.shift.closedAt = new Date().toISOString(); this.shift = null;
  }
  createOrder(items: MerchantCartLine[]) {
    if (!this.shift || this.shift.closedAt)
      throw new Error('Open your personal shift first.');
    if (!items.length)
      throw new Error('Add at least one item.');
    const { lines, totalMinor } = this.priced(items);
    const number = this.orders.length + 42;
    const order: MerchantOrder = { id: `demo-${number}`, venueId: 'demo', number, revision: 1, status: 'AWAITING_PAYMENT', lines, totalMinor, fiatCurrency: this.venue.fiatCurrency, checkoutToken: `example-${number}`, shiftId: this.shift.id, employeeId: this.cashier!.id, quote: null, payment: null, refund: null, createdAt: new Date().toISOString() };
    this.orders.unshift(order);
    return order;
  }
  editOrder(orderId: string, lines: MerchantCartLine[]) {
    const order = this.order(orderId);
    if (order.status !== 'AWAITING_PAYMENT')
      throw new Error('A paid order cannot be edited.');
    const priced = this.priced(lines);
    Object.assign(order, priced, { revision: order.revision + 1, quote: null });
    return order;
  }
  private priced(lines: MerchantCartLine[]) {
    if (lines.some(line => !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99))
      throw new Error('Invalid quantity or extras.');
    return priceMerchantCart(this.products, lines);
  }
  quote(orderId: string, asset: MerchantAsset) {
    const order = this.order(orderId);
    const eurMinor = order.totalMinor / (order.fiatCurrency === 'PLN' ? 4.3 : order.fiatCurrency === 'USD' ? 1.08 : 1);
    return String(Math.round(asset === 'NIM' ? eurMinor * 500000 : eurMinor * 10800));
  }
  simulatePayment(orderId: string, asset: MerchantAsset) {
    const order = this.order(orderId);
    if (order.status !== 'AWAITING_PAYMENT')
      throw new Error('This order has already been paid or cancelled.');
    order.payment = { asset, amountAtomic: this.quote(orderId, asset), sender: 'Example customer', recipient: 'Example café', network: 'demo', hash: 'simulated-no-transaction', confirmedAt: new Date().toISOString() };
    order.status = 'PREPARING';
    this.loyalty.earn(order.id, order.totalMinor);
  }
  advance(orderId: string) {
    const order = this.order(orderId); if (order.status === 'PREPARING')
      order.status = 'READY';
    else if (order.status === 'READY')
      order.status = 'COLLECTED';
    else
      throw new Error('Only paid orders can move through the queue.');
  }
  cancel(orderId: string) {
    const order = this.order(orderId); if (order.status !== 'AWAITING_PAYMENT')
      throw new Error('Paid orders require a refund.'); order.status = 'CANCELLED';
  }
  requestRefund(orderId: string) {
    const order = this.order(orderId); if (!['PREPARING', 'READY', 'COLLECTED'].includes(order.status))
      throw new Error('Only paid orders can be refunded.'); order.status = 'REFUND_PENDING'; this.loyalty.hold(order.id); order.refund = { id: 'example-refund', status: 'REQUESTED', reason: null, quote: null };
  }
  approveRefund(orderId: string, role: 'owner' | 'cashier') {
    if (role !== 'owner')
      throw new Error('Only the owner may authorize a refund.'); const order = this.order(orderId); if (order.refund?.status !== 'REQUESTED')
      throw new Error('No refund awaiting approval.'); order.status = 'REFUNDED'; order.refund.status = 'CONFIRMED'; this.loyalty.refund(order.id);
  }
  setAvailability(productId: string, available: boolean, extraId?: string) {
    const product = this.products.find(x => x.id === productId); if (!product)
      throw new Error('Product not found.'); if (extraId) {
        const extra = product.extras.find(x => x.id === extraId);
        if (extra)
          extra.available = available;
      }
    else
      product.available = available;
  }
  updateVenue(name: string, currency: MerchantFiat) {
    if (this.orders.length && currency !== this.venue.fiatCurrency) throw new Error('The menu currency is fixed after the first order.');
    this.venue = { ...this.venue, name, fiatCurrency: currency };
  }
  resetPin(id: string, pin: string) {
    if (!/^\d{4,8}$/.test(pin))
      throw new Error('Use a 4–8 digit PIN.'); this.pins.set(id, pin);
  }
  addEmployee(name: string, pin: string) {
    if (!/^\d{4,8}$/.test(pin))
      throw new Error('Use a 4–8 digit PIN.'); const id = `employee-${this.employees.length}`; this.employees.push({ id, name, active: true }); this.pins.set(id, pin);
  }
  order(id: string) {
    const order = this.orders.find(x => x.id === id); if (!order)
      throw new Error('Order not found.'); return order;
  }
}
