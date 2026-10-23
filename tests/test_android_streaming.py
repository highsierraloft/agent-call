from __future__ import annotations

import asyncio
import base64
import json

import pytest
from fastapi import WebSocket

pytest.importorskip("pipecat")

from pipecat.frames.frames import (
    LLMTextFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from websockets.asyncio.server import serve

from app.android_calls import AndroidCallService
from app.android_config import AndroidConfig
from app.android_voice import AndroidVoiceSession, VoiceCallbacks


@pytest.mark.parametrize("language", ["en", "es"])
@pytest.mark.parametrize("turn_detection", ["semantic", "vad"])
@pytest.mark.parametrize("provider_error", [None, "soniox", "inworld", "interruption"])
async def test_streaming_audio_transcripts_and_provider_failure(
    packet, tmp_path, monkeypatch, language, turn_detection, provider_error
):
    """Exercise the pinned adapters over real local sockets, without provider requests."""
    import app.android_voice as module

    input_received = asyncio.Event()
    finalize_allowed = asyncio.Event()
    output_received = asyncio.Event()
    assistant_recorded = asyncio.Event()
    failed = asyncio.Event()
    model_done = asyncio.Event()
    interrupt_allowed = asyncio.Event()
    speech_canceled = asyncio.Event()
    media_flushed = asyncio.Queue()
    stt_configs, tts_configs, transcripts, contexts, model_inputs = [], [], [], [], []
    spoken_texts = []
    output_audio = b"\x00\x04" * 1600
    input_audio = b"\x00\x08" * 160
    utterance = "We open at noon." if language == "en" else "Abrimos al mediodía."
    reply = "Thank you. " if language == "en" else "Muchas gracias. "
    reply += "Anything else? " if language == "en" else "¿Algo más? "

    async def soniox_provider(ws):
        assert ws.request.headers["Authorization"] == "Bearer test-soniox-private-credential"
        stt_configs.append(json.loads(await ws.recv()))
        async for message in ws:
            if not isinstance(message, bytes):
                continue
            assert input_audio in message
            input_received.set()
            await ws.send(json.dumps({"tokens": [{"text": utterance, "is_final": False}]}))
            await finalize_allowed.wait()
            if turn_detection == "vad":
                assert json.loads(await ws.recv()) == {"type": "finalize"}
            if provider_error == "soniox":
                await ws.send(json.dumps({"error_code": 401, "error_message": "Test rejection"}))
            else:
                await ws.send(
                    json.dumps(
                        {
                            "tokens": [
                                {"text": utterance, "is_final": True, "language": language},
                                {
                                    "text": "<end>" if turn_detection == "semantic" else "<fin>",
                                    "is_final": True,
                                },
                            ]
                        }
                    )
                )
            break
        if provider_error == "interruption":
            await interrupt_allowed.wait()
            await ws.send(json.dumps({"tokens": [{"text": "Wait", "is_final": False}]}))
        await ws.wait_closed()

    async def inworld_provider(ws):
        assert ws.request.headers["Authorization"] == "Basic test-inworld-private-credential"
        async for raw in ws:
            message = json.loads(raw)
            context_id = message.get("contextId")
            if "create" in message:
                contexts.append(context_id)
                tts_configs.append(message["create"])
                await ws.send(
                    json.dumps({"result": {"contextId": context_id, "contextCreated": {}}})
                )
            if "send_text" in message:
                if provider_error == "inworld":
                    await ws.send(
                        json.dumps(
                            {
                                "result": {
                                    "contextId": context_id,
                                    "status": {"code": 16, "message": "Test rejection"},
                                }
                            }
                        )
                    )
                    continue
                text = message["send_text"]["text"].strip()
                spoken_texts.append(text)
                words = text.split()
                await ws.send(
                    json.dumps(
                        {
                            "result": {
                                "contextId": context_id,
                                "audioChunk": {
                                    "audioContent": base64.b64encode(output_audio).decode(),
                                    "timestampInfo": {
                                        "wordAlignment": {
                                            "words": words,
                                            "wordStartTimeSeconds": [
                                                i * 0.2 / len(words) for i in range(len(words))
                                            ],
                                            "wordEndTimeSeconds": [
                                                (i + 1) * 0.2 / len(words)
                                                for i in range(len(words))
                                            ],
                                        }
                                    },
                                },
                            }
                        }
                    )
                )
            if "flush_context" in message:
                await ws.send(
                    json.dumps({"result": {"contextId": context_id, "flushCompleted": {}}})
                )
            if "close_context" in message:
                speech_canceled.set()
                await ws.send(
                    json.dumps({"result": {"contextId": context_id, "contextClosed": {}}})
                )

    async with (
        serve(soniox_provider, "127.0.0.1", 0) as stt_server,
        serve(inworld_provider, "127.0.0.1", 0) as tts_server,
    ):

        class LocalSoniox(module.SonioxSTTService):
            def __init__(self, **kwargs):
                super().__init__(
                    url=f"ws://127.0.0.1:{stt_server.sockets[0].getsockname()[1]}", **kwargs
                )

        class LocalInworld(module.InworldTTSService):
            def __init__(self, **kwargs):
                super().__init__(
                    url=f"ws://127.0.0.1:{tts_server.sockets[0].getsockname()[1]}", **kwargs
                )

        class LocalDialogue(module.OpenRouterVoiceLLMService):
            async def _process_context(self, context):
                model_inputs.append(context.get_messages())
                await self.push_frame(LLMTextFrame(reply))
                # Require speech playback to begin before model completion.
                await output_received.wait()
                if provider_error == "interruption":
                    await asyncio.Event().wait()
                model_done.set()

        monkeypatch.setattr(module, "SonioxSTTService", LocalSoniox)
        monkeypatch.setattr(module, "InworldTTSService", LocalInworld)
        monkeypatch.setattr(module, "OpenRouterVoiceLLMService", LocalDialogue)
        incoming = asyncio.Queue()
        outgoing = []

        async def send(message):
            outgoing.append(message)
            if "FLUSH_MEDIA" in message.get("text", ""):
                media_flushed.put_nowait(True)
            if message.get("bytes") and not output_received.is_set():
                assert not model_done.is_set()
                output_received.set()

        def record(*args):
            transcripts.append(args)
            if args[0] == "assistant":
                assistant_recorded.set()

        async def finish(guard):
            raise AssertionError("The dialogue did not request hangup")

        websocket = WebSocket(
            {"type": "websocket", "path": "/phone-media", "headers": []}, incoming.get, send
        )
        await incoming.put({"type": "websocket.connect"})
        await websocket.accept(subprotocol="media")
        soniox_key, inworld_key = tmp_path / "soniox", tmp_path / "inworld"
        soniox_key.write_text("test-soniox-private-credential")
        inworld_key.write_text("test-inworld-private-credential")
        config = AndroidConfig(
            selected_sim_slot=1,
            caller_number="+12025550199",
            allowed_destinations=["+12025550123"],
            stt_transport="soniox",
            soniox_key_file=soniox_key,
            soniox_turn_detection=turn_detection,
            tts_transport="inworld",
            inworld_key_file=inworld_key,
        )
        session = AndroidVoiceSession(
            websocket,
            call_id="call_streaming",
            packet=packet.model_copy(update={"language": language}),
            config=config,
            api_key="unused-openrouter-test-key",
            callbacks=VoiceCallbacks(record, failed.set, finish),
        )
        task = asyncio.create_task(session.run())
        try:
            await incoming.put(
                {
                    "type": "websocket.receive",
                    "text": json.dumps(
                        {
                            "event": "MEDIA_START",
                            "connection_id": "test",
                            "channel": "WebSocket/test",
                            "channel_id": "call_streaming-media",
                            "format": "slin",
                            "optimal_frame_size": 320,
                            "ptime": 20,
                        }
                    ),
                }
            )
            await asyncio.wait_for(session.ready.wait(), 15)
            await incoming.put({"type": "websocket.receive", "bytes": input_audio})
            await asyncio.wait_for(input_received.wait(), 5)
            assert not model_inputs and not transcripts and not tts_configs
            assert stt_configs[0]["sample_rate"] == 8000
            assert stt_configs[0]["model"] == "stt-rt-v5"
            assert stt_configs[0]["enable_endpoint_detection"] == (turn_detection == "semantic")
            assert stt_configs[0]["max_endpoint_delay_ms"] == (
                500 if turn_detection == "semantic" else None
            )
            assert stt_configs[0]["endpoint_latency_adjustment_level"] == (
                2 if turn_detection == "semantic" else None
            )
            assert stt_configs[0]["endpoint_sensitivity"] == (
                0.3 if turn_detection == "semantic" else None
            )
            assert stt_configs[0]["language_hints"] == [language]
            finalize_allowed.set()
            if turn_detection == "vad":
                await session._worker.queue_frame(VADUserStartedSpeakingFrame())
                await session._worker.queue_frame(VADUserStoppedSpeakingFrame(stop_secs=0.3))
            if provider_error == "interruption":
                await asyncio.wait_for(output_received.wait(), 5)
                while not media_flushed.empty():
                    media_flushed.get_nowait()
                session.closing.played("Goodbye.", interrupted=False)
                session.closing.request("Goodbye.")
                guard = session.closing.guard()
                assert guard and guard()
                interrupt_allowed.set()
                if turn_detection == "vad":
                    await session._worker.queue_frame(VADUserStartedSpeakingFrame())
                await asyncio.wait_for(media_flushed.get(), 5)
                await asyncio.wait_for(speech_canceled.wait(), 5)
                assert not guard()
                assert len(model_inputs) == 1
                assert not model_done.is_set()
                assert len(contexts) == 1
                unheard_tail = "Anything else?" if language == "en" else "¿Algo más?"
                assert all(
                    unheard_tail not in row[1] for row in transcripts if row[0] == "assistant"
                )
                assert not failed.is_set()
            elif provider_error:
                await asyncio.wait_for(failed.wait(), 5)
                assert not output_received.is_set()
            else:
                await asyncio.wait_for(assistant_recorded.wait(), 10)
                assert output_received.is_set() and model_done.is_set()
                assert not failed.is_set()
                assert [row[0] for row in transcripts] == ["callee", "assistant"]
                assert transcripts[0][1] == utterance
                assert transcripts[1][1].strip() == reply.strip()
                assert not transcripts[1][3]
                assert " ".join(spoken_texts) == reply.strip()
                assert output_audio * len(spoken_texts) == b"".join(
                    item.get("bytes", b"") for item in outgoing
                )
                assert len(contexts) == 1
            if tts_configs:
                assert tts_configs[0]["modelId"] == "inworld-tts-2-flash"
                assert tts_configs[0]["audioConfig"] == {
                    "audioEncoding": "PCM",
                    "sampleRateHertz": 8000,
                }
                assert tts_configs[0]["language"] == ("en-US" if language == "en" else "es-ES")
                assert tts_configs[0]["autoMode"]
        finally:
            finalize_allowed.set()
            interrupt_allowed.set()
            await incoming.put({"type": "websocket.disconnect", "code": 1000})
            await asyncio.wait_for(task, 10)
        assert not any(
            "FlowController.flow_control" in str(pending.get_coro())
            for pending in asyncio.all_tasks()
            if not pending.done()
        )


@pytest.mark.parametrize("missing", ["soniox", "inworld"])
async def test_missing_provider_key_refuses_service_start(settings, database, tmp_path, missing):
    settings.post_call_extraction_enabled = False
    soniox, inworld = tmp_path / "soniox", tmp_path / "inworld"
    (inworld if missing == "soniox" else soniox).write_text("test-private-credential-for-loopback")
    config = AndroidConfig(
        selected_sim_slot=1,
        caller_number="+12025550199",
        allowed_destinations=["+12025550123"],
        stt_transport="soniox",
        soniox_key_file=soniox,
        tts_transport="inworld",
        inworld_key_file=inworld,
    )
    with pytest.raises(ValueError, match=missing.title() + " credential is unavailable"):
        AndroidCallService(
            settings, database, config=config, asterisk=None, phone=None, api_key="unused"
        )


@pytest.mark.parametrize("provider", ["soniox", "inworld"])
def test_invalid_provider_key_is_not_in_the_error(tmp_path, provider):
    key = tmp_path / "key"
    secret = "invalid private credential with whitespace"
    key.write_text(secret)
    config = AndroidConfig(
        selected_sim_slot=1,
        caller_number="+12025550199",
        allowed_destinations=["+12025550123"],
        **{provider + "_key_file": key},
    )
    with pytest.raises(ValueError) as error:
        getattr(config, provider + "_key")()
    assert secret not in str(error.value)
    assert "credential is invalid" in str(error.value)
