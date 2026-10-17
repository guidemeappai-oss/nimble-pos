import { Address, Policy } from '@nimiq/core'
import type { DiscoveryCursor, MerchantAsset, WalletObservation, WalletDiscoveryPage } from '@nimble/shared'
import { makeRpc, USDT_POLYGON, type Rpc } from './merchantPayments'
export interface WalletDiscoverySource {
 page(input:{asset:MerchantAsset;network:string;recipient:string;cursor:DiscoveryCursor}):Promise<WalletDiscoveryPage>
 refresh(event:WalletObservation):Promise<WalletObservation>
}
const transferTopic='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const equal=(a:unknown,b:unknown)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase()
const hash=(v:unknown,evm=false)=>typeof v==='string'&&(evm?/^0x[\da-f]{64}$/i:/^[\da-f]{64}$/i).test(v)
const height=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0
const fail=():never=>{throw new Error('INVALID_CHAIN_DATA')}
const asHeight=(v:unknown)=>{if(typeof v!=='string'||!/^0x[\da-f]+$/i.test(v)||!Number.isSafeInteger(Number(BigInt(v))))return fail();return Number(BigInt(v))}
const nimAddress=(v:string)=>Address.fromString(v).toUserFriendlyAddress()
const evmAddress=(v:string)=>{if(!/^0x[\da-f]{40}$/i.test(v))return fail();return v.toLowerCase()}
const key=(e:Omit<WalletObservation,'eventKey'>)=>`${e.network}:${e.recipient}:${e.hash}:${e.eventIndex}`
export function makeWalletDiscoverySource(options:{nimiqRpcUrl:string;networkId:5|24;polygonRpcUrl?:string;request?:typeof fetch}):WalletDiscoverySource {
 const nim=makeRpc(options.nimiqRpcUrl,true,options.request)
 const polygon=()=>{if(!options.polygonRpcUrl)throw new Error('HISTORY_SOURCE_UNAVAILABLE');return makeRpc(options.polygonRpcUrl,false,options.request)}
 async function nimNetwork(network:string){const [id,consensus]=await Promise.all([nim('getNetworkId'),nim('isConsensusEstablished')]);if(id!==(options.networkId===24?'MainAlbatross':'TestAlbatross')||network!==`nimiq:${options.networkId}`||consensus!==true)throw new Error('WRONG_OR_UNAVAILABLE_NETWORK')}
 function nimEvent(tx:any,recipient:string):WalletObservation|null {
  if(!tx||typeof tx.to!=='string')return null
  if(nimAddress(tx.to)!==recipient)return null
  if(!hash(tx.hash)||!height(tx.blockNumber)||tx.blockNumber<1||!Number.isSafeInteger(tx.value)||tx.value<=0||!Number.isSafeInteger(tx.timestamp)||tx.timestamp<0||tx.networkId!==options.networkId)return fail()
  const base={asset:'NIM' as const,network:`nimiq:${options.networkId}`,recipient,hash:tx.hash.toLowerCase(),eventIndex:0,sender:typeof tx.from==='string'?nimAddress(tx.from):null,amountAtomic:String(tx.value),blockNumber:tx.blockNumber,blockHash:null,occurredAt:new Date(tx.timestamp).toISOString(),confirmation:'OBSERVED' as const}
  return {...base,eventKey:key(base)}
 }
 async function refreshNim(event:WalletObservation){
  await nimNetwork(event.network)
  const tx=await nim('getTransactionByHash',[event.hash])
  if(!tx||!height(tx.blockNumber)||tx.blockNumber<1)return {...event,confirmation:'OBSERVED' as const}
  const [block,macro]=await Promise.all([nim('getBlockByNumber',[tx.blockNumber,true]),nim('getBlockByNumber',[Policy.macroBlockAfter(tx.blockNumber),false])])
  const canonical=block?.transactions?.find((t:any)=>equal(t.hash,event.hash))
  if(!canonical||canonical.executionResult!==true||block.number!==event.blockNumber||macro?.type!=='macro'||macro.number!==Policy.macroBlockAfter(event.blockNumber))return {...event,confirmation:'OBSERVED' as const}
  const verified=nimEvent(canonical,event.recipient)
  if(!verified||verified.amountAtomic!==event.amountAtomic||verified.sender!==event.sender)return {...event,confirmation:'OBSERVED' as const}
  return {...verified,blockHash:typeof block.hash==='string'?block.hash:null,confirmation:'FINALIZED' as const}
 }
 async function refreshEvm(event:WalletObservation,rpc=polygon()){
  if(event.network!=='eip155:137'||await rpc('eth_chainId')!=='0x89')throw new Error('WRONG_OR_UNAVAILABLE_NETWORK')
  const [receipt,finalized]=await Promise.all([rpc('eth_getTransactionReceipt',[event.hash]),rpc('eth_getBlockByNumber',['finalized',false])])
  if(!receipt||receipt.status!=='0x1'||!equal(receipt.transactionHash,event.hash)||!height(event.blockNumber)||asHeight(finalized?.number)<event.blockNumber)return {...event,confirmation:'OBSERVED' as const}
  const block=await rpc('eth_getBlockByNumber',['0x'+event.blockNumber.toString(16),false])
  if(!equal(block?.hash,receipt.blockHash)||asHeight(receipt.blockNumber)!==event.blockNumber)return {...event,confirmation:'OBSERVED' as const}
  const log=receipt.logs?.find((l:any)=>asHeight(l.logIndex)===event.eventIndex)
  if(!log||!equal(log.transactionHash,event.hash)||!equal(log.blockHash,block.hash)||asHeight(log.blockNumber)!==event.blockNumber||log.removed===true||!equal(log.address,USDT_POLYGON)||!equal(log.topics?.[0],transferTopic)||log.topics.length!==3||!equal(log.topics[2],'0x'+event.recipient.slice(2).padStart(64,'0'))||!equal(log.topics[1],event.sender?'0x'+event.sender.slice(2).padStart(64,'0'):'')||!/^0x[\da-f]{64}$/i.test(log.data)||BigInt(log.data).toString()!==event.amountAtomic)return {...event,confirmation:'OBSERVED' as const}
  return {...event,blockHash:block.hash,occurredAt:new Date(asHeight(block.timestamp)*1000).toISOString(),confirmation:'FINALIZED' as const}
 }
 return {
  refresh:event=>event.asset==='NIM'?refreshNim(event):refreshEvm(event),
  async page(input){
   if(input.asset==='NIM'){
    await nimNetwork(input.network)
    const recipient=nimAddress(input.recipient),rows=await nim('getTransactionsByAddress',[recipient,20,input.cursor.before??null])
    if(!Array.isArray(rows)||rows.length>20||rows.some(row=>!hash(row?.hash)))return fail()
    const candidates=rows.map(row=>nimEvent(row,recipient)).filter((e):e is WalletObservation=>!!e),events:WalletObservation[]=[]
    for(let i=0;i<candidates.length;i+=4)events.push(...await Promise.all(candidates.slice(i,i+4).map(refreshNim)))
    const done=rows.length<20||rows.some(row=>equal(row.hash,input.cursor.checkpoint))
    const head=input.cursor.head??rows[0]?.hash?.toLowerCase()??input.cursor.checkpoint
    const cursor=done?{...(head?{checkpoint:head}:{})}:{...input.cursor,head,before:rows[rows.length-1].hash.toLowerCase()}
    return {events,cursor,done,coveredThrough:null}
   }
   const rpc=polygon(),recipient=evmAddress(input.recipient)
   if(input.network!=='eip155:137'||await rpc('eth_chainId')!=='0x89')throw new Error('WRONG_OR_UNAVAILABLE_NETWORK')
   const finalized=await rpc('eth_getBlockByNumber',['finalized',false]),last=asHeight(finalized?.number),from=input.cursor.nextBlock??0
   if(from>last)return {events:[],cursor:input.cursor,done:true,coveredThrough:last}
   let to=Math.min(last,from+255),rows:any[]=[]
   for(;;){
    const response=await rpc('eth_getLogs',[{address:USDT_POLYGON,fromBlock:'0x'+from.toString(16),toBlock:'0x'+to.toString(16),topics:[transferTopic,null,'0x'+recipient.slice(2).padStart(64,'0')]}])
    if(!Array.isArray(response)||response.length>10000)return fail()
    rows=response
    if(rows.length<=20||to===from)break
    to=from+Math.floor((to-from)/2)
   }
   rows.sort((a,b)=>asHeight(a.blockNumber)-asHeight(b.blockNumber)||asHeight(a.logIndex)-asHeight(b.logIndex))
   const remaining=rows.filter(row=>asHeight(row.blockNumber)>from||asHeight(row.logIndex)>=(input.cursor.nextLogIndex??0))
   const selected=remaining.slice(0,20),partial=remaining.length>selected.length
   const events:WalletObservation[]=[]
   for(const row of selected){
    if(!hash(row.transactionHash,true)||!equal(row.address,USDT_POLYGON)||row.topics?.length!==3||!equal(row.topics[0],transferTopic)||!equal(row.topics[2],'0x'+recipient.slice(2).padStart(64,'0'))||!/^0x[\da-f]{64}$/i.test(row.topics[1])||!/^0x[\da-f]{64}$/i.test(row.data))return fail()
    const blockNumber=asHeight(row.blockNumber);if(blockNumber<from||blockNumber>to)return fail()
    const base={asset:'USDT' as const,network:'eip155:137',recipient,hash:row.transactionHash.toLowerCase(),eventIndex:asHeight(row.logIndex),sender:evmAddress('0x'+row.topics[1].slice(-40)),amountAtomic:BigInt(row.data).toString(),blockNumber,blockHash:typeof row.blockHash==='string'?row.blockHash:null,occurredAt:null,confirmation:row.removed===true?'REMOVED' as const:'OBSERVED' as const}
    const event={...base,eventKey:key(base)}
    events.push(row.removed===true?event:await refreshEvm(event,rpc))
   }
   return {events,cursor:partial?{nextBlock:from,nextLogIndex:asHeight(selected[selected.length-1].logIndex)+1}:{nextBlock:to+1},done:!partial&&to===last,coveredThrough:partial?Math.max(0,from-1):to}
  },
 }
}
