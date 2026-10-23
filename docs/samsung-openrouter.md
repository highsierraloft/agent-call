# Samsung and OpenRouter integration

This fork connects an existing Android SIP gateway to a single OpenRouter account.
The requesting assistant, such as Hermes, gathers the details and sends a brief through MCP.
The voice agent conducts the call and returns the transcript. Hermes interprets it and writes any summary.

## Implemented path

`Hermes → Agent Call MCP → Asterisk → Android Voice SIP Agent → selected cellular SIM`

Pipecat handles speech recognition, conversation, and speech generation through OpenRouter.
The deployment uses Asterisk 22.11.0, Pipecat 1.13.0, and pipecat-asterisk 0.1.4.
The latter needs explicit cleanup of its unmanaged audio flow task. A regression test checks that cleanup.
A separate gateway fork pins an explicit Android phone account. The stock gateway does not meet that requirement.

The Android backend reuses Agent Call's prepared plans, confirmation binding, atomic call admission,
authenticated MCP tools, SQLite storage, and transcript finalizer. It does not emulate provider webhooks.
The existing OpenAI/Twilio backend remains the default and retains its existing routes and tests.

- Set `call_backend` to `android_openrouter` and `post_call_extraction_enabled` to `false`.
- Supply a call language, `en` or `es`, and `escalation.mode=end_call` in the brief.
- The first deployment requires an explicit destination allowlist and limits calls to 90 seconds.
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
Costs are not yet reconciled against carrier and OpenRouter billing; the backend returns no cost estimate.

The Android path has no owner transfer, mid-call question tool, answering-machine detection,
or in-call web search. If a required fact is missing, the voice agent ends politely.
These features remain available in the separate upstream backend where documented.

The local suite passed 772 tests with two skips and 88.04% coverage.
The media simulation checks connection setup, buffering, shutdown, and task cleanup without model requests.
These checks do not prove cellular audio or acceptable conversation timing.
One owner-controlled outbound call completed with seven transcript turns and confirmed hangup.
The owner reported clear audio, long pauses, and a repeated introduction. The timing changes and
introduction fix still need another real call. Full unattended recovery remains unverified.

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
