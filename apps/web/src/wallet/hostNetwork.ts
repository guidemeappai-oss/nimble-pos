/** Official Nimiq Pay host metadata; absent on older hosts and outside Pay. */
export function hostNimiqNetwork(): 'mainnet' | 'testnet' | undefined {
  if (typeof window === 'undefined') return undefined
  const network = (window as unknown as { nimiqPay?: { network?: unknown } })
    .nimiqPay?.network
  if (network === undefined) return undefined
  if (network === 'mainnet' || network === 'testnet') return network
  throw new Error('NETWORK_UNVERIFIED')
}
