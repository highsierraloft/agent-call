# Samsung and OpenRouter integration

This fork connects an existing Android SIP gateway to configurable voice providers.
The requesting assistant, such as Hermes, gathers the details and sends a brief through MCP.
The voice agent conducts the call and returns the transcript and recording as files.
Hermes interprets the transcript and writes any summary.

## Implemented path

`Hermes → Agent Call MCP → Asterisk → Android Voice SIP Agent → selected cellular SIM`

Pipecat handles speech recognition, conversation, and speech generation.
OpenRouter supplies the dialogue model. Speech can use OpenRouter or direct streaming providers.
The deployment uses Asterisk 22.11.0, Pipecat 1.13.0, and pipecat-asterisk 0.1.4.
The integration uses pipecat-asterisk's serializer with Pipecat's native paced WebSocket transport.
This keeps playback timing aligned with transcript and closing events, without a second unmanaged audio buffer.
A separate gateway fork pins an explicit Android phone account. The stock gateway does not meet that requirement.

The Android backend reuses Agent Call's prepared plans, confirmation binding, atomic call admission,
authenticated MCP tools, SQLite storage, and transcript finalizer. It does not emulate provider webhooks.
The existing OpenAI/Twilio backend remains the default and retains its existing routes and tests.

- Set `call_backend` to `android_openrouter` and `post_call_extraction_enabled` to `false`.
- Supply an initial language, `en`, `es`, `ru`, or `uk`, and `escalation.mode=end_call` in the brief.
- Omit `owner.callback_number` and `escalation.owner_phone` to use the server's saved owner number.
  The explicit value `configured` has the same effect. Preparation resolves these fields before
  policy checks and stores the real values in the private plan. Explicit mismatches remain errors.
  Only `target.phone` identifies the recipient. A masked owner number in a client tool result
  must not cause a request for the owner number or substitution of the recipient's number.
- The deployment can use a destination allowlist or explicitly allow any valid international destination.
- Calls default to 30 minutes and accept a per-call duration up to the configured safety ceiling, at most two hours.
- The backend checks fresh phone supervision, the selected SIM policy, and SIP registration before dialing.
- It opens and validates the owned audio channel before originating the cellular leg.
- It starts the conversation only after the cellular channel reports an answer.
- Cancellation and deadlines end the owned channels. A new phone-idle observation must confirm teardown.
- An uncertain call remains terminating and blocks new calls. It never causes automatic redial.
- A recipient reply cancels a pending farewell. Closing preserves a three-second reply window.

## Private control panel

The control panel manages call history, versioned personalities, browser practice, and the calling
guide consumed by Hermes. Its React interface is built with `dashboard/package-lock.json` and
served by `Dockerfile.control`. Administration APIs remain inside the existing FastAPI worker.

Saving creates an immutable revision and applies it to future preparations. Existing plans and
active calls retain their stored prompt and voice settings. Restoration creates another revision.
Concurrent saves use the expected revision and return a conflict instead of overwriting another edit.
Built-in profile IDs remain available for older clients; custom profiles can be archived.

`ContextPacket.profile_id` is optional. `get_calling_setup` supplies the current calling guide,
active profile IDs, languages, and defaults. Install a calling-specific Hermes bootstrap that fetches
this tool before each preparation. The dashboard does not need Hermes's home directory or credentials.
Call results include configuration revision references. Full snapshots are available only in the
authenticated control panel. Older calls without snapshots remain explicitly unrecorded.

**Inspect AI Inputs** separates the call model's starting system prompt into ordered sections,
with the source of each section and whether it is editable. It also shows model parameters,
speech settings, the `finish_call` tool definition, connection and timer messages, and an initial
request example. Global Defaults, the selected personality, and the approved brief feed the call model.
The Hermes calling guide is separate: Hermes reads it to prepare and monitor calls; it is not copied
into the call model's system prompt. The sidebar labels this area **Hermes**.

