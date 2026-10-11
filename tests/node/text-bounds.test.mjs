import test from 'node:test';
import assert from 'node:assert/strict';
import {truncateUtf16Safe,takeTailUtf16Safe,contextTail,finalPrompt} from '../../public/js/text-bounds.js';

test('Unicode truncation never splits a surrogate pair',()=>{
  const emoji='😀';
  assert.equal(emoji.length,2);
  assert.equal(truncateUtf16Safe(`A${emoji}B`,2),'A');
  assert.equal(truncateUtf16Safe(`A${emoji}B`,3),`A${emoji}`);
  assert.equal(takeTailUtf16Safe(`A${emoji}B`,2),'B');
  assert.equal(takeTailUtf16Safe(`A${emoji}B`,3),`${emoji}B`);
});

test('previous-part context and final prompt preserve Unicode at exact character ceilings',()=>{
  const prior=`${'x'.repeat(1799)}😀tail`;
  const tail=contextTail(prior,1800);
  assert.equal(/^[\uDC00-\uDFFF]/u.test(tail),false);
  assert.equal(/[\uD800-\uDBFF]$/u.test(tail),false);
  const base='B'.repeat(12000);
  const out=finalPrompt(base,`${'p'.repeat(1799)}😀`,16000);
  assert.ok(out.length<=16000);
  assert.equal(/^[\uDC00-\uDFFF]/u.test(out),false);
  assert.equal(/[\uD800-\uDBFF]$/u.test(out),false);
  assert.ok(out.endsWith('😀'));
});
