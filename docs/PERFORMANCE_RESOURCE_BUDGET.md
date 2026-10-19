# Performance and Resource Budget

Official Cloudflare limits below were re-verified **2026-08-10** from https://developers.cloudflare.com/workers/platform/limits/.

## Current platform ceilings relevant to V1
- Worker memory: **128 MB** on both Free and Paid.
- CPU time: **10 ms** on Workers Free; **up to 5 minutes** on Workers Paid.
- Subrequests/request: **50 Free; 10,000 Paid**.
- Simultaneous outgoing connections/request: **6** on both.
- Request-body limit depends on the Cloudflare account plan; current Free/Pro account limit is 100 MB, comfortably above Cosmic Transcriber's stricter per-chunk limit but not used as the application's safety control.

## Application source-code budgets
- Browser source reads: bounded `Blob.slice()` windows; never `file.arrayBuffer()` for the entire multi-hour source.
- Streaming SHA-256 slice: 2 MiB default.
- Application audio body maximum: **24,000,000 bytes**, below OpenAI's current 25 MB file limit.
- Metadata JSON: 12,000 bytes; encoded metadata header: 16,384 characters.
- Upstream response body: **4 MiB** maximum.
- Browser transcript aggregation ceiling: **25,000,000 characters per file** (Windows parity).
- Queue ceiling: **10,000 files**; combined export ceiling: **1,000 files** (Windows parity).
- Export strings are built lazily only when a download is clicked, avoiding a second retained copy of every completed transcript.
- Queue execution: sequential paid parts; no uncontrolled parallel OpenAI fan-out.
- One OpenAI request per chunk plus authentication/rate-limit/runtime overhead.

## Release acceptance measurements still required on Cloudflare
For the exact selected account/Workers plan, record peak Worker memory, CPU, wall duration, subrequests, outgoing-connection use, request size and response size for:
1. a maximum normal 24 MB chunk;
2. several sequential chunks from one long recording;
3. multiple authenticated testers where practical.

Also measure browser heap/UI responsiveness on a realistic multi-hour MP3 while hashing, chunking, checkpointing and downloading output.

## Plan decision
The source deliberately does **not** claim Workers Free is sufficient. The 10 ms Free-plan CPU allowance is especially tight for Access verification, AES-GCM session handling, validation and streaming multipart construction. Treat **Workers Paid as the conservative staging/release target unless real staging measurements demonstrate that the intended workload reliably fits the chosen plan**. This is a deployment decision, not a code-test result.
