import { isAddress, verifyMessage, type Address, type Hex } from 'viem'

/** Verify an EOA wallet's EIP-191 personal_sign proof without making an RPC call. */
export async function verifyLoyaltyEvmSignature(
  message: string,
  signature: string,
  address: string,
): Promise<boolean> {
  if (
    !isAddress(address, { strict: false }) ||
    !/^0x[0-9a-fA-F]{130}$/.test(signature)
  )
    return false
  try {
    return await verifyMessage({
      message,
      signature: signature as Hex,
      address: address as Address,
    })
  } catch {
    return false
  }
}
