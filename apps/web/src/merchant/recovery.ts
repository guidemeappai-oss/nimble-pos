export interface SubmittedPayment {
  hash: string
  revision: number
  quoteId: string
}

export interface SigningIntent {
  state: 'SIGNING'
  revision: number
  quoteId: string
}

function readRecord(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') }
  catch { return null }
}

export function readSubmitted(key: string): SubmittedPayment | null {
  const value = readRecord(key) as SubmittedPayment | null
  return value?.hash && Number.isInteger(value.revision) && value.quoteId ? value : null
}

export function readSigningIntent(key: string): SigningIntent | null {
  const value = readRecord(key) as SigningIntent | null
  return value?.state === 'SIGNING' && Number.isInteger(value.revision) && value.quoteId ? value : null
}

/** Resolve an interrupted wallet approval using its hash, retaining the original quote. */
export function restoreSubmittedHash(key: string, hash: string, fallback?: Omit<SubmittedPayment, 'hash'>): SubmittedPayment {
  const intent = readSigningIntent(key) ?? readSubmitted(key) ?? fallback
  if (!intent) throw new Error('No interrupted wallet approval to recover.')
  const normalized = hash.trim()
  if (!/^(?:0x)?[0-9a-fA-F]{64}$/.test(normalized)) throw new Error('Enter the full transaction hash from your wallet.')
  const payment = { revision: intent.revision, quoteId: intent.quoteId, hash: normalized }
  localStorage.setItem(key, JSON.stringify(payment))
  return payment
}

function safeToRetry(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code) : error instanceof Error ? error.message : ''
  // These errors are emitted before the adapter invokes a transfer, or explicitly refuse signing.
  return ['4001', 'PERMISSION_DENIED', 'QUOTE_EXPIRED', 'INVALID_AMOUNT', 'WRONG_WALLET',
    'INVALID_QUOTE', 'WALLET_SYNC_REQUIRED', 'WRONG_NETWORK', 'WALLET_UNAVAILABLE',
    'NETWORK_UNVERIFIED'].includes(code)
}

async function completeSubmission(
  key: string,
  details: Omit<SubmittedPayment, 'hash'>,
  send: () => Promise<{ hash: string }>,
  register: (payment: SubmittedPayment) => Promise<unknown>,
): Promise<SubmittedPayment> {
  const previous = readSubmitted(key)
  if (previous) {
    await register(previous)
    return previous
  }
  if (readSigningIntent(key) || localStorage.getItem(key)) throw new Error('SIGNING_UNCERTAIN')
  // This durable intent closes the reload window while the wallet signs or broadcasts.
  localStorage.setItem(key, JSON.stringify({ state: 'SIGNING', ...details } satisfies SigningIntent))
  let sent: { hash: string }
  try { sent = await send() }
  catch (error) {
    if (safeToRetry(error)) localStorage.removeItem(key)
    throw error
  }
  const payment = { ...details, hash: sent.hash }
  localStorage.setItem(key, JSON.stringify(payment))
  await register(payment)
  return payment
}

const inFlight = new Map<string, Promise<SubmittedPayment>>()
export function submitOnce(
  key: string,
  details: Omit<SubmittedPayment, 'hash'>,
  send: () => Promise<{ hash: string }>,
  register: (payment: SubmittedPayment) => Promise<unknown>,
): Promise<SubmittedPayment> {
  const active = inFlight.get(key)
  if (active) return active
  const task = completeSubmission(key, details, send, register).finally(() => inFlight.delete(key))
  inFlight.set(key, task)
  return task
}
