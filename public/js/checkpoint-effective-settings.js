export function effectivePaidSettings(settings,audioFormat){
  const base={model:settings.model,languages:settings.languages,keywords:settings.keywords,prompt:settings.prompt};
  return audioFormat==='mp3'?{...base,chunkMb:settings.chunkMb,maxMinutes:settings.maxMinutes,previousContext:settings.previousContext}:base;
}
