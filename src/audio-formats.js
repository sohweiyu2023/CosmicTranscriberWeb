import { ApiError } from './errors.js';
import { MAX_AUDIO_BYTES } from './config.js';

export const AUDIO_FORMATS = Object.freeze({
  mp3: Object.freeze({ extension:'mp3', mime:'audio/mpeg', processingRevision:'web-mp3-tolerant-resync-vbrmeta-1.3', chunking:'mp3' }),
  flac: Object.freeze({ extension:'flac', mime:'audio/flac', processingRevision:'whole-v1', chunking:'whole' }),
  mp4: Object.freeze({ extension:'mp4', mime:'audio/mp4', processingRevision:'whole-v1', chunking:'whole' }),
  mpeg: Object.freeze({ extension:'mpeg', mime:'audio/mpeg', processingRevision:'whole-v1', chunking:'whole' }),
  mpga: Object.freeze({ extension:'mpga', mime:'audio/mpeg', processingRevision:'whole-v1', chunking:'whole' }),
  m4a: Object.freeze({ extension:'m4a', mime:'audio/mp4', processingRevision:'whole-v1', chunking:'whole' }),
  ogg: Object.freeze({ extension:'ogg', mime:'audio/ogg', processingRevision:'whole-v1', chunking:'whole' }),
  wav: Object.freeze({ extension:'wav', mime:'audio/wav', processingRevision:'whole-v1', chunking:'whole' }),
  webm: Object.freeze({ extension:'webm', mime:'audio/webm', processingRevision:'whole-v1', chunking:'whole' })
});

export const SUPPORTED_AUDIO_FORMATS = Object.freeze(Object.keys(AUDIO_FORMATS));

const MIME_ALIASES = Object.freeze({
  'audio/mp3':'audio/mpeg',
  'audio/x-mp3':'audio/mpeg',
  'audio/x-mpeg':'audio/mpeg',
  'audio/x-m4a':'audio/mp4',
  'video/mp4':'audio/mp4',
  'audio/x-wav':'audio/wav',
  'audio/wave':'audio/wav',
  'audio/vnd.wave':'audio/wav',
  'application/ogg':'audio/ogg',
  'video/webm':'audio/webm',
  'audio/x-flac':'audio/flac'
});

export function canonicalMime(value){
  const mime=String(value||'').split(';',1)[0].trim().toLowerCase();
  return MIME_ALIASES[mime]||mime;
}

export function formatSpec(format){
  const spec=AUDIO_FORMATS[format];
  if(!spec) throw new ApiError(415,'unsupported_audio_format','The audio format is not supported.');
  return spec;
}

export function validateFormatMime(format,mime){
  const spec=formatSpec(format);
  if(canonicalMime(mime)!==spec.mime) throw new ApiError(415,'content_type_rejected','Audio format and Content-Type do not match.');
  return spec;
}

function ascii4(bytes,offset){return String.fromCharCode(bytes[offset],bytes[offset+1],bytes[offset+2],bytes[offset+3]);}
function u32be(bytes,offset){return ((bytes[offset]*0x1000000)+(bytes[offset+1]<<16)+(bytes[offset+2]<<8)+bytes[offset+3])>>>0;}
function u64beSafe(bytes,offset){
  let n=0;
  for(let i=0;i<8;i++){n=n*256+bytes[offset+i];if(!Number.isSafeInteger(n))return null;}
  return n;
}

export function looksLikeIsoBmff(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<16)return false;
  const limit=Math.min(bytes.length,64*1024);
  let offset=0,boxes=0;
  while(offset+8<=limit&&boxes<16){
    boxes++;
    const size32=u32be(bytes,offset);
    const type=ascii4(bytes,offset+4);
    let header=8,size=size32;
    if(size32===1){
      if(offset+16>limit)return false;
      size=u64beSafe(bytes,offset+8);header=16;
      if(size===null)return false;
    }else if(size32===0){
      size=bytes.length-offset;
    }
    if(size<header||!Number.isSafeInteger(size))return false;
    const end=offset+size;
    if(end>bytes.length)return false;
    if(type==='ftyp'){
      if(size<header+8||end>limit)return false;
      const major=bytes.subarray(offset+header,offset+header+4);
      if(major.length!==4||major.every(b=>b===0))return false;
      return true;
    }
    if(end<=offset)return false;
    if(end>limit)return false;
    offset=end;
  }
  return false;
}

