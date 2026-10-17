import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import sharp from 'sharp'
import { LoyaltyError } from './loyalty'
export const TASK_PHOTO_MAX_BYTES = 10 * 1024 * 1024
export const TASK_PHOTO_RETENTION_MS = 30 * 86400000
const validKey = (key: string) => /^[0-9a-f-]{36}$/.test(key)
/** Private files are opaque keys, never URLs; callers authorize every read. */
export function createTaskPhotoStorage(directory: string) {
 const root=resolve(directory)
 const path=(key:string,thumbnail:boolean)=>{
  if(!validKey(key)) throw new LoyaltyError(404,'PHOTO_NOT_FOUND')
  return join(root,`${key}${thumbnail?'.thumb':''}.jpg`)
 }
 const remove=async(key:string)=>{
  for(const thumbnail of [false,true]) await unlink(path(key,thumbnail)).catch(error=>{if(error.code!=='ENOENT')throw error})
 }
 return {
  async save(input:Buffer){
   if(input.length===0||input.length>TASK_PHOTO_MAX_BYTES) throw new LoyaltyError(413,'PHOTO_TOO_LARGE')
   let image:Buffer, thumbnail:Buffer
   try {
    const source=sharp(input,{limitInputPixels:40_000_000,animated:false,failOn:'warning'})
    const metadata=await source.metadata()
    if(!['jpeg','png','webp','heif'].includes(metadata.format??'') || (metadata.pages??1)>1) throw new Error('unsupported')
    image=await source.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).flatten({background:'#fff'}).jpeg({quality:85}).toBuffer()
    thumbnail=await sharp(image).resize({width:320,height:320,fit:'inside',withoutEnlargement:true}).jpeg({quality:75}).toBuffer()
   }catch{throw new LoyaltyError(400,'INVALID_PHOTO')}
   await mkdir(root,{recursive:true,mode:0o700})
   const key=randomUUID()
   try {
    await writeFile(path(key,false),image,{mode:0o600,flag:'wx'})
    await writeFile(path(key,true),thumbnail,{mode:0o600,flag:'wx'})
   }catch(error){await remove(key);throw error}
   return {key,bytes:image.length}
  },
  read:async(key:string,thumbnail=false)=>readFile(path(key,thumbnail)), remove,
  async cleanOrphans(activeKeys:Set<string>,now=Date.now()){
   const names=await readdir(root).catch(error=>{if(error.code==='ENOENT')return [];throw error})
   const keys=new Set(names.map(name=>name.replace(/(?:\.thumb)?\.jpg$/,'')))
   for(const key of keys){
    if(!validKey(key)||activeKeys.has(key))continue
    const metadata=await stat(path(key,false)).catch(()=>stat(path(key,true))).catch(()=>null)
    // Grace period prevents racing uploads before their DB transaction commits.
    if(metadata && metadata.mtimeMs < now-3600000)await remove(key)
   }
  },
 }
}
export type TaskPhotoStorage=ReturnType<typeof createTaskPhotoStorage>
