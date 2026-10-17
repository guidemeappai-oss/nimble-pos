import { expect, it } from 'vitest'
import { makeWalletDiscoverySource } from '../src/services/walletDiscoverySource'
import { USDT_POLYGON } from '../src/services/merchantPayments'
const nimAddress='NQ07 0000 0000 0000 0000 0000 0000 0000 0000',recipient='0x'+'1'.repeat(40),sender='0x'+'2'.repeat(40),topic='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const request=(handler:(method:string,params:any[])=>unknown,nim=false)=>(async(_url:any,options:any)=>{const {method,params}=JSON.parse(options.body),result=await handler(method,params);return new Response(JSON.stringify({result:nim?{data:result}:result}),{status:200})}) as typeof fetch
it('verifies a NIM deposit against canonical transactions and macro finality, and rejects the wrong network',async()=>{
 let executed=false
 const tx={hash:'a'.repeat(64),from:nimAddress,to:nimAddress,value:12345,blockNumber:10,timestamp:1792173600000,networkId:5,executionResult:true}
 const source=makeWalletDiscoverySource({nimiqRpcUrl:'https://configured.example',networkId:5,request:request((method,params)=>method==='getNetworkId'?'TestAlbatross':method==='isConsensusEstablished'?true:method==='getTransactionsByAddress'?[tx]:method==='getTransactionByHash'?tx:method==='getBlockByNumber'?params[1]?{number:10,hash:'b'.repeat(64),transactions:[{...tx,executionResult:executed}]}:{number:params[0],type:'macro'}:null,true)})
 const input={asset:'NIM' as const,network:'nimiq:5',recipient:nimAddress,cursor:{}}
 expect((await source.page(input)).events[0].confirmation).toBe('OBSERVED')
 executed=true
 const page=await source.page(input)
 expect(page.events[0]).toMatchObject({confirmation:'FINALIZED',amountAtomic:'12345',hash:tx.hash})
 expect(page.cursor.checkpoint).toBe(tx.hash)
 await expect(source.page({...input,network:'nimiq:24'})).rejects.toThrow('WRONG_OR_UNAVAILABLE_NETWORK')
})
it('reads finalized Polygon Transfer events and paginates multiple deposits in the same block',async()=>{
 const logs=Array.from({length:25},(_,i)=>({address:USDT_POLYGON,topics:[topic,'0x'+sender.slice(2).padStart(64,'0'),'0x'+recipient.slice(2).padStart(64,'0')],data:'0x'+(1000000n).toString(16).padStart(64,'0'),transactionHash:'0x'+(i+1).toString(16).padStart(64,'0'),blockNumber:'0x10',blockHash:'0x'+'b'.repeat(64),logIndex:'0x'+i.toString(16),removed:false}))
 const source=makeWalletDiscoverySource({nimiqRpcUrl:'https://configured.example',networkId:5,polygonRpcUrl:'https://polygon.example',request:request((method,params)=>method==='eth_chainId'?'0x89':method==='eth_getLogs'?logs:method==='eth_getTransactionReceipt'?{transactionHash:params[0],status:'0x1',blockHash:'0x'+'b'.repeat(64),blockNumber:'0x10',logs:logs.filter(l=>l.transactionHash===params[0])}:method==='eth_getBlockByNumber'?{number:'0x10',hash:'0x'+'b'.repeat(64),timestamp:'0x68f0d000'}:null)})
 const input={asset:'USDT' as const,network:'eip155:137',recipient,cursor:{nextBlock:16}}
 const first=await source.page(input)
 expect(first.events).toHaveLength(20);expect(first.cursor).toEqual({nextBlock:16,nextLogIndex:20})
 expect(first.events.every(e=>e.confirmation==='FINALIZED')).toBe(true)
 const second=await source.page({...input,cursor:first.cursor})
 expect(second.events).toHaveLength(5);expect(second.cursor).toEqual({nextBlock:17});expect(second.done).toBe(true)
 expect(new Set([...first.events,...second.events].map(e=>e.eventKey)).size).toBe(25)
})
it('fails closed when a log belongs to another token or network',async()=>{
 const wrong=makeWalletDiscoverySource({nimiqRpcUrl:'https://configured.example',networkId:5,polygonRpcUrl:'https://polygon.example',request:request(method=>method==='eth_chainId'?'0x1':null)})
 await expect(wrong.page({asset:'USDT',network:'eip155:137',recipient,cursor:{nextBlock:16}})).rejects.toThrow('WRONG_OR_UNAVAILABLE_NETWORK')
 const otherToken=makeWalletDiscoverySource({nimiqRpcUrl:'https://configured.example',networkId:5,polygonRpcUrl:'https://polygon.example',request:request(method=>method==='eth_chainId'?'0x89':method==='eth_getBlockByNumber'?{number:'0x10'}:[{address:recipient,topics:[topic,'0x'+sender.slice(2).padStart(64,'0'),'0x'+recipient.slice(2).padStart(64,'0')],data:'0x'+'0'.repeat(63)+'1',transactionHash:'0x'+'a'.repeat(64),logIndex:'0x0',blockNumber:'0x10',blockHash:'0x'+'b'.repeat(64)}])})
 await expect(otherToken.page({asset:'USDT',network:'eip155:137',recipient,cursor:{nextBlock:16}})).rejects.toThrow('INVALID_CHAIN_DATA')
})
