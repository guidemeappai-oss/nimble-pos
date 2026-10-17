import type { MerchantProduct, MerchantVenue } from '../merchant/contract'
import type {
  LoyaltyCard,
  LoyaltyEntry,
  LoyaltyProgram,
  LoyaltyReward,
} from './types'

/** Ephemeral competition walkthrough: no API, wallet, storage, or transfers. */
export class DemoLoyalty {
  joined = false
  program: LoyaltyProgram
  private terms: LoyaltyProgram | null = null
  private entries: LoyaltyEntry[] = []
  private rewards: LoyaltyReward[] = []
  private attached = new Set<string>()
  private holds = new Set<string>()
  constructor(private venue: MerchantVenue) {
    this.program = {
      id: 'demo-program-1',
      venueId: venue.id,
      venueName: venue.name,
      network: 'demo',
      version: 1,
      active: true,
      threshold: 5,
      minimumMinor: 300,
      fiatCurrency: venue.fiatCurrency,
      productId: 'flat',
      variantId: 'classic',
      productName: 'Flat white',
      variantName: 'Classic',
    }
  }
  private entry(
    kind: LoyaltyEntry['kind'],
    delta: number,
    orderId: string | null = null,
    rewardId: string | null = null,
  ) {
    this.entries.unshift({
      id: `demo-entry-${this.entries.length + 1}`,
      kind,
      delta,
      orderId,
      rewardId,
      createdAt: new Date().toISOString(),
    })
  }
  configure(
    minimumMinor: number,
    productId: string,
    variantId: string,
    products: MerchantProduct[],
  ) {
    const p = products.find((p) => p.id === productId),
      v = p?.variants.find((v) => v.id === variantId)
    if (!p || !v || !Number.isInteger(minimumMinor) || minimumMinor <= 0)
      throw new Error('Choose a reward and a positive purchase minimum.')
    this.program = {
      ...this.program,
      id: `demo-program-${this.program.version + 1}`,
      version: this.program.version + 1,
      active: true,
      minimumMinor,
      productId,
      variantId,
      productName: p.name,
      variantName: v.name,
    }
    return this.program
  }
  disable() {
    this.program = { ...this.program, active: false }
    return this.program
  }
  join() {
    if (!this.program.active && !this.joined)
      throw new Error('This program is paused.')
    this.joined = true
    this.terms ??= { ...this.program }
    return this.card()
  }
  attach(orderId: string, enabled: boolean) {
    if (enabled) this.attached.add(orderId)
    else this.attached.delete(orderId)
  }
  earn(orderId: string, totalMinor: number) {
    if (
      !this.joined ||
      !this.attached.has(orderId) ||
      !this.program.active ||
      totalMinor < (this.terms?.minimumMinor ?? this.program.minimumMinor) ||
      this.entries.some((e) => e.orderId === orderId)
    )
      return
    this.entry('EARN', 1, orderId)
  }
  hold(orderId: string) {
    if (this.entries.some((e) => e.orderId === orderId && e.kind === 'EARN')) {
      this.holds.add(orderId)
      if (this.card().available < 0)
        for (const r of this.rewards)
          if (r.status === 'RESERVED') r.status = 'CANCELLED'
    }
  }
  refund(orderId: string) {
    if (this.holds.delete(orderId)) this.entry('REFUND', -1, orderId)
  }
  card(): LoyaltyCard & { earningEnabled: boolean } {
    for (const r of this.rewards)
      if (r.status === 'RESERVED' && Date.parse(r.expiresAt) < Date.now())
        r.status = 'EXPIRED'
    const balance = this.entries.reduce((n, e) => n + e.delta, 0),
      reserved = this.rewards.filter((r) => r.status === 'RESERVED').length * 5
    return {
      id: 'demo-card',
      earningEnabled: this.program.active,
      program: { ...(this.terms ?? this.program), active: this.program.active },
      balance,
      available: balance - reserved - this.holds.size,
      refundHolds: this.holds.size,
      reserved,
      entries: [...this.entries],
      rewards: this.rewards.map((r) => ({ ...r })),
    }
  }
  reserve() {
    if (this.card().available < 5)
      throw new Error('Collect five available stamps first.')
    const r: LoyaltyReward = {
      id: `demo-reward-${this.rewards.length + 1}`,
      cardId: 'demo-card',
      venueId: this.venue.id,
      productName: (this.terms ?? this.program).productName,
      variantName: (this.terms ?? this.program).variantName,
      status: 'RESERVED',
      number: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      token: `demo-reward-code-${this.rewards.length + 1}`,
    }
    this.rewards.push(r)
    return r
  }
  accept(token: string, products: MerchantProduct[]) {
    const r = this.rewards.find((r) => r.token === token)
    if (!r) throw new Error('Reward code not found.')
    if (['PREPARING', 'READY', 'COLLECTED'].includes(r.status)) return r
    if (r.status !== 'RESERVED' || Date.parse(r.expiresAt) < Date.now())
      throw new Error('This reservation has expired.')
    const terms = this.terms ?? this.program
    if (!products.find((p) => p.id === terms.productId)?.available)
      throw new Error('The reward is unavailable. Your stamps are safe.')
    r.status = 'PREPARING'
    r.number = 100 + this.rewards.indexOf(r)
    this.entry('REDEEM', -5, null, r.id)
    return r
  }
  status(id: string, status: 'READY' | 'COLLECTED') {
    const r = this.rewards.find((r) => r.id === id)
    if (
      !r ||
      !(
        (r.status === 'PREPARING' && status === 'READY') ||
        (r.status === 'READY' && status === 'COLLECTED')
      )
    )
      throw new Error('Invalid reward status.')
    r.status = status
    return r
  }
  cancel(id: string) {
    const r = this.rewards.find((r) => r.id === id)
    if (!r || ['COLLECTED', 'CANCELLED', 'EXPIRED'].includes(r.status))
      throw new Error('This reward cannot be cancelled.')
    if (r.status !== 'RESERVED') this.entry('RESTORE', 5, null, r.id)
    r.status = 'CANCELLED'
    return r
  }
  report() {
    return {
      cards: this.joined ? 1 : 0,
      earned: this.entries.filter((e) => e.kind === 'EARN').length,
      corrections: this.entries.filter((e) => e.kind === 'REFUND').length,
      collectedRewards: this.rewards.filter((r) => r.status === 'COLLECTED')
        .length,
      activeRewards: this.rewards.filter((r) =>
        ['PREPARING', 'READY'].includes(r.status),
      ).length,
    }
  }
}
