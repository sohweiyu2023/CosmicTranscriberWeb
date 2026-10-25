# Cosmic Transcriber Web 1.2.0: setup and everyday use

Cosmic Transcriber turns recordings into text using your OpenAI API account. CloudScribe turns text into spoken audio using Google Cloud. Their keys and billing are separate.

## Open the app

Use **https://transcriber.awakeningtoreality.com** for the deployed application. Complete the existing Cloudflare Access sign-in. No desktop installation is needed for this web version.

After sign-in, your Cosmic account must be **Active**. A Pending account needs an administrator's approval; a Blocked account cannot use paid operations. A site administrator can also close new registrations. These app-account checks are separate from the Cloudflare sign-in screen.

On an already installed local test computer, the supplied `Start-Cosmic.cmd` opens **http://localhost:8790**. `Status-Cosmic.cmd` checks that installation and `Stop-Cosmic.cmd` stops only its recorded server. Start it again after a reboot. The private launcher/runtime and local state must remain together. A local-development authentication configuration must never be deployed to a public hostname.

## Configure your own OpenAI key

1. Open the [OpenAI API platform](https://platform.openai.com/) in your own account. API billing is separate from ChatGPT subscriptions; check your API project's billing and model access.
2. Create a dedicated project/key where practical. Use restricted transcription permissions if your account supports the required endpoint scope. Do not share your key with other users.
3. In Cosmic, choose **Configure API key** and paste the key directly into the app's key dialog. Confirm setup, then check the header's configured/expiry status.
4. **Replace API key** changes the current browser session while no job is running. **Forget API key** clears this browser's session. If a key is exposed, revoke it in the API platform as well.

The Worker protects the key in a short-lived encrypted HttpOnly/Secure cookie; plaintext keys are not put into browser Web Storage or IndexedDB. Each browser/site has its own session, so configuring localhost does not configure the production site. An expired session can be configured again without deleting transcription checkpoints.

**Test key** is optional and performs a disclosed tiny transcription request. It can incur API usage. You do not need to run it repeatedly, and key configuration itself is not a transcription acceptance test.

See [API-key setup](OPENAI_API_KEY_SETUP.md) and [OpenAI's explanation of separate API billing](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform).

## Transcribe your first recording

1. Choose **Add files**, or drop a recording into the app. Version 1.2 accepts **MP3, FLAC, MP4, MPEG, MPGA, M4A, OGG, WAV and WebM**. Wait until preparation shows a sensible duration/chunk count and **Ready**. Empty/corrupt/unsupported files are rejected before transcription.
2. Choose a completed-file transcription model. Use the general transcription option for ordinary speech, the Mini option when its quality/cost suits your task, or the diarization model when you need speaker labels. The displayed allowlist is authoritative; models available in ChatGPT are not necessarily file-transcription API models.
3. Add optional language/context/keyword hints only where the selected model supports them. Diarization has different supported fields. Disabled fields cannot be used for that model.
4. Review the dated estimated cost and your API account budget. The displayed estimate is not an invoice or guaranteed billing cap.
5. Start transcription and **keep the tab open**. Run-affecting settings and key replacement are locked while work runs; Cancel remains available.
6. When a file completes, download its **TXT** or **Markdown** result. Listen/check names and technical terms against the source: model output can need correction.

MP3 can be prepared into frame-aware chunks. Other formats use whole-file uploads within the application's upload limit. MPGA is specifically complete MPEG Layer III audio; other layers, changing sample rates/version or truncated/junk-bearing MPGA are rejected. For fully verified Layer III MPEG/MPGA, the provider filename may be normalized to MP3 without transcoding the audio.

## Download, resume and rerun

Per-file downloads remain available for completed results. Combined output is available only when all prepared files completed under the same transcription settings, with at most 1,000 files. Changing presentation-only choices such as timestamps or TXT/Markdown regenerates output locally; it does not require paid retranscription.

Completed chunks are checkpointed in IndexedDB for the authenticated user and exact source/settings identity. If the tab closes, reopen the same site in the same browser profile, sign in as the same user, select the same original file and use the same settings. The app verifies source/chunk identity before reusing compatible completed work. It does not continue processing after the browser closes. Clearing site data removes checkpoints.

To use a different model/settings on completed audio, download any result you want to keep, then use **Run completed again** and read the paid-run confirmation. Changed settings can incur new charges. A valid identical completed checkpoint can be reused without another paid request.

Cancel stops new parts and attempts to abort the current request; it cannot undo provider work already dispatched. If the app reports an uncertain post-dispatch failure, inspect the warning before retrying: a second attempt could produce a duplicate charge. Do not repeatedly click Start after a lost connection.

## Privacy and help

Audio is prepared in the browser, then sent through the authenticated Worker to OpenAI when transcription starts. The app does not intentionally maintain a server-side audio/transcript archive. Browser checkpoints contain completed transcript results and integrity metadata. Model/context/keyword preferences also persist locally and can be sensitive on a shared device. Download what you need before clearing browser data.

Use **Download detailed diagnostics** for support. The app's bounded report excludes API keys, cookies, audio, transcript/prompt text and filenames. Do not attach your key or unrelated private recordings to a support request.

| Symptom | Next step |
|---|---|
| Pending or Blocked | Ask the site administrator to review your account state. |
| Start disabled | Check account status, key-session expiry, selected model and whether at least one file is Ready. |
| Invalid key, permissions or quota | Check the intended API project, transcription permissions, billing/model access and usage in your own API account. |
| File cannot be read | Select the original file again from an accessible local folder. Do not assume browser failure means it reached OpenAI. |
| Combined download unavailable | Complete all files with matching transcription settings, or use per-file downloads. |
| Interrupted/uncertain request | Read retry/charge warnings; retain completed checkpoints and diagnostics before deciding to retry. |

## Administrator and deployment notes

Configured administrators can manage registration mode and mark non-administrator accounts Pending, Active or Blocked. Usage counters are operational estimates, not provider invoices. See [administrator controls](ADMIN_USER_MANAGEMENT.md).

The hosted site is already deployed. Updating GitHub main does not itself authorize resetting production secrets or replacing the database. For an existing deployment, follow [the upgrade instructions](CLOUDFLARE_DEPLOYMENT.md) and [production operations](PRODUCTION_OPERATIONS.md): use a verified source ZIP, staging qualification and the existing private bindings. Do not run first-deploy/bootstrap helpers for an upgrade. Keep Cloudflare Access enabled and preserve the existing BYOK master secret and D1 data.

For local development from a separate source checkout, the supported toolchain is Node **26.12.1** with npm **12.2.1**; use the shipped Windows toolchain helpers, `npm ci`, and the developer/testing guides. An editable audit checkout is not a certified deployable package.

## Verification limits

The 1.2.0 production deployment was verified on 18 October 2026. Windows runtime/browser checks and local synthetic live transcription covered all nine formats, Unicode and two-speaker diarization on the tested source history. Later production smoke checks did not make new paid calls. These are separate forms of evidence, not a claim that every model, long recording or browser combination passed live production transcription.

**Desktop Safari remains unverified.** The strict genuine SafariDriver 26.6.2 native-file test failed with `NotReadableError` before provider dispatch, and subsequent workflow checks were not run. The owner accepted this disclosed verification gap after reporting an actual iPhone Safari upload/process/Markdown success. The iPhone result does not certify desktop Safari. Keep the failed result and see [the accepted exception](RELEASE_EXCEPTION_2026-10-18.md) and [issue 6](https://github.com/sohweiyu2023/CosmicTranscriberWeb/issues/6).
