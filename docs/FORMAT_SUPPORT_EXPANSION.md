# Web input format expansion

The Web edition uploads nine canonical formats: MP3, FLAC, MP4, MPEG, MPGA, M4A, OGG, WAV and WebM. This change broadens import discovery so genuine recordings are recognised by content and compatible alternate names; it does not add a converter or change what is sent to the provider (always the canonical extension and MIME type).

## What is tested

| Input | Local synthetic evidence | Processing / limits |
|---|---|---|
| MP3, MPEG, MPGA containing MP3 audio | Real MP3 fixtures and existing frame tests | Existing frame-aware MP3 handling; MPEG/MPGA rules preserved |
| M4A / M4B / M4R containing AAC | Actual one-second AAC-in-MP4 fixture; M4B mocked upload preserves exact bytes and uses audio.m4a / audio/mp4 | Whole file, <=24,000,000 bytes |
| M4A containing ALAC | Actual one-second ALAC fixture; Node/container and byte-preserving mocked submission pass; Chromium picker Ready with Unknown duration | Conditional: no browser decode/live-provider certification |
| MP4 / M4V / compatible MOV containing AAC | Actual AAC-in-MP4 fixture plus video+AAC fixture; drop Ready | Valid ISO-BMFF plus structural audio-handler check; whole file <=24 MB |
| OGG / OGA containing Vorbis | Actual Vorbis/Ogg fixture | Whole file <=24 MB |
| OPUS containing Ogg Opus | Actual locally encoded Opus/Ogg fixture | Submitted canonically as OGG; browser duration/codec support remains platform-dependent |
| WAV / WAVE containing signed16 PCM | Actual PCM/WAV fixture | Whole file <=24 MB |
| FLAC | Actual FLAC fixture | Whole file <=24 MB |
| WebM containing Opus | Actual Opus/WebM fixture | Whole file <=24 MB |
| Unknown extension / no extension with recognized supported container bytes | M4A bytes under .data and FLAC bytes without suffix | Content discovery <=24 MB; outgoing extension/MIME derive from the detected canonical format |
| MP4 movie with no audio track | Actual video-only fixture | Explicit local no-audio error before upload |

Primary supported extensions retain MIME mismatch rejection. Empty and generic binary MIME hints can be resolved through content checks; a MIME label alone is not proof. Compatible aliases must match their expected container. Corrupt/unknown containers receive a converter/export explanation. The file picker and drag/drop share the same asynchronous discovery path. Web has no separate folder-import UI; Desktop folder support is owned by the Desktop project.

## Conditional and unsupported cases

Container and codec are different. A .m4a or .mov suffix does not guarantee a decodable recording. Audio-handler presence is not complete codec/sample validation. AAC under compatible aliases is tested; ALAC has only local/container/mock evidence and Unknown Chromium duration. Encrypted/DRM media, all QuickTime variants, fragmented movies with unusual metadata, and every browser codec combination are not certified. The bounded parser rejects duplicate/missing/corrupt movie metadata, excessive boxes/nodes and metadata larger than1 MB instead of uploading uncertain input.

Raw AAC/ADTS, AIFF/AIFC, CAF, WMA/ASF, AVI, MKV, AMR and arbitrary other codecs are not converted by this Web edition. If they do not contain an already recognized supported container, export or convert locally to a supported audio format. Renaming a suffix does not convert media. No FFmpeg/WASM binary or new third-party conversion service was added. FFmpeg/ffprobe were used only as existing local test tools; this grants no binary redistribution rights.

Browser metadata probing may fail for a format the provider can read; the existing UI displays unknown duration and unavailable cost estimate rather than inventing duration. A provider may reject a corrupt/unsupported codec despite a recognized container. Existing billing uncertainty and no-automatic-paid-retry protections remain unchanged.

## Provider and browser references

The official [transcription endpoint reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create) lists all nine canonical input formats and recommends an extension-bearing filename with appropriate content type. The shorter [speech guide](https://developers.openai.com/api/docs/guides/speech-to-text) lists seven; use the endpoint's explicit file parameter list for the broader catalog. Neither proves every codec inside a container succeeds.

[MDN's media container guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers) distinguishes containers, MIME labels and codec-specific browser support. Browser playback, native file access, conversion and provider transcription are separate verification stages.

## Release state

Integrated on 10 November 2026 for the 1.2.0 release candidate together with the issue #3 regressions, the logging follow-up and the exact SafariDriver 27.2 exception. `tests/node/file-import-expansion.test.mjs` covers parsing, bounds and mocked byte-exact submission; `tests/e2e/format-discovery.spec.js` exercises the real picker and drop zone with these fixtures in every CI browser project, with zero paid requests. Genuine desktop Safari remains FAIL/WAIVED (not validated), and no paid live provider test of the new aliases has been run.

## Long-file and memory verification

No Web source calls `decodeAudioData` or constructs `AudioContext`/`OfflineAudioContext`. Non-MP3 files are direct-upload only and capped at24,000,000bytes before source hashing. Container discovery reads at most64KiB; ISO metadata is capped at1MiB,128 top-level boxes and1024 metadata nodes. Native browser metadata probing uses an HTML audio element with a4-second timeout, source cleanup and URL revocation; it is not a full WebAudio PCM decode.

The actual370.05-second/5,921,270-byte MP3 fixture passed picker preparation and frame chunking. The parser's observed read window stayed <=512KiB; browser source/chunk hashing used <=2MiB Blob reads. An oversize M4A drop was rejected before any JavaScript Blob read. These are bounded application read sizes, not a browser-process RSS guarantee. Browser-internal media buffering, total scan time and chunk metadata can still grow; arbitrary-size or multi-hour inputs have not been certified. There is no promise that all long files work. Other formats over24MB must be converted or split locally.

The committed browser journey covers picker M4B, MOV, Opus, ALAC and extension-less FLAC, video+AAC (M4V) drop, and rejection of corrupt M4A, renamed non-audio and video-only MP4 by picker and drop. Web has no folder UI; the separately owned Desktop project covers folder import.


## Additional acceptance verification

Actual AAC/M4A, ALAC/M4A, MPEG4-video-with-AAC and the370-second MP3 were each fully decoded through the existing local FFmpeg to a null output sink, not just inspected by ffprobe. Video-only and corrupt inputs failed as expected. No FFmpeg binary was bundled, replaced or redistributed. These local decoder results do not establish browser decoding or paid-provider acceptance. See full-local-decode-result.json in the private evidence folder.

Release evidence comes from the CI runs recorded for the final revision, not from earlier local runs.
