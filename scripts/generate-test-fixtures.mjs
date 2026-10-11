import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const out=path.resolve('tests/fixtures');
await mkdir(out,{recursive:true});
const ffmpeg=process.env.FFMPEG||'ffmpeg';
function run(args){const r=spawnSync(ffmpeg,args,{stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw new Error(`ffmpeg failed (${r.status}): ${args.join(' ')}`)}
for(const f of ['cbr-128k-370s.mp3','vbr-190s.mp3','ID3 Unicode 東京.mp3','truncated.mp3','corrupt.mp3','zero-byte.mp3','format.mp3','format.flac','format.mp4','format.mpeg','format.mpga','format.m4a','format.ogg','format.wav','format.webm'])await rm(path.join(out,f),{force:true});
run(['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=997:sample_rate=44100','-t','370','-c:a','libmp3lame','-b:a','128k','-write_xing','1','-y',path.join(out,'cbr-128k-370s.mp3')]);
run(['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=733:sample_rate=44100','-t','190','-c:a','libmp3lame','-q:a','4','-write_xing','1','-y',path.join(out,'vbr-190s.mp3')]);
run(['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=523:sample_rate=44100','-t','4','-c:a','libmp3lame','-q:a','4','-metadata','title=東京','-id3v2_version','3','-write_xing','1','-y',path.join(out,'ID3 Unicode 東京.mp3')]);
const unicode=await readFile(path.join(out,'ID3 Unicode 東京.mp3'));
if(unicode.length<100)throw new Error('Unicode fixture unexpectedly small.');
await writeFile(path.join(out,'truncated.mp3'),unicode.subarray(0,unicode.length-17));
await writeFile(path.join(out,'corrupt.mp3'),Buffer.from('00112233445566778899aabbccddeeffdeadbeefcafebabefeedface', 'hex'));
await writeFile(path.join(out,'zero-byte.mp3'),Buffer.alloc(0));
const tone=['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1'];
run([...tone,'-c:a','libmp3lame','-b:a','128k','-write_xing','1','-y',path.join(out,'format.mp3')]);
run([...tone,'-c:a','flac','-y',path.join(out,'format.flac')]);
run([...tone,'-c:a','aac','-b:a','96k','-movflags','+faststart','-y',path.join(out,'format.mp4')]);
run([...tone,'-c:a','libmp3lame','-b:a','128k','-f','mp3','-y',path.join(out,'format.mpeg')]);
run([...tone,'-c:a','libmp3lame','-b:a','128k','-f','mp3','-y',path.join(out,'format.mpga')]);
run([...tone,'-c:a','aac','-b:a','96k','-movflags','+faststart','-f','mp4','-y',path.join(out,'format.m4a')]);
run([...tone,'-c:a','libvorbis','-q:a','3','-y',path.join(out,'format.ogg')]);
run([...tone,'-c:a','pcm_s16le','-y',path.join(out,'format.wav')]);
run([...tone,'-c:a','libopus','-b:a','64k','-y',path.join(out,'format.webm')]);
console.log('Deterministic MP3 and nine-format fixtures generated.');
