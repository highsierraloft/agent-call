# Samsung and OpenRouter integration

This fork connects an existing Android SIP gateway to configurable voice providers.
The requesting assistant, such as Hermes, gathers the details and sends a brief through MCP.
The voice agent conducts the call and returns the transcript. Hermes interprets it and writes any summary.

## Implemented path

`Hermes → Agent Call MCP → Asterisk → Android Voice SIP Agent → selected cellular SIM`

Pipecat handles speech recognition, conversation, and speech generation.
OpenRouter supplies the dialogue model. Speech can use OpenRouter or direct streaming providers.
The deployment uses Asterisk 22.11.0, Pipecat 1.13.0, and pipecat-asterisk 0.1.4.
The latter needs explicit cleanup of its unmanaged audio flow task. A regression test checks that cleanup.
A separate gateway fork pins an explicit Android phone account. The stock gateway does not meet that requirement.

The Android backend reuses Agent Call's prepared plans, confirmation binding, atomic call admission,
authenticated MCP tools, SQLite storage, and transcript finalizer. It does not emulate provider webhooks.
The existing OpenAI/Twilio backend remains the default and retains its existing routes and tests.

- Set `call_backend` to `android_openrouter` and `post_call_extraction_enabled` to `false`.
- Supply a call language, `en` or `es`, and `escalation.mode=end_call` in the brief.
- The deployment requires an explicit destination allowlist. The default limit is 90 seconds; the owner-authorized conversation trial uses 180 seconds.
- The backend checks fresh phone supervision, the selected SIM policy, and SIP registration before dialing.
- It opens and validates the owned audio channel before originating the cellular leg.
- It starts the conversation only after the cellular channel reports an answer.
- Cancellation and deadlines end the owned channels. A new phone-idle observation must confirm teardown.
- An uncertain call remains terminating and blocks new calls. It never causes automatic redial.
- A recipient reply cancels a pending farewell. Closing preserves a three-second reply window.

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

The latest local suite passed 796 tests with two skips and 88.24% coverage.
The media simulation checks connection setup, buffering, shutdown, and task cleanup without model requests.
These checks do not prove cellular audio or acceptable conversation timing.
One owner-controlled outbound call completed with seven transcript turns and confirmed hangup.
The owner reported clear audio, long pauses, and a repeated introduction. The timing changes and
introduction fix were followed by a streaming call that completed with three transcript turns and agent-requested hangup.
That call did not repeat the introduction, and the phone returned to idle. The owner found it faster, but too robotic and too short.
Full unattended recovery remains unverified.

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
with the same Ashley voice and a 180-second cap. Flash remains the lower-cost configuration default.
One direct provider replay with the updated prompt and TTS-2 measured 1.72 seconds to server PCM.
This is slower than the earlier Flash samples; actual phone quality and timing still require the owner trial.
Live text-model probes covered the opening, relevant follow-ups, a request to stay, truthful identity, and closing.

## Deployment

Install optional dependencies with `uv sync --extra android --all-groups --frozen`.
`Dockerfile.android` installs the locked, hashed `requirements-android.txt` export.
`Dockerfile.asterisk` builds the pinned upstream source and verifies its published checksum.
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
4. Test English and Spanish, interruptions, and a reply after the farewell.
5. Retrieve every transcript page and confirm no summary-model request.
6. Test worker failure, USB reconnect, deadlines, and restart without duplicate dialing.

The initial latency target is a median below 1.5 seconds and a 90th percentile below 3 seconds,
from actual recipient speech end to the first audio they hear. These remain targets.
Synthetic provider probes already show that the sequential speech path may miss them.
Measure recognition, model, speech generation, and playback separately. Do not claim readiness from text arrival.

## Soniox and Inworld streaming route

The selected next route uses Soniox STT RT v5, Inworld Realtime TTS-2 Flash, and the existing
Gemini 3.1 Flash Lite dialogue model through OpenRouter. It reuses the pinned Pipecat adapters.
Direct English and Spanish provider replays passed. Cellular timing and broad recognition accuracy still require testing.

Merge these fields into the private configuration's `android` object:

```json
{
  "stt_transport": "soniox",
  "soniox_model": "stt-rt-v5",
  "soniox_turn_detection": "vad",
  "tts_transport": "inworld",
  "inworld_model": "inworld-tts-2-flash",
  "inworld_voice": "Ashley"
}
```

Mount the Soniox key at `/run/secrets/soniox-api-key` and Inworld's complete Basic (Base64)
credential at `/run/secrets/inworld-api-key`. Keep the existing OpenRouter mount for dialogue.
These must be separate read-only files, available only to the voice worker.
Missing or malformed credentials refuse service startup. They do not trigger a provider fallback.
The default transports remain `openrouter_file` and `openrouter` for existing configuration compatibility.

Soniox receives continuous mono 8 kHz PCM. The selected `vad` mode uses local voice activity detection
to request finalization after 300 ms of silence. Pipecat waits for the finalized transcript before requesting a reply.
It uses the existing speech-timeout strategy without an additional silence timer or turn-analysis model.
Resumed speech interrupts playback and cancels pending hangup. Test pauses and numbers before wider use.

The optional `semantic` mode lets Soniox decide when turns end. It uses latency level 2,
sensitivity 0.3, and a 500 ms maximum endpoint-delay setting by default.
These settings are omitted from provider requests in `vad` mode; sending them with endpointing disabled is invalid.
One English semantic replay reached 1.09 seconds, but two Spanish samples took 2.05–2.11 seconds.
The selected local mode reduced the Spanish example to 1.29 seconds while preserving the opening time.
These are synthetic speech-end-to-server-PCM measurements, excluding carrier and handset delay.
Each brief supplies an English or Spanish hint. The transcript preserves both speakers.

A small wrapper normalizes Soniox error-only messages before Pipecat 1.13 parses them.
This makes provider rejection reach the existing pipeline failure handler instead of leaving the call silent.

Inworld uses a persistent WebSocket, PCM at 8 kHz, and an explicit English or Spanish locale.
Pipecat sends completed sentences as model text arrives. Inworld's auto mode schedules speech
without waiting for a complete model reply. Word timestamps keep the conversation history aligned with playback.
The three-second farewell reply window, destination policy, and selected SIM checks remain in force.

Local tests cover both turn modes through real loopback WebSockets with simulated providers. They verify audio transmission before
turn completion, speech output before model completion, English/Spanish transcripts, provider-error handling,
missing-key refusal, interruption flushing, cancellation of pending hangup, and task cleanup.
They make no external provider request and do not establish audible phone latency or provider accuracy.

## Earlier Flux experiment

An optional `android.stt_transport=deepgram_flux` route uses Pipecat's existing Flux WebSocket service.
It accepts the direct Deepgram key from `/run/secrets/deepgram-api-key`, uses `flux-general-multi`,
and lets Flux control turns. Pipecat prepares a speculative reply on an eager turn boundary,
holds it until confirmation, and discards it if the speaker resumes. The three-second farewell window remains.
The route fails closed when its separate credential is absent. It never falls back to uploaded audio.
A loopback test verifies that audio reaches the streaming service before the user finishes a turn.

This optional route remains available for comparison. The selected next route is Soniox and Inworld;
neither selection establishes a fastest provider. The current deployment still uses completed-utterance uploads.
