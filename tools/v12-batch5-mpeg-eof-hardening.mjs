#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const arg = process.argv.indexOf('--root');
if (arg < 0 || !process.argv[arg + 1]) throw new Error('Usage: v12-batch5-mpeg-eof-hardening.mjs --root <candidate-root>');
const root = path.resolve(process.argv[arg + 1]);

function edit(rel, transform) {
  const file = path.join(root, rel);
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`No deterministic change made to ${rel}`);
  fs.writeFileSync(file, after);
}

function replaceOnce(text, from, to, rel) {
  const first = text.indexOf(from);
  if (first < 0) throw new Error(`Expected anchor missing in ${rel}: ${JSON.stringify(from)}`);
  if (text.indexOf(from, first + from.length) >= 0) throw new Error(`Expected anchor is not unique in ${rel}`);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

const audio = 'src/audio-formats.js';
edit(audio, text => replaceOnce(
  text,
  '    const nextOffset = i + first.frameLength;\n    if (nextOffset === bytes.length) return true;\n    const second = mpegFrameInfo(bytes, nextOffset);',
  '    const nextOffset = i + first.frameLength;\n    const second = mpegFrameInfo(bytes, nextOffset);',
  audio
));

const nodeTests = 'tests/node/audio-formats.test.mjs';
edit(nodeTests, text => replaceOnce(
  text,
  "  const single=new Uint8Array(900);single.fill(0);single.set([0xff,0xfb,0x90,0x64],17);\n  for(const f of ['mp3','mpeg','mpga'])assert.equal(validateAudioSignature(f,single),false);\n  const twoFrames=new Uint8Array(834);",
  "  const single=new Uint8Array(900);single.fill(0);single.set([0xff,0xfb,0x90,0x64],17);\n  for(const f of ['mp3','mpeg','mpga'])assert.equal(validateAudioSignature(f,single),false);\n  const exactEof=new Uint8Array(417);exactEof.set([0xff,0xfb,0x90,0x64],0);\n  for(const f of ['mp3','mpeg','mpga'])assert.equal(validateAudioSignature(f,exactEof),false);\n  const twoFrames=new Uint8Array(834);",
  nodeTests
));

const audit = 'scripts/audit-lib.mjs';
edit(audit, text => replaceOnce(
  text,
  '&&audio.includes("const second = mpegFrameInfo(bytes, nextOffset);")&&audio.includes("second && second.version === first.version && second.layer === first.layer && second.sampleRate === first.sampleRate")&&!/if \\(!first\\) continue;\\s*return true;/.test(audio)&&tests.includes("MPEG-family trust boundary rejects two-byte sync tricks and requires consistent frame geometry")',
  '&&audio.includes("const second = mpegFrameInfo(bytes, nextOffset);")&&audio.includes("second && second.version === first.version && second.layer === first.layer && second.sampleRate === first.sampleRate")&&!audio.includes("if (nextOffset === bytes.length) return true;")&&!/if \\(!first\\) continue;\\s*return true;/.test(audio)&&tests.includes("MPEG-family trust boundary rejects two-byte sync tricks and requires consistent frame geometry")&&tests.includes("const exactEof=new Uint8Array(417)")&&tests.includes("validateAudioSignature(f,exactEof),false")',
  audit
));

const mutation = 'scripts/mutation-suite.mjs';
edit(mutation, text => replaceOnce(
  text,
  '  ["accept first plausible MPEG frame without boundary corroboration", "src/audio-formats.js", /if \\(!first\\) continue;\\n    const nextOffset = i \\+ first\\.frameLength;/, "if (!first) continue;\\n    return true;\\n    const nextOffset = i + first.frameLength;"],\n];',
  '  ["accept first plausible MPEG frame without boundary corroboration", "src/audio-formats.js", /if \\(!first\\) continue;\\n    const nextOffset = i \\+ first\\.frameLength;/, "if (!first) continue;\\n    return true;\\n    const nextOffset = i + first.frameLength;"],\n  ["accept lone MPEG frame ending exactly at EOF", "src/audio-formats.js", /const nextOffset = i \\+ first\\.frameLength;\\n    const second = mpegFrameInfo\\(bytes, nextOffset\\);/, "const nextOffset = i + first.frameLength;\\n    if (nextOffset === bytes.length) return true;\\n    const second = mpegFrameInfo(bytes, nextOffset);"],\n];',
  mutation
));

const integration = 'tests/integration/worker.test.js';
edit(integration, text => {
  let out = replaceOnce(
    text,
    "    const invalid=new Uint8Array(900);invalid.fill(0x41);invalid[77]=0xff;invalid[78]=0xe0;\n    const valid=new Uint8Array(834);",
    "    const invalid=new Uint8Array(900);invalid.fill(0x41);invalid[77]=0xff;invalid[78]=0xe0;\n    const exactEof=new Uint8Array(417);exactEof.set([0xff,0xfb,0x90,0x64],0);\n    const valid=new Uint8Array(834);",
    integration
  );
  out = replaceOnce(
    out,
    "    expect(bad.status).toBe(415);\n    expect(upstreamHits).toBe(0);\n    const goodMeta=metadata({...identity,declaredBytes:valid.length});",
    "    expect(bad.status).toBe(415);\n    expect(upstreamHits).toBe(0);\n    const eofMeta=metadata({...identity,declaredBytes:exactEof.length});\n    const eofBad=await worker.fetch(`${origin}/api/transcribe`,{method:'POST',headers:await authHeaders({Origin:origin,'Content-Type':'audio/mpeg','X-Cosmic-Metadata':encodeMeta(eofMeta),Cookie:cookie}),body:exactEof});\n    expect(eofBad.status).toBe(415);\n    expect(upstreamHits).toBe(0);\n    const goodMeta=metadata({...identity,declaredBytes:valid.length});",
    integration
  );
  return out;
});

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'RELEASE_MANIFEST.json'), 'utf8'));
if (manifest.releaseReady !== false) throw new Error('Refusing to operate unless RELEASE_MANIFEST releaseReady is false');
console.log('Batch 5 MPEG EOF hardening applied; releaseReady remains false.');
