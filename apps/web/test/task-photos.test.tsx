import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TaskPhotos } from '../src/merchant/TaskPhotos'
import type { MerchantApi } from '../src/merchant/client'
afterEach(() => {cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()})
const photo = {id:'p',phase:'AFTER',source:'CAMERA',submissionNumber:1,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()}
it('keeps an unsuccessful upload available for retry with the same idempotency key', async () => {
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test')
  vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
  let uploaded=false;let attempts=0
  const request=vi.fn(async (_authority:string,method:string,_path:string,_body?:object) => {
    if(method==='GET')return uploaded?[photo]:[]
    attempts++;if(attempts===1)throw new Error('Network unavailable')
    uploaded=true;return photo
  })
  const api={request,authenticatedPhotoBlob:vi.fn(async()=>new Blob(['image']))} as unknown as MerchantApi
  render(<TaskPhotos api={api} venueId="v" taskId="t" scope="employee-a" submissionNumber={0} editable cashier />)
  const file=new File(['photo'],'after.png',{type:'image/png'})
  fireEvent.change(screen.getByLabelText('Take task photo'),{target:{files:[file]}})
  expect(await screen.findByAltText('Selected task photo preview')).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'Upload photo'}))
  await screen.findByText('Network unavailable')
  expect(screen.getByText(/Not uploaded/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:'Upload photo'}))
  await screen.findByAltText('Task after photo')
  const uploads=request.mock.calls.filter(call=>call[1]==='POST')
  expect(uploads).toHaveLength(2)
  expect(uploads[0][3]).toEqual(uploads[1][3])
  expect(screen.queryByText(/Not uploaded/)).toBeNull()
})
it('discards a selected private photo when the employee scope changes', async()=>{
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test')
  const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
  const api={request:vi.fn(async()=>[]),authenticatedPhotoBlob:vi.fn()} as unknown as MerchantApi
  const view=render(<TaskPhotos api={api} venueId="v" taskId="t" scope="a" submissionNumber={0} editable cashier />)
  fireEvent.change(screen.getByLabelText('Take task photo'),{target:{files:[new File(['x'],'private.png',{type:'image/png'})]}})
  await screen.findByAltText('Selected task photo preview')
  view.rerender(<TaskPhotos api={api} venueId="v" taskId="t" scope="b" submissionNumber={0} editable cashier />)
  await waitFor(()=>expect(screen.queryByAltText('Selected task photo preview')).toBeNull())
  expect(revoke).toHaveBeenCalledWith('blob:test')
})
it('does not display an old private image after an employee scope change',async()=>{
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:old')
  vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
  let finish!:(blob:Blob)=>void;let calls=0
  const api={request:vi.fn(async()=>++calls===1?[photo]:[]),authenticatedPhotoBlob:vi.fn(()=>new Promise<Blob>(resolve=>{finish=resolve}))} as unknown as MerchantApi
  const view=render(<TaskPhotos api={api} venueId="v" taskId="t" scope="a" submissionNumber={0} editable cashier />)
  await waitFor(()=>expect(api.authenticatedPhotoBlob).toHaveBeenCalled())
  view.rerender(<TaskPhotos api={api} venueId="v" taskId="t" scope="b" submissionNumber={0} editable cashier />)
  await act(async()=>finish(new Blob(['old'])))
  expect(screen.queryByAltText('Task after photo')).toBeNull()
})
