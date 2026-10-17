import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import sharp from 'sharp'
import { createTaskPhotoStorage } from '../src/services/taskPhotoStorage'
let directory: string
 afterEach(async()=>{if(directory) await rm(directory,{recursive:true,force:true})})
it('stores only reencoded private images and thumbnails, dropping EXIF metadata',async()=>{
 directory=await mkdtemp(join(tmpdir(),'nimble-photos-'))
 const original=await sharp({create:{width:1200,height:900,channels:3,background:'#223344'}}).jpeg().withMetadata({exif:{IFD0:{Artist:'private name'}}}).toBuffer()
 const store=createTaskPhotoStorage(directory)
 const saved=await store.save(original)
 const image=await store.read(saved.key,false)
 const thumbnail=await store.read(saved.key,true)
 expect((await sharp(image).metadata()).exif).toBeUndefined()
 expect((await sharp(thumbnail).metadata()).width).toBeLessThanOrEqual(320)
 expect(saved.key).not.toContain(directory)
 await store.remove(saved.key)
 await expect(store.read(saved.key,false)).rejects.toThrow()
})
it('rejects invalid and oversized uploads before publishing any file',async()=>{
 directory=await mkdtemp(join(tmpdir(),'nimble-photos-'))
 const store=createTaskPhotoStorage(directory)
 await expect(store.save(Buffer.from('not image'))).rejects.toMatchObject({code:'INVALID_PHOTO'})
 await expect(store.save(Buffer.alloc(10*1024*1024+1))).rejects.toMatchObject({code:'PHOTO_TOO_LARGE'})
 await expect(store.read('../secret')).rejects.toThrow()
})
it('cleans original and thumbnail orphan pairs without interrupting the sweep',async()=>{
 directory=await mkdtemp(join(tmpdir(),'nimble-photos-'))
 const store=createTaskPhotoStorage(directory),image=await sharp({create:{width:20,height:20,channels:3,background:'#fff'}}).png().toBuffer()
 const orphan=await store.save(image),active=await store.save(image)
 await store.cleanOrphans(new Set([active.key]),Date.now()+7200000)
 await expect(store.read(orphan.key)).rejects.toThrow()
 await expect(store.read(orphan.key,true)).rejects.toThrow()
 expect((await store.read(active.key)).length).toBeGreaterThan(0)
})
