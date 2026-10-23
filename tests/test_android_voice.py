from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from fastapi import WebSocket

pytest.importorskip("pipecat")

from app.android_config import AndroidConfig
from app.android_voice import AndroidVoiceSession, ClosingWindow, VoiceCallbacks, voice_instructions


def test_closing_requires_output_and_a_reply_cancels_it():
    closing = ClosingWindow()
    closing.request("Goodbye.")
    assert closing.guard() is None
    closing.played("Thank you. Goodbye.", interrupted=False)
    guard = closing.guard()
    assert guard is not None and guard()
    closing.user_started()
    assert not guard()
    assert closing.guard() is None


def test_interrupted_or_old_farewell_cannot_close_new_turn():
    closing = ClosingWindow()
    closing.played("Goodbye.", interrupted=True)
    closing.request("Goodbye.")
    assert closing.guard() is None
    closing.played("Goodbye.", interrupted=False)
    closing.user_started()
    closing.request("Goodbye.")
    assert closing.guard() is None


def test_operational_phone_numbers_are_not_in_voice_prompt(packet):
    prompt = voice_instructions(packet)
    assert packet.owner.callback_number not in prompt
    assert packet.target.phone not in prompt
    assert packet.objective in prompt
    assert "Do not write a post-call summary" in prompt


async def test_pinned_components_start_media_without_model_calls(packet, tmp_path):
    incoming: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    outgoing = []

    async def receive():
        return await incoming.get()

    async def send(message):
        outgoing.append(message)

    websocket = WebSocket(
        {"type": "websocket", "path": "/phone-media", "headers": []}, receive, send
    )
    await incoming.put({"type": "websocket.connect"})
    await websocket.accept(subprotocol="media")
    failures = []
    transcripts = []

    async def finish(guard):
        raise AssertionError("A media-only test must never request call termination")

    config = AndroidConfig(
        selected_sim_slot=1, caller_number="+12025550199", allowed_destinations=["+12025550123"]
    )
    session = AndroidVoiceSession(
        websocket,
        call_id="call_test",
        packet=packet.model_copy(update={"language": "en"}),
        config=config,
        api_key="test-key",
        callbacks=VoiceCallbacks(
            lambda *args: transcripts.append(args), lambda: failures.append(True), finish
        ),
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
                        "channel_id": "call_test-media",
                        "format": "slin",
                        "optimal_frame_size": 320,
                        "ptime": 20,
                    }
                ),
            }
        )
        await asyncio.wait_for(session.ready.wait(), 15)
        assert not session.connected.is_set()
        assert not failures
        assert not transcripts
        assert any("START_MEDIA_BUFFERING" in str(message) for message in outgoing)
    finally:
        await incoming.put({"type": "websocket.disconnect", "code": 1000})
        try:
            await asyncio.wait_for(task, 10)
        except TimeoutError:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            raise
    assert not any(
        "FlowController.flow_control" in str(pending.get_coro())
        for pending in asyncio.all_tasks()
        if not pending.done()
    )
