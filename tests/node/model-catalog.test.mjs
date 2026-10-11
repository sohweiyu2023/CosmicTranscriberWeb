import test from 'node:test';
import assert from 'node:assert/strict';
import {MODELS as SERVER,DEFAULT_MODEL} from '../../src/config.js';
import {MODELS as CLIENT} from '../../public/js/models.js';

test('client/server completed-file model keys stay exactly aligned',()=>{assert.deepEqual(Object.keys(CLIENT).sort(),Object.keys(SERVER).sort());assert.equal(DEFAULT_MODEL,'gpt-transcribe');assert.equal(Object.hasOwn(CLIENT,'gpt-live-transcribe'),false)});
test('client/server model capabilities and prices stay aligned',()=>{for(const id of Object.keys(SERVER)){const a=SERVER[id],b=CLIENT[id];assert.equal(b.price,a.pricePerMinuteEstimate,id+' price');assert.equal(b.priceBasis,a.priceBasis,id+' price basis');assert.equal(b.languages,a.languages,id+' language');assert.equal(b.keywords,a.keywords,id+' keywords');assert.equal(b.prompt,a.prompt,id+' prompt');assert.equal(b.diarize,a.diarization,id+' diarization');assert.equal(b.previous,a.previousContext,id+' previous context')}});

test('diarization price is explicitly marked as derived rather than published per-minute pricing',()=>{assert.equal(SERVER['gpt-4o-transcribe-diarize'].priceBasis,'derived_same_audio_token_rates');assert.equal(CLIENT['gpt-4o-transcribe-diarize'].priceBasis,'derived_same_audio_token_rates');for(const id of ['gpt-transcribe','gpt-4o-transcribe','gpt-4o-mini-transcribe'])assert.equal(SERVER[id].priceBasis,'published_per_minute')});