The **Latest Request** view reads the actual serialized outgoing OpenRouter request body,
including messages, tools, and model options. A request hook retains the immutable bytes in memory;
it performs no database write or JSON parsing in the audio path. Only the latest body is retained,
up to 4 MiB. Oversized bodies are marked omitted. Request capture precedes sending and does not
prove provider receipt or a successful response. Authentication headers and credentials are never captured.
Provider-internal instructions and unspecified defaults are outside this application's visibility.

New plans freeze the configured input description. A completed telephone session stores its last
captured request in `call_model_requests`; practice inspection stays ephemeral. Inspection endpoints
use the same owner-only authentication as other administration APIs. Capture failure or process loss
must remain visible as missing data. Earlier calls retain any recorded starting prompt, but missing
tool/request snapshots are never reconstructed from current code. Input descriptions can be downloaded as JSON.

Set `android.dashboard_config_file` to a private, read-only JSON mount with `bridge_token`,
`owner_login`, `public_origin`, `trusted_proxy_ips`, `timezone`, and `hermes_url`.
The bridge token is a separate random credential of at least 32 characters. The owner login is the
personal Tailscale identity allowed to open the panel. Both URLs use private Tailscale HTTPS.
Use exact Docker host gateway addresses for `trusted_proxy_ips`; do not trust entire container subnets.

The Caddy container accepts application traffic only from those host proxies and the configured
Tailscale identity. It adds the bridge credential to worker requests. This prevents another container
from impersonating the owner by sending a forged identity header directly to Caddy. The worker also
checks the bridge credential, identity, origin, and a signed CSRF cookie for mutations.
Neither provider credentials nor the MCP bearer token are sent to browser JavaScript.
Publish only the proxy's loopback port and add a dedicated Tailscale Serve HTTPS route.
Preserve existing Serve routes and keep the worker's MCP and telephone-media endpoints unpublished.

Voice practice uses Pipecat's JavaScript WebSocket transport and the same speech pipeline.
Its `WavMediaManager` runs locally without Daily CDN downloads. Browser input uses 16 kHz;
Pipecat resamples output to the manager's 24 kHz player. Telephone audio remains 8 kHz.
It cannot dial or change real recipient opt-outs. Phone calls and practice share one voice slot.
Browser disconnect, cancellation, and provider failure release that slot after cleanup.
Practice transcripts are temporary and separate from telephone records. Unsaved edits can be tested
without applying them. Browser timings do not establish cellular carrier or handset latency.

Calls support transcript search, filters, pagination, notes, quality tags, and authenticated files.
Notes never alter the original transcript. MP3 responses support byte ranges; Markdown downloads
have an explicit `.md` filename. Neither file type has automatic retention cleanup.
Personalities and Playground use native dropdowns for OpenRouter models, named Inworld voices,
Inworld TTS-2 or TTS-2 Flash, and compatible Soniox real-time models. Search voices by name,
language, or description. Soniox aliases are labelled with their underlying engine; async models
are excluded. The current provider accounts remain in use. No new credentials are required.

