const BITRATES={
 "1-1":[32,64,96,128,160,192,224,256,288,320,352,384,416,448],"1-2":[32,48,56,64,80,96,112,128,160,192,224,256,320,384],"1-3":[32,40,48,56,64,80,96,112,128,160,192,224,256,320],
 "2-1":[32,48,56,64,80,96,112,128,144,160,176,192,224,256],"2-2":[8,16,24,32,40,48,56,64,80,96,112,128,144,160],"2-3":[8,16,24,32,40,48,56,64,80,96,112,128,144,160]
};
const SAMPLE_RATES={1:[44100,48000,32000],2:[22050,24000,16000],2.5:[11025,12000,8000]};
const PREROLL_SECONDS=1.25;
const MAX_CHUNK_BYTES=24_000_000;
const MAX_FRAME_BYTES=8192;
const CHUNK_TAIL_RESERVE=MAX_FRAME_BYTES;
export const MP3_CHUNKER_REVISION="web-mp3-tolerant-resync-vbrmeta-1.3";

class BlobCursor{
 constructor(blob,windowSize=512*1024){this.blob=blob;this.windowSize=windowSize;this.start=-1;this.data=null}
 async bytes(offset,length){if(offset<0||length<0||offset+length>this.blob.size)throw new Error("truncated MP3");if(!this.data||offset<this.start||offset+length>this.start+this.data.length){this.start=offset;const end=Math.min(this.blob.size,offset+Math.max(this.windowSize,length));this.data=new Uint8Array(await this.blob.slice(offset,end).arrayBuffer())}return this.data.subarray(offset-this.start,offset-this.start+length)}
}
function synchsafe(bytes){return ((bytes[0]&127)<<21)|((bytes[1]&127)<<14)|((bytes[2]&127)<<7)|(bytes[3]&127)}
async function leadingId3Size(cursor,size){
 if(size<10)return 0;const h=await cursor.bytes(0,10);if(h[0]!==0x49||h[1]!==0x44||h[2]!==0x33)return 0;
 const major=h[3],revision=h[4],flags=h[5];if(major<2||major>4||revision===0xff)return 0;
 const undefinedMask=major===2?0x3f:major===3?0x1f:0x0f;if((flags&undefinedMask)!==0||h.slice(6,10).some(x=>x>=0x80))return 0;
 const payload=synchsafe(h.subarray(6,10));const footer=(flags&0x10)&&major===4?10:0;const total=10+payload+footer;return total<=256*1024*1024&&total<=size?total:0;
}
async function audioEndExcludingId3v1(cursor,size){
 if(size<128)return size;const h=await cursor.bytes(size-128,3);return h[0]===0x54&&h[1]===0x41&&h[2]===0x47?size-128:size;
}
export function parseFrameHeader(h){
 if(h.length<4||h[0]!==0xff||(h[1]&0xe0)!==0xe0)return null;
 const verBits=(h[1]>>3)&3,layerBits=(h[1]>>1)&3,bitrateIndex=(h[2]>>4)&15,srIndex=(h[2]>>2)&3,padding=(h[2]>>1)&1;
 const version=verBits===3?1:verBits===2?2:verBits===0?2.5:null;const layer=layerBits===3?1:layerBits===2?2:layerBits===1?3:null;
 if(!version||!layer||bitrateIndex===0||bitrateIndex===15||srIndex===3)return null;
 const key=`${version===1?1:2}-${layer}`,table=BITRATES[key],bitrate=table?.[bitrateIndex-1]*1000,sampleRate=SAMPLE_RATES[version]?.[srIndex];if(!bitrate||!sampleRate)return null;
 let frameLength,samples;if(layer===1){frameLength=Math.floor((12*bitrate/sampleRate)+padding)*4;samples=384}else if(layer===2){frameLength=Math.floor(144*bitrate/sampleRate)+padding;samples=1152}else{frameLength=Math.floor((version===1?144:72)*bitrate/sampleRate)+padding;samples=version===1?1152:576}
 if(frameLength<4||frameLength>MAX_FRAME_BYTES)return null;
 return {version,layer,bitrate,sampleRate,padding,protected:(h[1]&1)===0,channelMode:(h[3]>>6)&3,frameLength,samples,duration:samples/sampleRate};
}
function compatibleFrames(a,b){return !!a&&!!b&&a.version===b.version&&a.layer===b.layer&&a.sampleRate===b.sampleRate}
async function frameAt(cursor,offset,end){if(offset<0||offset+4>end)return null;const frame=parseFrameHeader(await cursor.bytes(offset,4));if(!frame)return null;return {...frame,offset,available:end-offset,complete:offset+frame.frameLength<=end}}
async function findNextFrame(cursor,start,end,{knownStream=null,allowSingle=false}={}){
 let pos=Math.max(0,start);
 while(pos+4<=end){
   const len=Math.min(512*1024,end-pos);const data=await cursor.bytes(pos,len);let foundCandidate=false;
   for(let i=0;i+4<=data.length;i++){
     if(data[i]!==0xff||(data[i+1]&0xe0)!==0xe0)continue;
     const off=pos+i;const first=await frameAt(cursor,off,end);if(!first||!first.complete)continue;
     if(knownStream&&!compatibleFrames(first,knownStream))continue;
     const nextOff=off+first.frameLength;
     const second=await frameAt(cursor,nextOff,end);
     if(second&&second.complete&&compatibleFrames(first,second))return first;
     if(allowSingle||nextOff===end||end-nextOff<4)return first;
     foundCandidate=true;
   }
   if(pos+len>=end)return null;
   pos+=Math.max(1,len-3);
   if(foundCandidate)await new Promise(r=>setTimeout(r,0));
 }
 return null;
}
function matchesAscii(data,offset,text){if(offset<0||offset+text.length>data.length)return false;for(let i=0;i<text.length;i++)if(data[offset+i]!==text.charCodeAt(i))return false;return true}
function findVbrMetadataTag(data,frame){
 if(frame.layer!==3)return null;const mono=frame.channelMode===3;const sideInfo=frame.version===1?(mono?17:32):(mono?9:17);const crc=frame.protected?2:0;
 for(const offset of [4+sideInfo,4+sideInfo+crc])if(matchesAscii(data,offset,"Xing")||matchesAscii(data,offset,"Info"))return {offset,type:"xing"};
 for(const offset of [4+32,4+32+crc])if(matchesAscii(data,offset,"VBRI"))return {offset,type:"vbri"};
 return null;
}
function ensureAvailable(data,offset,length){if(offset<0||length<0||offset>data.length-length)throw new Error("The MP3 contains a truncated Xing/Info/VBRI metadata header.")}
function readU32BE(data,offset){ensureAvailable(data,offset,4);return ((data[offset]*0x1000000)+(data[offset+1]<<16)+(data[offset+2]<<8)+data[offset+3])>>>0}
function writeU32BE(data,offset,value){ensureAvailable(data,offset,4);if(!Number.isInteger(value)||value<0||value>0xffffffff)throw new Error("VBR metadata value is out of range.");data[offset]=(value>>>24)&255;data[offset+1]=(value>>>16)&255;data[offset+2]=(value>>>8)&255;data[offset+3]=value&255}
function rewriteVbrMetadataForChunk(metadataFrame,tag,frameOffsets,totalBytes){
 if(!tag||!frameOffsets.length||totalBytes<=0||totalBytes>0xffffffff)throw new Error("Invalid VBR metadata rewrite state.");const out=metadataFrame.slice();const frameCount=frameOffsets.length;
 if(tag.type==="vbri"){ensureAvailable(out,tag.offset+10,8);writeU32BE(out,tag.offset+10,totalBytes);writeU32BE(out,tag.offset+14,frameCount);return out}
 ensureAvailable(out,tag.offset+4,4);const flags=readU32BE(out,tag.offset+4);let cursor=tag.offset+8;
 if((flags&0x0001)!==0){writeU32BE(out,cursor,frameCount);cursor+=4}
 if((flags&0x0002)!==0){writeU32BE(out,cursor,totalBytes);cursor+=4}
 if((flags&0x0004)!==0){ensureAvailable(out,cursor,100);for(let p=0;p<100;p++){const i=Math.min(frameCount-1,Math.floor(p*frameCount/100));const off=frameOffsets[i];if(off<0||off>=totalBytes)throw new Error("The chunk contains an invalid MPEG frame offset.");out[cursor+p]=Math.max(0,Math.min(255,Math.floor(off*256/totalBytes)))}}
 return out;
}
function selectPreroll(recent,maxBytes){let bytes=0,duration=0,start=recent.length;for(let i=recent.length-1;i>=0;i--){const f=recent[i];if(bytes+f.length>maxBytes||duration+f.duration>PREROLL_SECONDS+1e-9)break;bytes+=f.length;duration+=f.duration;start=i}return {frames:recent.slice(start),bytes,duration}}
function finalizeChunk(current){
 if(current.metadataFrame&&current.metadataTag)current.metadataRewrite=rewriteVbrMetadataForChunk(current.metadataFrame,current.metadataTag,current.frameOffsets,current.bytes);
 delete current.metadataFrame;delete current.metadataTag;delete current.frameOffsets;return current;
}
export async function inspectAndChunkMp3(blob,{targetBytes=20_000_000,maxMinutes=5,diarize=false,onProgress}={}){
 if(!(blob instanceof Blob)||blob.size===0)throw new Error("The MP3 file is empty.");targetBytes=Math.min(MAX_CHUNK_BYTES-CHUNK_TAIL_RESERVE,Math.max(5_000_000,Math.floor(targetBytes)));const maxDuration=Math.min(5,Math.max(3,maxMinutes))*60;
 const cursor=new BlobCursor(blob);const declaredStart=await leadingId3Size(cursor,blob.size);const declaredEnd=await audioEndExcludingId3v1(cursor,blob.size);if(declaredEnd<=declaredStart)throw new Error("No usable MP3 audio was found.");
 const recoveries={leadingBytes:0,trailingBytes:blob.size-declaredEnd,gaps:[],terminalPartialBytes:0};
 let first=await findNextFrame(cursor,declaredStart,declaredEnd,{allowSingle:false});if(!first)throw new Error("No valid MP3 audio frames were found.");recoveries.leadingBytes=first.offset-declaredStart;let offset=first.offset;const audioStart=offset;let audioEnd=declaredEnd;
 let frameNo=0,logicalStart=0,totalDuration=0,current=null,recent=[],chunks=[],metadataCarrier=false,lastProgress=0,segmentFirst=true,streamHint=null;
 const startChunk=(start,prerollFrames=[])=>{const prBytes=prerollFrames.reduce((n,f)=>n+f.length,0),prDuration=prerollFrames.reduce((n,f)=>n+f.duration,0);let pos=0;const frameOffsets=[];for(const f of prerollFrames){frameOffsets.push(pos);pos+=f.length}return {index:chunks.length+1,sourceStart:start,sourceEnd:start+prBytes,logicalSourceStart:null,logicalSourceEnd:null,bytes:prBytes,logicalStart,duration:0,prerollDuration:prDuration,frameOffsets,metadataRewrite:null}};
 const closeCurrent=()=>{if(current&&current.duration>0){chunks.push({...finalizeChunk(current)});logicalStart+=current.duration}current=null;recent=[]};
 while(offset+4<=audioEnd){
   let frame=await frameAt(cursor,offset,audioEnd,{knownFreeBaseLength:streamHint?.freeFormat?streamHint.freeBaseLength:null});
   if(!frame){
     const next=await findNextFrame(cursor,offset+1,audioEnd,{knownStream:streamHint,allowSingle:false})||await findNextFrame(cursor,offset+1,audioEnd,{allowSingle:false});
     if(!next){recoveries.trailingBytes+=audioEnd-offset;audioEnd=offset;break}
     recoveries.gaps.push({start:offset,end:next.offset,bytes:next.offset-offset});closeCurrent();offset=next.offset;segmentFirst=true;streamHint=null;continue;
   }
   if(!frame.complete){
     const available=audioEnd-offset;
     if(frameNo>0&&available>=4){
       recoveries.terminalPartialBytes=available;
       if(current&&current.duration>0&&current.bytes+available<=MAX_CHUNK_BYTES){current.bytes+=available;current.sourceEnd=audioEnd}
       else if(chunks.length&&chunks[chunks.length-1].bytes+available<=MAX_CHUNK_BYTES){chunks[chunks.length-1].bytes+=available;chunks[chunks.length-1].sourceEnd=audioEnd}
       else {recoveries.trailingBytes+=available}
       offset=audioEnd;break;
     }
     throw new Error("No complete MP3 audio frame was found.");
   }
   streamHint=frame;frameNo++;
   if(segmentFirst){
     const frameData=(await cursor.bytes(offset,frame.frameLength)).slice();const tag=findVbrMetadataTag(frameData,frame);
     if(tag){metadataCarrier=true;if(!current)current=startChunk(offset);current.metadataFrame=frameData;current.metadataTag=tag;current.frameOffsets.push(current.bytes);current.bytes+=frame.frameLength;current.sourceEnd=offset+frame.frameLength;offset+=frame.frameLength;segmentFirst=false;continue}
     segmentFirst=false;
   }
   if(!current)current=startChunk(offset);
   const exceedsBytes=current.bytes+frame.frameLength>targetBytes,exceedsDuration=current.duration+frame.duration>maxDuration;
   if(current.duration>0&&(exceedsBytes||exceedsDuration)){
     chunks.push({...finalizeChunk(current)});logicalStart+=current.duration;
     const pr=diarize?{frames:[],bytes:0,duration:0}:selectPreroll(recent,Math.max(0,targetBytes-frame.frameLength));const start=pr.frames.length?pr.frames[0].offset:offset;current=startChunk(start,pr.frames);current.sourceEnd=offset;
   }
   if(current.logicalSourceStart===null)current.logicalSourceStart=offset;current.frameOffsets.push(current.bytes);current.bytes+=frame.frameLength;current.duration+=frame.duration;current.sourceEnd=offset+frame.frameLength;current.logicalSourceEnd=offset+frame.frameLength;totalDuration+=frame.duration;
   recent.push({offset,length:frame.frameLength,duration:frame.duration});let rd=recent.reduce((a,b)=>a+b.duration,0);while(recent.length&&rd-recent[0].duration>=PREROLL_SECONDS){rd-=recent.shift().duration}
   offset+=frame.frameLength;const p=audioEnd?offset/audioEnd:1;if(p-lastProgress>=.01){lastProgress=p;onProgress?.(p);await new Promise(r=>setTimeout(r,0))}
 }
 if(current&&current.duration>0)chunks.push({...finalizeChunk(current)});
 if(!chunks.length||totalDuration<=0)throw new Error("No valid MP3 audio frames were found.");
 for(const c of chunks){if(c.bytes>MAX_CHUNK_BYTES)throw new Error("Generated chunk exceeds the 24 MB application ceiling.");if(c.sourceEnd<=c.sourceStart||c.logicalSourceStart===null||c.logicalSourceEnd<=c.logicalSourceStart)throw new Error("Invalid chunk boundary.")}
 for(let i=1;i<chunks.length;i++)if(chunks[i-1].logicalSourceEnd>chunks[i].logicalSourceStart)throw new Error("Logical MP3 frame ordering check failed.");
 onProgress?.(1);return {audioStart,audioEnd,frameCount:frameNo,duration:totalDuration,chunks,metadataCarrier,recoveries,chunkerRevision:MP3_CHUNKER_REVISION};
}
export function materializeChunk(blob,chunk){
 if(chunk.metadataRewrite instanceof Uint8Array){const tailStart=chunk.sourceStart+chunk.metadataRewrite.byteLength;if(tailStart>chunk.sourceEnd)throw new Error("Invalid rewritten MP3 metadata frame.");return new Blob([chunk.metadataRewrite,blob.slice(tailStart,chunk.sourceEnd)],{type:"audio/mpeg"})}
 return blob.slice(chunk.sourceStart,chunk.sourceEnd,"audio/mpeg");
}