const BITRATES = Object.freeze({
  '1-1':[0,32,64,96,128,160,192,224,256,288,320,352,384,416,448],
  '1-2':[0,32,48,56,64,80,96,112,128,160,192,224,256,320,384],
  '1-3':[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],
  '2-1':[0,32,48,56,64,80,96,112,128,144,160,176,192,224,256],
  '2-2':[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
  '2-3':[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160]
});
const SAMPLE_RATES = Object.freeze({1:[44100,48000,32000],2:[22050,24000,16000],2.5:[11025,12000,8000]});

export function mpegFrameInfo(bytes,offset){
  if(!(bytes instanceof Uint8Array)||offset<0||offset+4>bytes.length)return null;
  const b1=bytes[offset],b2=bytes[offset+1],b3=bytes[offset+2],b4=bytes[offset+3];
  if(b1!==0xff||(b2&0xe0)!==0xe0)return null;
  const versionBits=(b2>>3)&3;
  if(versionBits===1)return null;
  const version=versionBits===3?1:versionBits===2?2:2.5;
  const layerBits=(b2>>1)&3;
  if(layerBits===0)return null;
  const layer=4-layerBits;
  const bitrateIndex=(b3>>4)&15,sampleIndex=(b3>>2)&3,padding=(b3>>1)&1;
  if(bitrateIndex===0||bitrateIndex===15||sampleIndex===3)return null;
  if((b4&3)===2)return null; // reserved emphasis
  const tableVersion=version===1?'1':'2';
  const bitrates=BITRATES[`${tableVersion}-${layer}`];
  const bitrateKbps=bitrates?.[bitrateIndex];
  const sampleRate=SAMPLE_RATES[version]?.[sampleIndex];
  if(!bitrateKbps||!sampleRate)return null;
  let frameLength;
  if(layer===1) frameLength=Math.floor((12*bitrateKbps*1000/sampleRate)+padding)*4;
  else if(layer===3&&version!==1) frameLength=Math.floor((72*bitrateKbps*1000/sampleRate)+padding);
  else frameLength=Math.floor((144*bitrateKbps*1000/sampleRate)+padding);
  if(!Number.isSafeInteger(frameLength)||frameLength<4||offset+frameLength>bytes.length)return null;
  return {version,layer,bitrateKbps,sampleRate,frameLength};
}

function id3AudioStart(bytes){
  if(bytes.length<3||ascii4(Uint8Array.from([bytes[0]||0,bytes[1]||0,bytes[2]||0,0]),0).slice(0,3)!=='ID3')return 0;
  if(bytes.length<10)return null;
  const version=bytes[3];
  if(version<2||version>4||bytes[4]===0xff)return null;
  const flags=bytes[5];
  if((bytes[6]|bytes[7]|bytes[8]|bytes[9])&0x80)return null;
  const payload=(bytes[6]<<21)|(bytes[7]<<14)|(bytes[8]<<7)|bytes[9];
  const footer=version===4&&(flags&0x10)?10:0;
  const end=10+payload+footer;
  if(end>bytes.length||end>64*1024)return null;
  return end;
}

export function looksLikeMpegAudio(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<8)return false;
  const start=id3AudioStart(bytes);
  if(start===null)return false;
  const scanEnd=Math.min(bytes.length-4,start+4096);
  for(let i=start;i<=scanEnd;i++){
    const first=mpegFrameInfo(bytes,i);
    if(!first) continue;
    const nextOffset=i+first.frameLength;
    const second=mpegFrameInfo(bytes,nextOffset);
    if(second&&second.version===first.version&&second.layer===first.layer&&second.sampleRate===first.sampleRate)return true;
  }
  return false;
}

// MPGA uploads use an MP3 filename upstream. Prove Layer III across the
// complete upload before that alias is allowed; a two-frame sniff is not
// enough to rule out mixed layers or a truncated tail. Bitrate may vary.
export function looksLikeMpegLayer3(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<8)return false;
  let offset=id3AudioStart(bytes);
  if(offset===null)return false;
  let first=null,frames=0;
  while(offset<bytes.length){
    // ID3v1 is the only supported trailing tag; never skip unknown bytes.
    if(frames>=2&&bytes.length-offset===128&&
       bytes[offset]===0x54&&bytes[offset+1]===0x41&&bytes[offset+2]===0x47)return true;
    const frame=mpegFrameInfo(bytes,offset);
    if(!frame||frame.layer!==3)return false;
    if(first&&(frame.version!==first.version||frame.sampleRate!==first.sampleRate))return false;
    first||=frame;
    frames++;
    offset+=frame.frameLength;
  }
  return frames>=2;
}

export function validateAudioSignature(format,bytes){
  if(!(bytes instanceof Uint8Array))return false;
  switch(format){
    case 'wav': return bytes.length>=12&&ascii4(bytes,0)==='RIFF'&&ascii4(bytes,8)==='WAVE';
    case 'flac': return bytes.length>=4&&ascii4(bytes,0)==='fLaC';
    case 'ogg': return bytes.length>=4&&ascii4(bytes,0)==='OggS';
    case 'webm': return bytes.length>=4&&bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3;
    case 'mp4': case 'm4a': return looksLikeIsoBmff(bytes);
    case 'mp3': case 'mpeg': return looksLikeMpegAudio(bytes);
    case 'mpga': return looksLikeMpegLayer3(bytes);
    default: return false;
  }
}

export async function readAndValidateAudioBody(request,metadata){
  const format=metadata.audioFormat||'mp3';
  const spec=validateFormatMime(format,request.headers.get('Content-Type'));
  const expected=metadata.declaredBytes;
  if(!Number.isSafeInteger(expected)||expected<1||expected>MAX_AUDIO_BYTES)throw new ApiError(413,'audio_too_large','The audio upload exceeds the application limit.');
  const reader=request.body?.getReader();
  if(!reader)throw new ApiError(400,'audio_missing','Audio body is missing.');
  const chunks=[];let total=0;
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      total+=value.byteLength;
      if(total>MAX_AUDIO_BYTES||total>expected){try{await reader.cancel('audio limit exceeded')}catch{};throw new ApiError(413,'audio_too_large','The audio upload exceeds the application limit.');}
      chunks.push(value);
    }
  }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,'audio_read_failed','The audio upload could not be read safely.');}
  if(total!==expected)throw new ApiError(400,'size_mismatch','Declared audio size does not match the uploaded body.');
  const all=new Uint8Array(total);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}
  if(!validateAudioSignature(format,all))throw new ApiError(415,'audio_signature_rejected',`The uploaded .${spec.extension} content does not match its declared audio format.`);
  return all;
}
