import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProductImageEditor } from '../src/merchant/ProductImage'
afterEach(cleanup)
it('keeps the upload key for retry and removes a photograph only from the edited product', async () => {
  const upload = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce({ id: 'new-image' })
  const onChange = vi.fn()
  render(<ProductImageEditor imageId="old-image" api={{ upload, preview: vi.fn().mockRejectedValue(new Error('Unavailable')) }} onChange={onChange} />)
  const file = new File(['photo'], 'coffee.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('Choose product photograph'), { target: { files: [file] } })
  await screen.findByText('Connection lost')
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Retry photograph upload'))
  await waitFor(() => expect(onChange).toHaveBeenCalledWith('new-image'))
  expect(upload.mock.calls[0][0].idempotencyKey).toBe(upload.mock.calls[1][0].idempotencyKey)
  fireEvent.click(screen.getByText('Remove product photograph'))
  expect(onChange).toHaveBeenCalledWith(undefined)
})
it('rejects too-large files before sending their bytes', async () => {
  const upload = vi.fn()
  render(<ProductImageEditor api={{ upload, preview: vi.fn() }} onChange={vi.fn()} />)
  const file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('Choose product photograph'), { target: { files: [file] } })
  expect(await screen.findByText('Choose an image up to 10 MB.')).toBeTruthy()
  expect(upload).not.toHaveBeenCalled()
})
