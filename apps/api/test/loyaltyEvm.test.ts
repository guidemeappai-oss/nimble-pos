import { describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { keccak256, toBytes } from 'viem'
import { verifyLoyaltyEvmSignature } from '../src/services/loyaltyEvm'

// Public development keys only. These accounts must never hold real funds.
const signer = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const other = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const message =
  'Link loyalty wallet\nOrigin: https://nimble.example\nNonce: abc123\nKawa ☕'

describe('verifyLoyaltyEvmSignature', () => {
  it('accepts an EIP-191 personal-sign proof of the exact UTF-8 message', async () => {
    const signature = await signer.signMessage({ message })
    expect(
      await verifyLoyaltyEvmSignature(message, signature, signer.address),
    ).toBe(true)
    expect(
      await verifyLoyaltyEvmSignature(
        message,
        signature,
        signer.address.toLowerCase(),
      ),
    ).toBe(true)
  })

  it('rejects another wallet and any change to the challenge', async () => {
    const signature = await signer.signMessage({ message })
    expect(
      await verifyLoyaltyEvmSignature(message, signature, other.address),
    ).toBe(false)
    expect(
      await verifyLoyaltyEvmSignature(
        `${message}\n`,
        signature,
        signer.address,
      ),
    ).toBe(false)
  })

  it('does not accept an unprefixed hash signature as a personal-sign proof', async () => {
    const signature = await signer.sign({ hash: keccak256(toBytes(message)) })
    expect(
      await verifyLoyaltyEvmSignature(message, signature, signer.address),
    ).toBe(false)
  })

  it.each([
    '',
    '0x',
    '0x1234',
    `0x${'ff'.repeat(65)}`,
    `0x${'00'.repeat(65)}`,
    'not-a-signature',
  ])('fails closed for malformed signature %s', async (signature) => {
    expect(
      await verifyLoyaltyEvmSignature(message, signature, signer.address),
    ).toBe(false)
  })

  it.each(['', '0x1234', `0x${'zz'.repeat(20)}`])(
    'fails closed for invalid address %s',
    async (address) => {
      const signature = await signer.signMessage({ message })
      expect(await verifyLoyaltyEvmSignature(message, signature, address)).toBe(
        false,
      )
    },
  )
})
