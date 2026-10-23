from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

pytest.importorskip("pipecat")

from pipecat.frames.frames import LLMRunFrame
from pipecat.processors.aggregators.llm_context import LLMContext

from app.android_voice import AndroidVoiceSession, ClosingWindow


@pytest.mark.parametrize("already_closing", [False, True])
async def test_timed_wrapup_waits_for_quiet_and_does_not_duplicate_closing(already_closing):
    session = AndroidVoiceSession.__new__(AndroidVoiceSession)
    session._max_call_seconds = 180
    session._started_at = time.monotonic() - 170
    session._idle = asyncio.Event()
    session._assistant_busy = False
    session._context = LLMContext([])
    session._worker = SimpleNamespace(queue_frame=AsyncMock())
    session.closing = ClosingWindow()
    if already_closing:
        session.closing.request("Talk soon. Bye.")
    task = asyncio.create_task(session._request_timed_wrapup())
    try:
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        session._worker.queue_frame.assert_not_awaited()
        assert not task.done()
        session._idle.set()
        await asyncio.wait_for(task, 1)
        if already_closing:
            session._worker.queue_frame.assert_not_awaited()
            assert not session._context.messages
        else:
            session._worker.queue_frame.assert_awaited_once()
            assert isinstance(session._worker.queue_frame.call_args.args[0], LLMRunFrame)
            assert session._assistant_busy and not session._idle.is_set()
            assert session._context.messages[-1]["role"] == "system"
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
