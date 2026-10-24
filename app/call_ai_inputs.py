"""The call model's application-owned inputs, without authentication material."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from app.android_config import AndroidConfig
    from app.models import ContextPacket

Mode = Literal["voice", "text"]
CLOSING_RESERVE_SECONDS = 15
FAREWELL_REPLY_SECONDS = 3
CONNECTION_EVENT = "Internal connection event, not recipient speech: the call is connected. Give the approved greeting now."
TIMER_PREFIX = (
    "Runtime notice: about {remaining_seconds} seconds remain in this call's time budget. "
)
TIMER_CONTINUE = "Continue the approved conversation. Do not announce this timer."
TIMER_CLOSING = (
    "The time limit is near. Answer any last point briefly, wrap up warmly without "
    "a new topic or question, then call finish_call with a brief farewell. "
    "The tool speaks the farewell; do not say it separately."
)


def time_notice(remaining_seconds: int, *, closing: bool = False) -> str:
    return TIMER_PREFIX.format(remaining_seconds=remaining_seconds) + (
        TIMER_CLOSING if closing or remaining_seconds <= CLOSING_RESERVE_SECONDS else TIMER_CONTINUE
    )


def model_tools(mode: Mode = "voice") -> list[dict[str, Any]]:
    function: dict[str, Any] = {
        "name": "finish_call",
        "description": "End the call ONLY when the recipient explicitly asks to finish, the approved task is complete, or the runtime closing notice arrives. Never use this tool for ordinary conversational replies or mentions of later plans. It speaks your farewell, then hangs up after playback and a reply window. Do not say the farewell separately.",
        "parameters": {
            "type": "object",
            "properties": {
                "farewell": {
                    "type": "string",
                    "description": "A brief farewell in the same language as the latest recipient turn. The tool speaks it; do not output separate closing text.",
                },
                "do_not_call": {
                    "type": "boolean",
                    "description": "Set true only when the recipient requests no further sales calls. This saves an opt-out for this recipient before closing; it does not update an external customer system.",
                },
            },
            "required": ["farewell"],
        },
    }
    if mode == "text":
        function["description"] = "Finish this practice conversation."
        function["parameters"]["properties"] = {
            "farewell": {"type": "string"},
            "do_not_call": {"type": "boolean"},
        }
    return [{"type": "function", "function": function}]


def model_options(config: AndroidConfig, mode: Mode = "voice") -> dict[str, Any]:
    options: dict[str, Any] = {
        "model": config.dialogue_model,
        "max_tokens": config.dialogue_max_tokens,
    }
    supported = config.dialogue_supported_parameters
    if supported is None:
        from app.model_capabilities import reviewed_model

        model = reviewed_model(config.dialogue_model)
        supported = model["supported_parameters"] if model else None
    if config.dialogue_temperature is not None and (
        supported is None or "temperature" in supported
    ):
        options["temperature"] = config.dialogue_temperature
    if config.reasoning_effort is not None and (supported is None or "reasoning" in supported):
        options["reasoning"] = {"effort": config.reasoning_effort}
    provider: dict[str, Any] = {}
    if mode == "voice":
        options.update(stream=True, stream_options={"include_usage": True})
        provider.update(sort="latency", require_parameters=True)
    if config.dialogue_provider:
        provider.update(
            only=[config.dialogue_provider, *config.dialogue_fallback_providers],
            allow_fallbacks=bool(config.dialogue_fallback_providers),
            require_parameters=True,
        )
        if mode == "voice" and config.dialogue_fallback_providers:
            provider["order"] = [config.dialogue_provider]
    if provider:
        options["provider"] = provider
    return options


def initial_messages(prompt: str, mode: Mode = "voice") -> list[Any]:
    messages = [{"role": "system", "content": prompt}]
    if mode == "voice":
        messages.append({"role": "user", "content": CONNECTION_EVENT})
    return messages


def describe_inputs(
    packet: ContextPacket, snapshot: dict[str, Any], config: AndroidConfig, mode: Mode = "voice"
) -> dict[str, Any]:
    from app.voice_prompts import voice_prompt_sections

    sections = voice_prompt_sections(
        packet,
        conversation_languages=list(config.conversation_languages),
        prompts=snapshot["prompts"],
        personality_prompt=snapshot["personality_prompt"],
    )
    prompt = snapshot["effective_prompt"]
    options = model_options(config, mode)
    messages = initial_messages(prompt, mode)
    if mode == "voice":
        messages[0]["content"] += "\n" + time_notice(
            config.call_duration(packet.max_duration_seconds)
        )
    else:
        messages.append({"role": "user", "content": "<your next practice message>"})
    return {
        "version": 1,
        "mode": mode,
        "system_prompt": prompt,
        "prompt_sections": sections,
        "model_options": options,
        "tools": model_tools(mode),
        "initial_request_example": {**options, "messages": messages, "tools": model_tools(mode)},
        "runtime_messages": {
            "connection_event": CONNECTION_EVENT if mode == "voice" else None,
            "continuing_timer_template": TIMER_PREFIX + TIMER_CONTINUE if mode == "voice" else None,
            "closing_timer_template": TIMER_PREFIX + TIMER_CLOSING if mode == "voice" else None,
            "timer_placement": "Appended to the first system message; remaining time changes each turn."
            if mode == "voice"
            else None,
            "closing_reserve_seconds": CLOSING_RESERVE_SECONDS if mode == "voice" else None,
            "farewell_reply_window_seconds": FAREWELL_REPLY_SECONDS if mode == "voice" else None,
            "tool_choice": "auto; forced finish_call for a detected sales opt-out"
            if mode == "voice"
            else "Provider default (not sent)",
            "history": "Recipient transcripts, heard assistant speech, and tool calls/results. Unheard interrupted speech is excluded."
            if mode == "voice"
            else "The latest 40 practice messages, followed by the new message.",
        },
        "speech_settings": {
            "enabled": mode == "voice",
            "transcription_provider": config.stt_transport,
            "transcription_model": config.soniox_model
            if config.stt_transport == "soniox"
            else "flux-general-multi"
            if config.stt_transport == "deepgram_flux"
            else config.stt_model,
            "language_hints": config.conversation_languages,
            "soniox_turn_detection": config.soniox_turn_detection,
            "soniox_max_endpoint_delay_ms": config.soniox_endpoint_delay_ms
            if config.soniox_turn_detection == "semantic"
            else None,
            "soniox_endpoint_latency_level": config.soniox_endpoint_latency_level
            if config.soniox_turn_detection == "semantic"
            else None,
            "soniox_endpoint_sensitivity": config.soniox_endpoint_sensitivity
            if config.soniox_turn_detection == "semantic"
            else None,
            "speech_provider": config.tts_transport,
            "speech_model": config.inworld_model
            if config.tts_transport == "inworld"
            else config.tts_model,
            "voice": config.inworld_voice if config.tts_transport == "inworld" else config.voice,
            "delivery_mode": config.inworld_delivery_mode
            if config.inworld_model == "inworld-tts-2"
            else None,
            "inworld_language": "Automatic",
            "inworld_encoding": "PCM",
            "inworld_sample_rate": 8000,
            "inworld_auto_mode": True,
            "inworld_timestamp_strategy": "ASYNC",
            "input_sample_rates": {"telephone": 8000, "browser": 16000},
            "output_sample_rates": {"telephone": 8000, "browser": 24000},
            "post_processing": "Before speech, explicit English or Spanish claims to be the represented owner are corrected to the owner's AI assistant. This is a text rule, not an extra model.",
        },
        "limits": {
            "call_budget_seconds": config.call_duration(packet.max_duration_seconds),
            "model_timeout_seconds": 10 if mode == "voice" else 30,
            "model_connect_timeout_seconds": 3 if mode == "voice" else 30,
            "model_http_retries": 0,
        },
        "scope": "Application-owned inputs. Authentication headers, provider credentials, and undisclosed provider-side instructions are not included. The initial request is an example; the timer and history change during a call.",
    }


class ModelRequestTrace:
    """Keep only the latest serialized request body; never capture headers or credentials."""

    def __init__(self) -> None:
        self._latest: tuple[str, int, bytes | None] | None = None

    async def capture(self, request: Any) -> None:
        if request.url.host != "openrouter.ai" or request.url.path != "/api/v1/chat/completions":
            return
        body = request.content
        if not isinstance(body, bytes):
            return
        self._latest = (
            datetime.now(UTC).isoformat(),
            len(body),
            body if len(body) <= 4 * 1024 * 1024 else None,
        )

    def view(self) -> dict[str, Any] | None:
        latest = self._latest
        if latest is None:
            return None
        recorded_at, size, body = latest
        return {
            "recorded_at": recorded_at,
            "bytes": size,
            "body": json.loads(body) if body else None,
            "omitted": body is None,
            "scope": "Latest outgoing OpenRouter request body. Captured before sending; this does not prove provider receipt or a successful reply. Headers and credentials are excluded.",
        }
