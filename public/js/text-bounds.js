export function truncateUtf16Safe(value,maximumCharacters){
  const s=String(value??'');
  if(!Number.isSafeInteger(maximumCharacters)||maximumCharacters<0)throw new RangeError('maximumCharacters must be a non-negative safe integer.');
  if(s.length<=maximumCharacters)return s;
  let end=maximumCharacters;
  if(end>0){const code=s.charCodeAt(end-1);if(code>=0xD800&&code<=0xDBFF)end--}
  return s.slice(0,end);
}

export function takeTailUtf16Safe(value,maximumCharacters){
  const s=String(value??'');
  if(!Number.isSafeInteger(maximumCharacters)||maximumCharacters<0)throw new RangeError('maximumCharacters must be a non-negative safe integer.');
  if(s.length<=maximumCharacters)return s;
  let start=s.length-maximumCharacters;
  if(start<s.length){const code=s.charCodeAt(start);if(code>=0xDC00&&code<=0xDFFF)start++}
  return s.slice(start);
}

export function contextTail(text,max=1800){const s=String(text||'').trim();return takeTailUtf16Safe(s,max)}
export function finalPrompt(base,previous,max=16000){const b=String(base||'').trim(),p=contextTail(previous);if(!p)return b;if(!b)return `Previous transcription context (continue faithfully; do not repeat it):\n${p}`;const joined=`${b}\n\nPrevious transcription context (continue faithfully; do not repeat it):\n${p}`;return takeTailUtf16Safe(joined,max)}
