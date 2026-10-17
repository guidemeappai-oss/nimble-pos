import {useEffect,useRef,useState} from 'react'
import {locale} from '../i18n'
const tr=(en:string,pl:string)=>locale==='pl'?pl:en
interface Detector {detect(video:HTMLVideoElement):Promise<Array<{rawValue:string}>>}
interface DetectorConstructor {new(options:{formats:string[]}):Detector;getSupportedFormats?:()=>Promise<string[]>}
export function InventoryBarcodeScanner({onRead,disabled=false}:{onRead:(value:string)=>void;disabled?:boolean}) {
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null)
 const timer=useRef<ReturnType<typeof setInterval>|null>(null),generation=useRef(0),starting=useRef(false),mounted=useRef(true)
 const [active,setActive]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState<string|null>(null)
 const fallback=tr('Camera scanning is unavailable. Enter the barcode manually.','Skanowanie aparatem jest niedostępne. Wpisz kod ręcznie.')
 const stop=()=>{
  generation.current++
  if(timer.current)clearInterval(timer.current)
  timer.current=null;stream.current?.getTracks().forEach(track=>track.stop());stream.current=null
  if(video.current)video.current.srcObject=null
  starting.current=false
  if(mounted.current){setPending(false);setActive(false)}
 }
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;stop()}},[])
 useEffect(()=>{if(disabled){stop();setActive(false);setPending(false)}},[disabled])
 const start=async()=>{
  if(disabled||starting.current||stream.current)return
  starting.current=true;setPending(true);setError(null)
  const own=++generation.current
  try{
   const Constructor=(window as unknown as {BarcodeDetector?:DetectorConstructor}).BarcodeDetector
   if(!Constructor||!navigator.mediaDevices?.getUserMedia)throw new Error(fallback)
   const supported=Constructor.getSupportedFormats?await Constructor.getSupportedFormats():['ean_13','ean_8','upc_a','upc_e','code_128','qr_code']
   if(!mounted.current||generation.current!==own)return
   const formats=['ean_13','ean_8','upc_a','upc_e','code_128','qr_code'].filter(format=>supported.includes(format))
   if(!formats.length)throw new Error(fallback)
   const detector=new Constructor({formats})
   const camera=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false})
   if(!mounted.current||generation.current!==own){camera.getTracks().forEach(track=>track.stop());return}
   stream.current=camera
   if(!video.current)throw new Error(fallback)
   video.current.srcObject=camera
   await video.current.play()
   if(!mounted.current||generation.current!==own)return
   setActive(true)
   let detecting=false
   timer.current=setInterval(async()=>{
    if(detecting||!video.current||video.current.readyState<2)return
    detecting=true
    try{
     const codes=await detector.detect(video.current)
     if(!mounted.current||generation.current!==own||!codes[0])return
     const value=codes[0].rawValue.trim()
     if(!value||value.length>128)return
     stop();setActive(false);onRead(value)
    }catch{ /* A failed frame can be retried without restarting the camera. */ }
    finally{detecting=false}
   },300)
  }catch{
   if(mounted.current&&generation.current===own){stop();setActive(false);setError(fallback)}
  }finally{
   if(mounted.current&&generation.current===own){starting.current=false;setPending(false)}
  }
 }
 return <section className="m-soft">
  <button type="button" disabled={disabled||pending||active} onClick={()=>void start()}>{pending?tr('Opening camera…','Uruchamianie aparatu…'):tr('Scan stock barcode','Skanuj kod magazynowy')}</button>
  {(pending||active)&&<button type="button" onClick={()=>{stop();setActive(false);setPending(false)}}>{tr('Stop camera','Wyłącz aparat')}</button>}
  <video ref={video} hidden={!active} autoPlay muted playsInline aria-label={tr('Stock barcode camera','Aparat kodów magazynowych')} style={{maxWidth:'100%',maxHeight:280}}/>
  {error&&<p role="alert">{error}</p>}
  <small>{tr('Only the decoded barcode is used. Camera images are not saved. Manual entry is always available.','Używamy tylko odczytanego kodu. Obrazy z aparatu nie są zapisywane. Kod można zawsze wpisać ręcznie.')}</small>
 </section>
}
