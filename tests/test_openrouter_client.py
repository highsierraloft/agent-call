from __future__ import annotations

import pytest

pytest.importorskip("pipecat")

import httpx2
from openai import DefaultAsyncHttpxClient

from app.openrouter_client import OpenRouterVoiceLLMService


async def test_voice_service_uses_supplied_timeout_and_session_client():
    http = DefaultAsyncHttpxClient(timeout=httpx2.Timeout(10, connect=3))
    try:
        llm = OpenRouterVoiceLLMService(
            api_key="test-key",
            http_client=http,
            settings=OpenRouterVoiceLLMService.Settings(model="google/gemini-3.1-flash-lite"),
        )
        assert llm._client._client is http
        assert llm._client.timeout.read == 10
        assert llm._client.max_retries == 0
        assert str(llm._client.base_url) == "https://openrouter.ai/api/v1/"
    finally:
        await http.aclose()