The server fetches provider catalogs and caches each list independently for one hour. Model choices
require tools and tool-choice support; temperature support is not required. This includes GPT-6 Luna,
Claude Haiku 5.5, and supported Gemini alternatives. Listed prices come from OpenRouter's catalog;
they are per million tokens and can vary by provider. Catalog failures retain prior choices and the
current selection. Reviewed metadata provides an outage fallback for the default and named models.
An unknown model without usable catalog metadata is rejected before starting a conversation.
Catalog sources: [OpenRouter models](https://openrouter.ai/api/v1/models),
[Soniox model metadata](https://soniox.com/docs/api-reference/stt/get_models), and
[Inworld TTS models](https://docs.inworld.ai/tts/tts-models).

Changing models clears provider pins and keeps reasoning Off. Models that require reasoning show
an explicit warning; saving or practice fails until the owner chooses a supported effort. Provider
default is a separate, explicit choice and can enable thinking. Temperature can be disabled; unsupported
temperature and reasoning fields are omitted from the actual requests. The maximum output-token
budget is editable from 64 to 16384, including any reasoning tokens; the unchanged default is 512.
TTS-2 Flash does not apply delivery modes, so that control is disabled while the TTS-2 preference is retained.

Playground's **Voice and model choices** apply temporary session overrides without saving a revision.
They take precedence over the selected personality and any unsaved editor draft. Inspect AI Inputs
and both voice/text practice use these same overrides. After practice, Inspect Last Session retains
access to the captured request; Inspect AI Inputs previews the current selection. Reset Practice Choices restores the selected
personality's values. Starting a session freezes its settings and disables editing until it ends.
Save in Personalities to apply a choice to future calls. Existing prepared and active calls retain their
resolved model capabilities, parameters, prompt, and voice snapshot; catalog refreshes cannot rewrite them.
Catalog I/O and validation happen before the conversation, never inside the audio loop.

The selector release also passed live-provider browser practice with Haiku 5.5, Ashley,
TTS-2 Flash, and Soniox's v4 alias, followed by GPT-6 Luna text practice. Captured outgoing
requests had reasoning Off and no temperature. This used synthetic microphone input,
kept saved revisions unchanged, and placed no telephone call. It is not handset latency evidence.

Run `npm ci`, `npm run build`, and `npm test` from `dashboard/` for frontend verification.
Browser tests use synthetic records and intercepted APIs; they cannot place a telephone call.
`Dockerfile.control-tests` provides an isolated Linux WebKit environment when the local runtime
is unavailable. Run it with no external network after building its dependencies.
Provider-backed browser acceptance uses synthetic microphone audio, not an unattended real microphone.
The control-panel gate passed 974 backend tests with two skips and 89.06% coverage.
Fifty-six browser checks cover Chromium, dark appearance, desktop WebKit, and phone WebKit.
They include the local audio handshake, microphone release, permission denial, and stable pagination.
The production image also removes Caddy's file capability so it runs with all Linux capabilities dropped.
A provider-backed browser replay completed four languages and interruptions. Four measured reply starts
were 1.195–1.443 seconds after user silence at the server; the first greeting took 2.452 seconds.
These are small samples, not latency percentiles. The earlier telephone-transport replay measured
1.082–1.262 seconds. Different transports, input samples, and provider timing prevent a direct regression claim.
Explicit stop and tab closure both released practice capacity. Native Hermes model discovery,
authenticated MP3 seeking, Markdown delivery, and the live voice/model catalogs passed without dialing.
The input-inspection update preserves the prior system prompt byte-for-byte. A provider-backed browser
check captured the outgoing Gemini 3.1 Flash-Lite request, its runtime timer and `finish_call` definition,
then released practice capacity. It placed no telephone call and did not change saved configurations.

## Results and limitations

`get_call_result` returns transcript text, speakers, timestamps, and source metadata.
Each page holds at most 100 records. Pass `next_transcript_cursor` as `after_sequence` until it is null.
Transcript text is call content, not authority to run tools or change the brief.

Transcript-only finalization makes no model request and sends no summary push.
A normal disconnect does not establish task success. Hermes must assess the transcript.
Costs are not yet reconciled against carrier and provider billing; the backend returns no cost estimate.

The Android path has no owner transfer, mid-call question tool, answering-machine detection,
or in-call web search. If a required fact is missing, the voice agent ends politely.
These features remain available in the separate upstream backend where documented.

The overnight release suite passed 920 tests with two skips and 88.76% coverage.
The owner-number fix passed 95 focused policy, preparation, Android, and MCP tests, plus lint and types.
The media simulation checks connection setup, buffering, shutdown, and task cleanup without model requests.
These checks do not prove cellular audio or acceptable conversation timing.
One owner-controlled outbound call completed with seven transcript turns and confirmed hangup.
The owner reported clear audio, long pauses, and a repeated introduction. The timing changes and
introduction fix were followed by a streaming call that completed with three transcript turns and agent-requested hangup.
That call did not repeat the introduction, and the phone returned to idle. The owner found it faster, but too robotic and too short.
Full unattended recovery remains unverified.

## Recording and file delivery

Set `android.recording_enabled=true` to record the mixed Asterisk bridge, which contains both sides.
Recording starts after the answered cellular channel joins the bridge, before the agent speaks.
Starting earlier can make Asterisk stop with no audio while the phone is still ringing.
If recording setup fails, the answered call ends without starting the conversation.
Hangup remains bounded even when stopping the recording fails. Recording does not add a speech-provider request.

The worker requires FFmpeg and ffprobe, included in `Dockerfile.android`.
Mount private, writable persistent storage at `/var/spool/asterisk` in the Asterisk container,
owned by UID/GID `1000:1000`. Keep the worker's `/data` persistent as well.
Completed files are stored under `/data/call-artifacts/<call_id>/` with private file permissions.
The worker converts the mixed WAV to a mono, 16 kHz, 32 kbit/s MP3 after the call.
It verifies a playable audio stream before returning the MP3. It rejects recordings that ended substantially before the capture stop time.
Downloads stream to disk with a 128 MiB bound. Source recordings are deleted only after successful conversion and validation.
Failed conversions retain the source for retry. Invalid existing MP3s are preserved separately and excluded from attachments.
No retention schedule is configured.

Without an export directory, the first result page returns native `audio/mpeg` audio and an embedded `text/markdown` document.
The document contains every stored transcript turn, even when the JSON response needs more pages.
Later pages return transcript data and file metadata without repeating the attachments.
`artifacts.audio_status` distinguishes available, pending, missing, unanswered, and unrecorded audio.
Calls made before recording was enabled have a Markdown transcript only.

For Hermes on the same server, configure `artifact_export_directory`, `artifact_client_directory`, and `artifact_export_group`.
The worker copies validated files into a dedicated output folder and returns each `local_path`, plus explicit `MEDIA:` tags.
Hermes can then attach both files through its existing output mount. This avoids its 10 MiB MCP wire-body cap for long recordings.
It preserves the MP3 bitrate and does not change Hermes code or its response-size protection.
Use a dedicated bind for the calling worker, with the client group as a supplementary group.
Export directories use mode `2750`; files use `0640`. Hermes has read access to these copies, not the private database or provider credentials.
The private originals remain under `/data/call-artifacts`. No retention schedule is configured for either copy.
Check both `audio_status` and `delivery_status`; an export failure must not be reported as successful file delivery.

A real two-hour synthetic MP3 measured 28,800,512 bytes. Its shared-file MCP payload was 1,638 bytes.
Hermes's native attachment parser accepted both paths, verified their hashes, and had read-only access.
This was a file-delivery check, not a telephone call or Telegram upload.
A synthetic Asterisk recording, real FFmpeg conversion, and native Hermes file decoding passed.
The first Hermes-initiated call delivered its Markdown file but exposed the early-recording bug and fragmented speech.
The fixes passed isolated Asterisk recording and a complete MCP prepare/start/wait/end/result cycle with synthetic speech.
Real-phone audio quality after these fixes still needs a listening test; no overnight test dialed a telephone.

Hermes uses the Android-only `phone_call_poll` alias, with a 20–25 second wait and a default of 20 seconds.
The original `wait_for_call_event` remains available for existing clients. Both call the same implementation.
The pinned Hermes runtime recognizes the `_poll` naming convention as repeatable polling; the old name can trigger its stall detector.
Keep other loop protections enabled. The deployment sets Hermes's supported `agent.max_turns` to 500 and this MCP server's timeout to 90 seconds.
That leaves room for a two-hour call, result pagination, and file conversion. The default 60 turns could stop monitoring too early.

## Intentions and personalities

The call brief has separate `intention` and `personality` fields. Style never expands the owner's authority.

| Field | Choices |
| --- | --- |
| `intention` | `task`, `conversation`, `sales`, `roleplay`, `prank` |
| `personality` | `professional`, `warm`, `salesperson`, `playful` |
| `max_duration_seconds` | Optional per-call budget, from 30 to 7,200 seconds, within the deployment ceiling |

For `sales`, `business` must include `name`, `description`, `offer`, `desired_next_step`, and `contact_permission`.
The last field is `recipient_requested` or `prior_consent`; Hermes must obtain the actual fact, never infer it.
Optional business fields are `audience`, `approved_claims`, and `pricing`.
Preparation returns missing fields before creating a plan. The confirmation binds the intention, personality, and duration.
For fictional sales practice, use `intention=roleplay` with `personality=salesperson`.

The sales prompt uses a concise reason for calling, a relevant benefit, listening, a clarifying question for ambiguous objections,
and one approved next step. It prohibits invented claims, prices, relationships, and pressure after a clear refusal.
This is an original synthesis of [Gong's cold-calling guidance](https://www.gong.io/blog/cold-calling-tips)
and [Salesforce's prospecting guidance](https://trailhead.salesforce.com/content/learn/modules/cold-calling-for-sales/start-cold-calling-prospects).
Vendor research informs the prompt; it does not establish this agent's sales effectiveness.

Conversation and role-play can include clearly fictional stories and harmless persona changes.
Prank calls must remain light and clearly playful, reveal the joke when asked, and stop if unwelcome.
They must not impersonate trusted people or authorities, fabricate emergencies, or seek payment or sensitive information.
Requests to change style or language are distinct from requests to override permissions or reveal hidden instructions.
Direct sales opt-outs are saved before closing and prevent future starts, including previously prepared plans.
The result reports `recipient_opted_out`. The voice model cannot remove that preference.
The selected Inworld path corrects explicit English and Spanish claims to be the named owner before synthesis and transcript creation.
This supplements the identity instructions; it is not a claim of universal language-model compliance.

Spain requires prior consent for automated commercial calls. Unsolicited commercial calls cannot use mobile-number ranges.
The Spanish mobile SIM is therefore not a route for unrestricted unsolicited sales outreach.
See [AEPD's automated-call guidance](https://www.aepd.es/preguntas-frecuentes/5-publicidad-no-deseada/FAQ-0502-llamadas-automatizadas-sin-intervencion-humana-con-fines-comerciales)
and [Order TDF/149/2025, article 9](https://www.boe.es/buscar/act.php?id=BOE-A-2025-2870#a9).

## Conversational delivery

The voice instructions use a brief, relationship-appropriate greeting instead of a mandatory technical identity announcement.
An expected owner test can start casually. Other recipients still hear whom the assistant is calling for and why.
The assistant must answer identity questions honestly and must not impersonate a human or invent personal experiences.
Turns use plain spoken language, contractions, specific reactions, and at most one question at a time.
The instructions discourage repeated acknowledgements, excessive praise, repeated readbacks, and restarting the introduction.
The approved brief determines whether the call is a practical task or a longer conversation.

Runtime notices give the model the remaining call budget without an extra model request.
Near the limit, a closing cue waits for a quiet boundary before requesting a natural farewell.
It does not duplicate an existing farewell, and it is canceled when the session ends.
The separate three-second reply window and interruption handling remain in place.
The hard cap includes connection setup, so a conversation can be shorter than the configured maximum.

The owner-authorized longer trial uses `inworld_model=inworld-tts-2` for more expressive speech,
with a 180-second cap. Flash remains the lower-cost configuration default.
One direct provider replay with the updated prompt and TTS-2 measured 1.72 seconds to server PCM.
The longer phone test returned 23 transcript turns and ended when the owner asked to stop.
The owner found it better but still robotic in wording and voice. Quality acceptance remains open.
Live text-model probes covered the opening, relevant follow-ups, a request to stay, truthful identity, and closing.

The earlier multilingual trial selected `dialogue_model=qwen/qwen3.8-27b`,
`dialogue_provider=cerebras`, and `reasoning_effort=none` through the existing OpenRouter account.
Dialogue temperature is 0.4. The earlier English trial used Llama 3.3 70B on Groq.
It keeps Inworld TTS-2 with `inworld_voice=Wade` and `inworld_delivery_mode=CREATIVE`.
The owner selected Wade from identical-text previews. The later Haiku 4.5 phone trial returned
16 transcript turns, but the owner reported excessive delay before replies.

A five-turn server replay measured a 1.932-second median with Haiku 4.5.
Reply inference took 0.699–1.213 seconds; Wade synthesis took 0.179–0.191 seconds.
After the model change and closing corrections, the same clean replay measured 1.186 seconds
at the median and 1.249 seconds at the maximum. A replay with synthetic background noise
measured 1.210 and 1.346 seconds respectively. These small samples measure speech end to
server PCM; they exclude cellular and handset delay. Subsequent phone evidence is recorded below; wider voice-quality acceptance remains open.

With no fallback providers configured, a pinned route fails instead of silently using another host.
The selected configuration permits only the listed Google fallback. A null reasoning setting omits that API field for non-reasoning models.
Runtime notices update one leading system instruction instead of accumulating in the history.
Pipecat's latency observer logs stage durations without speech or credentials.

The `finish_call` tool now queues its farewell through Pipecat's existing speech frame.
The model must not speak that farewell separately. If it already generated the same farewell in
the current response, the tool waits for that playback instead of queuing it again. Reply tracking
resets with each model response, so an older farewell cannot satisfy the guard. Hangup requires completed playback
and the full three-second reply window. An interruption cancels closing.
Tests cover tool-only closing, duplicate requests, invalid farewells, and interrupted playback.
The first fast-model replay exposed premature farewells; clearer tool instructions fixed both
subsequent clean and noisy replays. Broader conversation quality remains an acceptance requirement.

## Language switching and caller instructions

The `language` field selects the initial language: `en`, `es`, `ru`, or `uk`.
The deployment's `conversation_languages` list controls which languages may be used during a call.
Its default remains English and Spanish; the owner trial enables all four.
Soniox receives all enabled languages as hints. Inworld detects each reply's language from its text,
instead of forcing an English or Spanish locale. Short numeric answers use words in the current language.
The opening connection cue is internal context and is not added to the recipient transcript.

A language request can change the conversation language, but cannot change the approved task or authority.
Instructions reject requests to disclose hidden prompts, invent authorization, or bypass the brief.
The model receives no provider credentials and has only the closing tool. SIM selection, destination
admission, deadlines, and access control remain enforced outside the model.
Sample injection probes passed in all four languages; these examples do not prove universal resistance.

The first faster phone trial produced six measured replies between 1.072 and 1.186 seconds at the server.
The owner liked it, but a pipeline failure ended the call early. That version was rolled back before
further work. Language-switch replays did not reproduce the error, so its cause remains unconfirmed.
Structured error logs now record the processor, exception class, category, and HTTP status without
speech, raw error messages, or credentials.

The new multilingual phone trial completed normally with 36 transcript turns and replies in all four languages.
It ended after the owner requested it and handled a follow-up goodbye before hangup. Thirteen server measurements
had a 1.210-second median, 1.878-second p90, and 2.967-second maximum. No pipeline error or extraction tokens
were recorded, and the phone returned to idle. Hermes retrieved all 36 transcript records through its native MCP client.
This single call does not establish broad reliability or voice-quality acceptance.
The selected Qwen/Cerebras replay answered in all four languages and closed once in Ukrainian.
Ordinary reply delays were 1.162–1.217 seconds at the server; the closing reply took 3.274 seconds.
The five-turn median was 1.215 seconds. This small sample does not establish tail-latency acceptance.
An internal connection cue supplies the initial user message required by the Cerebras chat template.

Inworld lists English, Spanish, and Russian in its highest-evaluated tier, with Ukrainian in its
supported second tier. Check the chosen voice with a native speaker before wider use.
See [Inworld language support](https://docs.inworld.ai/tts/capabilities/multilingual) and
[Soniox language detection](https://soniox.com/speech-to-text/features/language-detection).

## Deployment

Install optional dependencies with `uv sync --extra android --all-groups --frozen`.
`Dockerfile.android` installs the locked, hashed `requirements-android.txt` export.
`Dockerfile.asterisk` builds the pinned upstream source and verifies its published checksum.
`Dockerfile.asterisk-runtime` can update the entrypoint using the documented local base image;
on a fresh host, build the full Asterisk image first.
The entry points run without root and support a read-only root filesystem.

The voice worker loads `/run/secrets/agent-call.json` with `settings` and `android` objects.
`Settings.from_values` ignores ambient environment settings. `AndroidConfig` validates the private configuration.
Mount the OpenRouter key at `/run/secrets/openrouter-api-key` and ARI/media passwords at
`/run/secrets/asterisk.json`. The Asterisk container has its own configuration with a separate SIP password.
Mount the recovery controller's status directory read-only at `/run/phone` and persistent SQLite storage at `/data`.
Never include real credentials, phone numbers, transcripts, or host access records in this repository.

The worker serves authenticated MCP at `/mcp/` and an authenticated media WebSocket at `/phone-media`.
Keep both private. `/healthz` is process liveness; `/readyz` checks control supervision.
Phone and registration checks also run at admission. Health alone does not mean that a call can start.
Only Asterisk's SIP and RTP ports need a narrow phone-to-server network rule.
Back up configuration and confirm no active call before deployment.

Default speech services are Deepgram Nova-3 and Eleven Flash v2.5, using the Sarah voice.
Both use the same OpenRouter key. A small server comparison found faster recognition with Nova-3
than Whisper Large V3 Turbo. Full replay improved from 3.17–3.53 seconds to 2.33–2.68 seconds with Nova-3. These measure speech end to server PCM, excluding phone and carrier delay.
The dialogue model is Gemini 3.1 Flash Lite with reasoning disabled. A small synthetic comparison
found faster complete replies than the initially tested Gemini 3.8 Flash configuration.
This is a preliminary choice, not a full model evaluation. Provider and phone latency still need measurement.

## Acceptance checks

1. Verify the authenticated MCP flow without dialing.
2. Check Asterisk media and gateway registration without a cellular call.
3. Call an owner-controlled recipient and test both hangup directions.
4. Test all enabled languages, interruptions, and a reply after the farewell.
5. Retrieve every transcript page, play the MP3, open the complete Markdown file, and confirm no summary-model request.
6. Test worker failure, USB reconnect, deadlines, and restart without duplicate dialing.

The initial latency target is a median below 1.5 seconds and a 90th percentile below 3 seconds,
from actual recipient speech end to the first audio they hear. These remain targets.
Synthetic provider probes already show that the sequential speech path may miss them.
Measure recognition, model, speech generation, and playback separately. Do not claim readiness from text arrival.

## Soniox and Inworld streaming route

The selected route uses Soniox STT RT v5, Inworld TTS-2 with Wade, and Gemini 3.1 Flash-Lite
through OpenRouter. Google AI Studio is preferred, with Google Vertex available as a fallback.
It reuses the pinned Pipecat adapters.
Provider replays and one cellular trial exercised all four enabled languages. Wider recognition and voice quality still require testing.

Merge these fields into the private configuration's `android` object:

```json
{
  "conversation_languages": ["en", "es", "ru", "uk"],
  "stt_transport": "soniox",
  "soniox_model": "stt-rt-v5",
  "soniox_turn_detection": "semantic",
  "tts_transport": "inworld",
  "inworld_model": "inworld-tts-2",
  "inworld_voice": "Wade",
  "inworld_delivery_mode": "CREATIVE",
  "dialogue_model": "google/gemini-3.1-flash-lite",
  "dialogue_provider": "google-ai-studio",
  "dialogue_fallback_providers": ["google-vertex"],
  "reasoning_effort": "none"
}
```

Mount the Soniox key at `/run/secrets/soniox-api-key` and Inworld's complete Basic (Base64)
credential at `/run/secrets/inworld-api-key`. Keep the existing OpenRouter mount for dialogue.
These must be separate read-only files, available only to the voice worker.
Missing or malformed credentials refuse service startup. Language-model fallbacks are limited to the configured providers.
The default transports remain `openrouter_file` and `openrouter` for existing configuration compatibility.

The hardening replay reproduced one-word Qwen replies after interrupted history on both Cerebras and DeepInfra.
Cerebras also returned shared-pool rate limits. Four direct Gemini cases returned complete replies with 0.528–0.736 seconds to first text.
These are small samples, not a general model benchmark. The voice replay separately exercised interruptions and four languages.
The Inworld adapter excludes unsaid fallback text after interruption. Closing waits for paced audio output to finish before starting its reply window.

To remove trial-only destination and duration settings, set `settings.allow_all_country_codes=true`,
`android.allow_any_destination=true`, `android.allowed_destinations=[]`, `android.default_call_seconds=1800`,
and `android.max_call_seconds=7200`. Invalid numbers, short emergency codes, the service's own line, explicit-confirmation checks,
single-call admission, and the selected-SIM policy remain enforced.

`scripts/android_media_canary.py` verifies two-way PCM and mixed recording on an isolated Asterisk instance.
`scripts/android_mcp_canary.py` verifies the MCP lifecycle, persistence, MP3, and Markdown using local WebSocket legs and synthetic speech.
Run these only in disposable, network-isolated containers with generated test credentials and private output storage.
Neither script has a cellular dialing path. They complement the provider replays and offline suite; they do not replace a handset listening test.

Soniox receives continuous mono 8 kHz PCM. The selected `semantic` mode lets Soniox decide when turns end.
Local voice activity detection interrupts playback promptly and cancels pending hangup.
The mode uses latency level 2,
sensitivity 0.3, and a 500 ms maximum endpoint-delay setting by default.
These settings are omitted from provider requests in `vad` mode; sending them with endpointing disabled is invalid.
The optional `vad` mode finalizes after 300 ms of silence. Earlier probes found it faster on two Spanish examples,
but the overnight overlap replay showed that short pauses can split a sentence and trigger unwanted responses.
The revised voice replay measured ordinary reply starts at 1.297–1.711 seconds at the server.
This small sample excludes carrier and handset delay and does not establish production latency percentiles.
The deployment supplies the enabled language hints. The transcript preserves both speakers and their original language.

A small wrapper normalizes Soniox error-only messages before Pipecat 1.13 parses them.
This makes provider rejection reach the existing pipeline failure handler instead of leaving the call silent.

Inworld uses a persistent WebSocket, PCM at 8 kHz, and automatic output-language detection.
Pipecat sends completed sentences as model text arrives. Inworld's auto mode schedules speech
without waiting for a complete model reply. Word timestamps keep the conversation history aligned with playback.
The three-second farewell reply window, destination policy, and selected SIM checks remain in force.

Local tests cover both turn modes through real loopback WebSockets with simulated providers. They verify audio transmission before
turn completion, speech output before model completion, transcripts in all four languages, provider-error handling,
missing-key refusal, interruption flushing, cancellation of pending hangup, and task cleanup.
They make no external provider request and do not establish audible phone latency or provider accuracy.

## Earlier Flux experiment

An optional `android.stt_transport=deepgram_flux` route uses Pipecat's existing Flux WebSocket service.
It accepts the direct Deepgram key from `/run/secrets/deepgram-api-key`, uses `flux-general-multi`,
and lets Flux control turns. Pipecat prepares a speculative reply on an eager turn boundary,
holds it until confirmation, and discards it if the speaker resumes. The three-second farewell window remains.
The route fails closed when its separate credential is absent. It never falls back to uploaded audio.
A loopback test verifies that audio reaches the streaming service before the user finishes a turn.

This optional route remains available for comparison. The deployment uses Soniox and Inworld streaming;
neither selection establishes a fastest provider.
