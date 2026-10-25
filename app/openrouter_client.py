"""Keep Pipecat's OpenRouter behavior while applying the call's HTTP timeouts."""

from __future__ import annotations

from collections.abc import Mapping
from contextvars import ContextVar
from typing import Any

from openai import AsyncOpenAI, AsyncStream
from openai.types.chat import ChatCompletionChunk
from openai.types.completion_usage import CompletionUsage
from pipecat.frames.frames import Frame, LLMFullResponseStartFrame, LLMTextFrame
from pipecat.metrics.metrics import LLMTokenUsage
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.frame_processor import FrameDirection
from pipecat.services.openrouter.llm import OpenRouterLLMService

from app.provider_usage import UsageLedger


class OpenRouterVoiceLLMService(OpenRouterLLMService):
    generated_response_text = ""
    response_serial = 0

    def __init__(self, *, usage: UsageLedger | None = None, **kwargs: Any) -> None:
        self.usage = usage
        self._usage_request: ContextVar[int | None] = ContextVar("usage_request", default=None)
        super().__init__(**kwargs)

    async def get_chat_completions(self, context: LLMContext) -> AsyncStream[ChatCompletionChunk]:
        if self.usage:
            self._usage_request.set(self.usage.start_llm())
        return await super().get_chat_completions(context)

    def _token_usage(self, usage: CompletionUsage) -> LLMTokenUsage:
        request_id = self._usage_request.get()
        if self.usage and request_id is not None:
            self.usage.record_llm(request_id, usage.model_dump())
        return super()._token_usage(usage)

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
