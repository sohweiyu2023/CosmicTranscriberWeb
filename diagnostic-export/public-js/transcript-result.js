export function normalizeOpenAiResult(result, chunk) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('OpenAI returned an invalid transcription result.');
  if (Array.isArray(result.segments)) {
    if (typeof result.text !== 'string') throw new Error('OpenAI returned diarized transcription JSON without a string text field.');
    if (result.segments.length > 50_000) throw new Error('OpenAI returned too many diarization segments.');
    const segments=[]; let lastStart=-Infinity;
    for (const raw of result.segments) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.speaker !== 'string' || typeof raw.text !== 'string') throw new Error('OpenAI returned an invalid speaker segment.');
      const start=Number(raw.start), end=Number(raw.end);
      if (!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||end>7*24*60*60||start+1e-6<lastStart) throw new Error('OpenAI returned invalid or reordered diarization timestamps.');
      lastStart=start;
      const speaker=raw.speaker.replace(/[\u0000-\u001f\u007f\u2028\u2029]/gu,' ').trim().slice(0,128)||'Unknown speaker';
      const text=raw.text.trim(); if(!text) continue;
      segments.push({start:chunk.logicalStart+start,end:chunk.logicalStart+end,speaker,text});
    }
    if (result.text.trim() && segments.length===0) throw new Error('OpenAI returned non-empty diarized text without usable speaker segments.');
    return {text:result.text.trim(),segments};
  }
  if (Object.prototype.hasOwnProperty.call(result,'segments')) throw new Error('OpenAI returned malformed diarization segments.');
  if (typeof result.text !== 'string') throw new Error('OpenAI response is missing transcript text.');
  return {text:result.text.trim(),segments:null};
}
