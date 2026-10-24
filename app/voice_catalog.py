"""Read provider catalogs without sending provider credentials to the browser."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import httpx

from app.android_config import AndroidConfig


class VoiceCatalog:
    def __init__(self, config: AndroidConfig, openrouter_key: str) -> None:
        self.config, self._key = config, openrouter_key
        self._cached: dict[str, Any] | None = None
        self._loaded = 0.0
        self._lock = asyncio.Lock()

    @staticmethod
    async def _get(
        client: httpx.AsyncClient,
        url: str,
        headers: dict[str, str],
        params: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        async with client.stream("GET", url, headers=headers, params=params) as response:
            response.raise_for_status()
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > 4 * 1024 * 1024:
                    raise ValueError("Catalog response is too large")
        parsed = json.loads(data)
        if not isinstance(parsed, dict):
            raise ValueError("Invalid catalog")
        return parsed

    async def get(self) -> dict[str, Any]:
        async with self._lock:
            if self._cached and time.monotonic() - self._loaded < 3600:
                return self._cached
            result: dict[str, Any] = {"voices": [], "models": [], "errors": []}
            async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
                try:
                    headers = {
                        "Authorization": "Basic " + self.config.inworld_key().get_secret_value()
                    }
                    cursor = ""
                    seen = set()
                    voices = {}
                    for _ in range(10):
                        page = await self._get(
                            client,
                            "https://api.inworld.ai/voices/v1/voices",
                            headers,
                            {"pageSize": "200", "pageToken": cursor},
                        )
                        for voice in page.get("voices", []):
                            if not isinstance(voice, dict):
                                continue
                            if isinstance(voice.get("voiceId"), str):
                                voices[voice["voiceId"]] = {
                                    "id": voice["voiceId"],
                                    "name": str(voice.get("displayName") or voice["voiceId"]),
                                    "description": str(voice.get("description", ""))[:500],
                                    "language": voice.get("languageCode")
                                    or voice.get("langCode")
                                    or "",
                                }
                        cursor = page.get("nextPageToken") or ""
                        if not cursor:
                            break
                        if cursor in seen:
                            raise ValueError("Repeated catalog cursor")
                        seen.add(cursor)
                    result["voices"] = sorted(voices.values(), key=lambda v: v["name"].casefold())
                except (httpx.HTTPError, ValueError, KeyError, TypeError):
                    result["errors"].append(
                        "The Inworld voice list is unavailable. You can still enter a known voice ID."
                    )
                try:
                    data = await self._get(
                        client,
                        "https://openrouter.ai/api/v1/models",
                        {"Authorization": "Bearer " + self._key},
                        {
                            "supported_parameters": "tools,tool_choice,temperature",
                            "output_modalities": "text",
                        },
                    )
                    result["models"] = [
                        {"id": model["id"], "name": model.get("name") or model["id"]}
                        for model in data.get("data", [])
                        if isinstance(model, dict)
                        and isinstance(model.get("id"), str)
                        and {"tools", "tool_choice", "temperature"}
                        <= set(model.get("supported_parameters", []))
                    ]
                except (httpx.HTTPError, ValueError, KeyError, TypeError):
                    result["errors"].append(
                        "The OpenRouter model list is unavailable. Your selected model has not changed."
                    )
            if not result["errors"]:
                self._cached = result
                self._loaded = time.monotonic()
            return result
