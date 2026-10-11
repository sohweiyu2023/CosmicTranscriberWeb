export const MAX_DIRECT_AUDIO_BYTES=24_000_000;
export const AUDIO_FORMATS=Object.freeze({
  mp3:Object.freeze({extension:'mp3',mime:'audio/mpeg',processingRevision:'web-mp3-tolerant-resync-vbrmeta-1.3',chunking:'mp3'}),
  flac:Object.freeze({extension:'flac',mime:'audio/flac',processingRevision:'whole-v1',chunking:'whole'}),
  mp4:Object.freeze({extension:'mp4',mime:'audio/mp4',processingRevision:'whole-v1',chunking:'whole'}),
  mpeg:Object.freeze({extension:'mpeg',mime:'audio/mpeg',processingRevision:'whole-v1',chunking:'whole'}),
  mpga:Object.freeze({extension:'mpga',mime:'audio/mpeg',processingRevision:'whole-v1',chunking:'whole'}),
  m4a:Object.freeze({extension:'m4a',mime:'audio/mp4',processingRevision:'whole-v1',chunking:'whole'}),
  ogg:Object.freeze({extension:'ogg',mime:'audio/ogg',processingRevision:'whole-v1',chunking:'whole'}),
  wav:Object.freeze({extension:'wav',mime:'audio/wav',processingRevision:'whole-v1',chunking:'whole'}),
  webm:Object.freeze({extension:'webm',mime:'audio/webm',processingRevision:'whole-v1',chunking:'whole'})
});
export const SUPPORTED_AUDIO_FORMATS=Object.freeze(Object.keys(AUDIO_FORMATS));
export const FILE_ACCEPT=SUPPORTED_AUDIO_FORMATS.map(x=>`.${x}`).join(',');
const aliases=Object.freeze({'audio/mp3':'audio/mpeg','audio/x-mp3':'audio/mpeg','audio/x-mpeg':'audio/mpeg','audio/x-m4a':'audio/mp4','video/mp4':'audio/mp4','audio/x-wav':'audio/wav','audio/wave':'audio/wav','audio/vnd.wave':'audio/wav','application/ogg':'audio/ogg','video/webm':'audio/webm','audio/x-flac':'audio/flac'});
export function canonicalMime(v){const m=String(v||'').split(';',1)[0].trim().toLowerCase();return aliases[m]||m}
export function fileAudioFormat(file){
  const match=/\.([^.]+)$/.exec(String(file?.name||'').toLowerCase());
  const format=match?.[1]||'';const spec=AUDIO_FORMATS[format];
  if(!spec)throw new Error(`Unsupported audio format. Use ${SUPPORTED_AUDIO_FORMATS.map(x=>x.toUpperCase()).join(', ')}.`);
  // Windows browsers may label raw .mpeg audio video/mpeg. This is only a
  // browser hint; content checks still require raw audio frames.
  const mime=canonicalMime(file?.type),browserMpegHint=format==='mpeg'&&mime==='video/mpeg';
  if(file?.type&&mime!==spec.mime&&!browserMpegHint)throw new Error(`The .${format} extension does not match the file MIME type ${file.type}.`);
  return format;
}
export function formatSpec(format){const spec=AUDIO_FORMATS[format];if(!spec)throw new Error('Unsupported audio format.');return spec}
function ascii4(b,o){return String.fromCharCode(b[o],b[o+1],b[o+2],b[o+3])}
function u32be(b,o){return ((b[o]*0x1000000)+(b[o+1]<<16)+(b[o+2]<<8)+b[o+3])>>>0}
function u64(b,o){let n=0;for(let i=0;i<8;i++){n=n*256+b[o+i];if(!Number.isSafeInteger(n))return null}return n}
export function looksLikeIsoBmff(bytes){if(!(bytes instanceof Uint8Array)||bytes.length<16)return false;const limit=Math.min(bytes.length,64*1024);let off=0,n=0;while(off+8<=limit&&n++<16){const s32=u32be(bytes,off),type=ascii4(bytes,off+4);let h=8,size=s32;if(s32===1){if(off+16>limit)return false;size=u64(bytes,off+8);h=16;if(size===null)return false}else if(s32===0)size=bytes.length-off;if(size<h||!Number.isSafeInteger(size))return false;const end=off+size;if(end>bytes.length)return false;if(type==='ftyp')return size>=h+8&&end<=limit&&!bytes.subarray(off+h,off+h+4).every(x=>x===0);if(end<=off||end>limit)return false;off=end}return false}
const BR=Object.freeze({'1-1':[0,32,64,96,128,160,192,224,256,288,320,352,384,416,448],'1-2':[0,32,48,56,64,80,96,112,128,160,192,224,256,320,384],'1-3':[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],'2-1':[0,32,48,56,64,80,96,112,128,144,160,176,192,224,256],'2-2':[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],'2-3':[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160]});
const SR=Object.freeze({1:[44100,48000,32000],2:[22050,24000,16000],2.5:[11025,12000,8000]});
export function mpegFrameInfo(b,o){if(!(b instanceof Uint8Array)||o<0||o+4>b.length)return null;const b1=b[o],b2=b[o+1],b3=b[o+2],b4=b[o+3];if(b1!==255||(b2&224)!==224)return null;const vb=(b2>>3)&3;if(vb===1)return null;const version=vb===3?1:vb===2?2:2.5,lb=(b2>>1)&3;if(lb===0)return null;const layer=4-lb,bi=(b3>>4)&15,si=(b3>>2)&3,p=(b3>>1)&1;if(bi===0||bi===15||si===3||(b4&3)===2)return null;const br=BR[`${version===1?'1':'2'}-${layer}`]?.[bi],sr=SR[version]?.[si];if(!br||!sr)return null;let len;if(layer===1)len=Math.floor(12*br*1000/sr+p)*4;else if(layer===3&&version!==1)len=Math.floor(72*br*1000/sr+p);else len=Math.floor(144*br*1000/sr+p);if(!Number.isSafeInteger(len)||len<4||o+len>b.length)return null;return{version,layer,sampleRate:sr,frameLength:len}}
function id3Start(b){if(b.length<3||String.fromCharCode(b[0],b[1],b[2])!=='ID3')return 0;if(b.length<10)return null;const v=b[3];if(v<2||v>4||b[4]===255||(b[6]|b[7]|b[8]|b[9])&128)return null;const size=(b[6]<<21)|(b[7]<<14)|(b[8]<<7)|b[9],end=10+size+(v===4&&(b[5]&16)?10:0);return end<=b.length&&end<=64*1024?end:null}
export function looksLikeMpegAudio(b,maxLeadingBytes=4096){if(!(b instanceof Uint8Array)||b.length<8)return false;const start=id3Start(b);if(start===null)return false;for(let i=start;i<=Math.min(b.length-4,start+maxLeadingBytes);i++){const first=mpegFrameInfo(b,i);if(!first)continue;const second=mpegFrameInfo(b,i+first.frameLength);if(second&&second.version===first.version&&second.layer===first.layer&&second.sampleRate===first.sampleRate)return true}return false}
export function validateAudioSignature(format,b){switch(format){case'wav':return b.length>=12&&ascii4(b,0)==='RIFF'&&ascii4(b,8)==='WAVE';case'flac':return b.length>=4&&ascii4(b,0)==='fLaC';case'ogg':return b.length>=4&&ascii4(b,0)==='OggS';case'webm':return b.length>=4&&b[0]===0x1a&&b[1]===0x45&&b[2]===0xdf&&b[3]===0xa3;case'mp4':case'm4a':return looksLikeIsoBmff(b);case'mp3':case'mpeg':case'mpga':return looksLikeMpegAudio(b);default:return false}}
export async function validateWholeFile(file,format){
  if(!(file instanceof Blob)||file.size<1)throw new Error('File is empty.');
  if(file.size>MAX_DIRECT_AUDIO_BYTES)throw new Error('Non-MP3 files must be 24 MB or smaller.');
  const bytes=new Uint8Array(await file.slice(0,Math.min(file.size,64*1024)).arrayBuffer());
  // For the ambiguous Windows hint, require raw frames immediately after any
  // ID3 tag, not audio frames found inside a leading MPEG video/program container.
  const valid=format==='mpeg'&&canonicalMime(file.type)==='video/mpeg'
    ?looksLikeMpegAudio(bytes,0):validateAudioSignature(format,bytes);
  if(!valid)throw new Error(`The .${format} file signature/container is invalid or unsupported.`);
  return true;
}
export function wholeFileInspection(file,duration=0.001){return{duration:Math.max(0.001,Number.isFinite(duration)?duration:0.001),chunks:[{index:1,sourceStart:0,sourceEnd:file.size,bytes:file.size,logicalStart:0,logicalSourceStart:0,logicalSourceEnd:file.size,duration:Math.max(0.001,Number.isFinite(duration)?duration:0.001),prerollDuration:0}]}}
