"""Keep Pipecat's OpenRouter behavior while applying the call's HTTP timeouts."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from openai import AsyncOpenAI
from pipecat.frames.frames import Frame, LLMFullResponseStartFrame, LLMTextFrame
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.openrouter.llm import OpenRouterLLMService


class OpenRouterVoiceLLMService(OpenRouterLLMService):
    generated_response_text = ""
    response_serial = 0

    async def push_frame(
        self, frame: Frame, direction: FrameDirection = FrameDirection.DOWNSTREAM
    ) -> None:
        if direction == FrameDirection.DOWNSTREAM:
            if isinstance(frame, LLMFullResponseStartFrame):
                self.generated_response_text = ""
                self.response_serial += 1
            elif isinstance(frame, LLMTextFrame):
                self.generated_response_text += frame.text
        await super().push_frame(frame, direction)

    def create_client(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        organization: str | None = None,
        project: str | None = None,
        default_headers: Mapping[str, str] | None = None,
        **kwargs: Any,
    ) -> AsyncOpenAI:
        # Pipecat 1.13.0 creates its own HTTP client and ignores this supplied one.
        # Use the session-owned client so timeout and cleanup apply to real requests.
        client = kwargs.get("http_client")
        if client is None or not api_key or not base_url:
            raise ValueError("The voice model requires an explicit client and credentials")
        return AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            organization=organization,
            project=project,
            default_headers=default_headers,
            http_client=client,
            max_retries=0,
        )
