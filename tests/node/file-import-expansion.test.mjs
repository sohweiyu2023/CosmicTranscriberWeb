import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {detectFileAudioFormat,validateWholeFile,requireIsoAudioTrack,FILE_ACCEPT,MAX_DIRECT_AUDIO_BYTES} from '../../public/js/audio-formats.js';
import {dispatchTranscription} from '../../src/openai.js';
import {inspectAndChunkMp3} from '../../public/js/mp3.js';
const fixture=name=>readFile(new URL('../fixtures/'+name,import.meta.url));
for(const source of ['format-alac.m4a','video-with-audio.mp4'])test('different real codec/container fixture '+source,async()=>{
 const bytes=await fixture(source),format=source.endsWith('.m4a')?'m4a':'mp4';const file=new File([bytes],source,{type:format==='m4a'?'audio/mp4':'video/mp4'});assert.equal(await detectFileAudioFormat(file),format);assert.equal(await validateWholeFile(file,format),true);
 let calls=0;await dispatchTranscription({requestBody:file.stream(),metadata:{attemptId:'synthetic-codec-check',declaredBytes:bytes.length,durationSeconds:1,model:'gpt-transcribe',audioFormat:format,languages:[],keywords:[],prompt:''},apiKey:'synthetic-not-a-key',fetchImpl:async(url,init)=>{calls++;const submitted=(await new Request(url,{method:'POST',headers:init.headers,body:await new Response(init.body).arrayBuffer()}).formData()).get('file');assert.deepEqual(Buffer.from(await submitted.arrayBuffer()),bytes);assert.equal(submitted.name,'audio.'+format);return new Response('{"text":"mock only"}',{status:200})}});assert.equal(calls,1);
});
test('actual370second MP3 uses bounded cursor reads and produces bounded chunks without WebAudio',async()=>{
 const bytes=await fixture('cbr-128k-370s.mp3'),reads=[];
 class ObservedBlob extends Blob{slice(start,end,type){reads.push((end??this.size)-(start??0));return super.slice(start,end,type)}}
 const result=await inspectAndChunkMp3(new ObservedBlob([bytes]),{targetBytes:5_000_000,maxMinutes:3,diarize:false});
 assert.ok(Math.abs(result.duration-370.05)<0.2);assert.ok(result.chunks.length>=2);assert.ok(result.chunks.every(c=>c.bytes<=24_000_000));assert.ok(Math.max(...reads)<=512*1024);assert.ok(reads.length>1);
});
test('Web source never invokes whole-file decodeAudioData or creates AudioContext',async()=>{
 for(const name of ['audio-formats.js','app.js','mp3.js']){const source=await readFile(new URL('../../public/js/'+name,import.meta.url),'utf8');assert.doesNotMatch(source,/decodeAudioData\s*\(|new\s+(?:Offline)?AudioContext\s*\(/)}
});
const concat=(...xs)=>Buffer.concat(xs.map(x=>Buffer.from(x)));
function box(type,body=Buffer.alloc(0),extended=false){const header=Buffer.alloc(extended?16:8);header.writeUInt32BE(extended?1:header.length+body.length);header.write(type,4,4,'ascii');if(extended)header.writeBigUInt64BE(BigInt(header.length+body.length),8);return concat(header,body)}
const ftyp=()=>box('ftyp',Buffer.from('M4A \0\0\0\0isom'));
const handler=()=>{const b=Buffer.alloc(12);b.write('soun',8);return box('hdlr',b)};
const movie=()=>box('moov',box('trak',box('mdia',handler())));
test('BMFF extended headers work but unsafe and truncated sizes fail closed',async()=>{
 const good=box('moov',box('trak',box('mdia',handler())),true);assert.equal(await requireIsoAudioTrack(new Blob([ftyp(),good])),true);
 const unsafe=Buffer.alloc(16);unsafe.writeUInt32BE(1);unsafe.write('moov',4);unsafe.writeBigUInt64BE(9007199254740992n,8);await assert.rejects(()=>requireIsoAudioTrack(new Blob([ftyp(),unsafe])),/bounds/);
 const short=Buffer.alloc(8);short.writeUInt32BE(1);short.write('moov',4);await assert.rejects(()=>requireIsoAudioTrack(new Blob([ftyp(),short])),/Truncated/);
});
test('BMFF duplicate/missing movie metadata and malformed tails are explicit failures',async()=>{
 for(const [bytes,message] of [[concat(ftyp(),movie(),movie()),/Multiple/],[ftyp(),/missing/],[concat(ftyp(),movie(),[1]),/missing or corrupt/],[concat(ftyp(),box('moov',Buffer.from([1,2]))),/tail/],[concat(ftyp(),box('moov',box('trak',box('mdia',box('hdlr',Buffer.alloc(11)))))),/handler/]])await assert.rejects(()=>requireIsoAudioTrack(new Blob([bytes])),message);
});
test('BMFF topbox, node and metadata byte limits are enforced',async()=>{
 await assert.rejects(()=>requireIsoAudioTrack(new Blob([ftyp(),...Array.from({length:128},()=>box('free')),movie()])),/box limit/);
 await assert.rejects(()=>requireIsoAudioTrack(new Blob([ftyp(),box('moov',concat(...Array.from({length:1025},()=>box('free'))))])),/node limit/);
 await assert.rejects(()=>requireIsoAudioTrack(new Blob([ftyp(),box('moov',Buffer.alloc(1024*1024))])),/1 MB/);
});
test('soun bytes outside moov/trak/mdia/hdlr never manufacture an audio stream',async()=>{
 for(const moov of [box('moov',handler()),box('moov',box('trak',handler())),box('moov',box('free',Buffer.from('soun')))])await assert.rejects(()=>requireIsoAudioTrack(new Blob([ftyp(),box('mdat',Buffer.from('hdlr soun')),moov])),/No audio stream/);
});
test('exact24MB direct metadata inspection is allowed and one extra byte is rejected',async()=>{
 const prefix=concat(ftyp(),movie());const filler=box('free',Buffer.alloc(MAX_DIRECT_AUDIO_BYTES-prefix.length-8));const file=new File([prefix,filler],'boundary.m4a',{type:'audio/mp4'});assert.equal(file.size,MAX_DIRECT_AUDIO_BYTES);assert.equal(await validateWholeFile(file,'m4a'),true);
 await assert.rejects(()=>validateWholeFile(new File([file,new Uint8Array([0])],'too-large.m4a'),'m4a'),/24 MB/);
});
for(const [name,source,type,format] of [
 ['recording.M4A','format.m4a','audio/x-m4a','m4a'],['recording.m4a','format.m4a','audio/m4a','m4a'],
 ['book.m4b','format.m4a','application/octet-stream','m4a'],['tone.m4r','format.m4a','','m4a'],
 ['movie.m4v','format.mp4','video/mp4','mp4'],['movie.mov','format.mp4','video/quicktime','mp4'],
 ['voice.oga','format.ogg','audio/ogg','ogg'],['voice.opus','format.opus','audio/ogg','ogg'],
 ['voice.wave','format.wav','audio/wav','wav'],['recording.data','format.m4a','application/octet-stream','mp4'],
 ['recording','format.flac','','flac']
])test('content-probed import '+name+' '+type,async()=>{
 const bytes=await fixture(source),file=new File([bytes],name,{type});const detected=await detectFileAudioFormat(file);assert.equal(detected,format);assert.equal(await validateWholeFile(file,detected),true);assert.deepEqual(Buffer.from(await file.arrayBuffer()),bytes);
});
test('canonical M4A submission preserves real AAC fixture bytes and uses one mocked request',async()=>{
 const bytes=await fixture('format.m4a');const original=new File([bytes],'book.m4b',{type:'application/octet-stream'});const audioFormat=await detectFileAudioFormat(original);await validateWholeFile(original,audioFormat);
 let calls=0,submitted;const result=await dispatchTranscription({requestBody:original.stream(),metadata:{attemptId:'synthetic-format-1',declaredBytes:bytes.length,durationSeconds:1,model:'gpt-transcribe',audioFormat,languages:['en'],keywords:[],prompt:''},apiKey:'synthetic-not-a-key',fetchImpl:async(url,init)=>{calls++;assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');const body=await new Response(init.body).arrayBuffer();submitted=(await new Request(url,{method:'POST',headers:init.headers,body}).formData()).get('file');return new Response('{"text":"synthetic mocked result"}',{status:200})}});
 assert.equal(calls,1);assert.equal(submitted.name,'audio.m4a');assert.equal(submitted.type,'audio/mp4');assert.deepEqual(Buffer.from(await submitted.arrayBuffer()),bytes);assert.equal(result.result.text,'synthetic mocked result');
});
test('a known wrong MIME remains rejected rather than treated as a conversion',async()=>{
 await assert.rejects(()=>detectFileAudioFormat(new File([awaitableDummy],'audio.m4a',{type:'audio/mpeg'})),/MIME type/);
});
const awaitableDummy=new Uint8Array([1,2,3,4]);
test('video-only MP4 fails explicitly before provider dispatch',async()=>{
 const file=new File([await fixture('no-audio.mp4')],'video.mov',{type:'video/quicktime'});assert.equal(await detectFileAudioFormat(file),'mp4');await assert.rejects(()=>validateWholeFile(file,'mp4'),/No audio stream/);
});
test('corrupt, empty and raw AAC require explicit supported-container/conversion diagnostics',async()=>{
 for(const [name,data] of [['broken.m4b',new Uint8Array([0,1,2,3])],['raw.aac',new Uint8Array([255,241,80,128,0,255,252])],['file.wma',new Uint8Array([48,38,178,117])]])await assert.rejects(()=>detectFileAudioFormat(new File([data],name)),/No supported audio container.*no built-in converter/);
 await assert.rejects(()=>detectFileAudioFormat(new File([],'empty.m4a')),/empty/);
});
test('discovery and direct upload bounds remain enforced',async()=>{
 const huge=new File([new Uint8Array(MAX_DIRECT_AUDIO_BYTES+1)],'unknown.bin');await assert.rejects(()=>detectFileAudioFormat(huge),/24 MB/);await assert.rejects(()=>detectFileAudioFormat(new File([huge],'huge.m4a',{type:'audio/mp4'})),/24 MB/);await assert.rejects(()=>validateWholeFile(huge,'wav'),/24 MB/);
});
test('picker and drag/drop share discovery and canonical upstream policy',async()=>{
 for(const ext of ['.m4a','.m4b','.m4r','.m4v','.mov','.oga','.opus','.wave'])assert.ok(FILE_ACCEPT.includes(ext));
 const app=await readFile(new URL('../../public/js/app.js',import.meta.url),'utf8');assert.match(app,/audioFormat=await detectFileAudioFormat\(file\)/);assert.match(app,/addFiles\(UI.fileInput.files\)/);assert.match(app,/addEventListener\('drop',e=>addFiles\(e.dataTransfer\?\.files\|\|\[\]\)\)/);
});
