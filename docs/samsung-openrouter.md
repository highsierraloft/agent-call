# Samsung and OpenRouter integration

This fork targets an existing Android SIP gateway and a single OpenRouter account.
The requesting assistant, such as Hermes, gathers the call details and sends the brief
through MCP. The phone agent conducts the conversation and returns its transcript.
The requesting assistant interprets the result and writes any summary.

## Current status

The upstream baseline passed 719 automated tests, with two skipped, before changes.
These tests use simulated providers. They do not establish working cellular audio.

Implemented in this branch:

- `POST_CALL_EXTRACTION_ENABLED=false` saves the transcript and telephone status
  without requesting a post-call model extraction or sending a summary push.
- `get_call_result` returns transcript text, speakers, timestamps, and source metadata.
  Each response contains at most 100 transcript records. Pass a non-null
  `next_transcript_cursor` back as `after_sequence` to retrieve the next page.
- A normal telephone disconnect does not establish task success. Transcript-only
  results leave the objective outcome unknown for the requesting assistant to assess.

The Samsung telephone backend and OpenRouter voice pipeline are not operational yet.
The existing live backend still requires OpenAI and Twilio. Do not start it expecting
to use an Android SIM or an OpenRouter key.

## Planned integration

Keep the existing MCP tools, brief model, authentication, destination policy, database,
and call ownership rules. Add a distinct backend for the Android route. Do not emulate
Twilio or OpenAI callbacks with invented provider events.

Use the released Android Voice SIP Agent and Shizuku on a tested handset. Use Asterisk
for SIP signaling and audio transport. Use Pipecat's existing Asterisk and speech
integrations for the conversational pipeline. OpenRouter provides speech recognition,
the conversational model, and speech generation. No separate summary model is needed.

The telephone connection must remain private. Exposing SIP and media ports requires
an explicit host-specific routing plan. Provider credentials belong in private secret
files or the deployment secret store, never in source, tests, transcripts, or logs.

Only the exact active call may control the handset. Admission must check phone readiness,
registration, provider configuration, and call limits. Cancellation and deadlines must
verify telephone teardown independently of model completion. An ambiguous disconnect
must not trigger an automatic redial.

## Acceptance checks

1. Verify the MCP flow with dialing disabled and no provider requests.
2. Test the real phone media path with an owner-controlled recipient, including both hangup directions.
3. Test the voice pipeline in English and Spanish with interruptions and unexpected replies.
4. Retrieve every transcript fragment through MCP and verify that no summary-model request occurred.
5. Test worker failure, phone reconnect, deadlines, and uncertain call completion without duplicate dialing.

For short ordinary replies, the initial latency target is a median below 1.5 seconds
and a 90th percentile below 3 seconds, measured from the callee's speech end to the first
audio they hear. These are targets, not measured results. Separate recognition, model,
speech generation, and playback delays. Do not claim conversational readiness from
text arrival or a simulated transport test.

The upstream OpenAI/Twilio path remains available. Its existing credentials and tests
must keep working unless an explicit migration changes that scope.
