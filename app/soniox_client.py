"""Keep Pipecat's Soniox parser while handling error-only provider messages."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from pipecat.services.soniox.stt import SonioxSTTService


class _SonioxMessages:
    def __init__(self, websocket: Any) -> None:
        self.websocket = websocket

    async def __aiter__(self) -> AsyncIterator[str | bytes]:
        async for message in self.websocket:
            try:
                data = json.loads(message)
            except (ValueError, TypeError):
                yield message
                continue
            # Pipecat 1.13 reads tokens before checking Soniox's error fields.
            # Error-only responses must reach its normal pipeline error handling.
            if (
                isinstance(data, dict)
                and "tokens" not in data
                and (data.get("error_code") or data.get("error_message") or data.get("finished"))
            ):
                data["tokens"] = []
                message = json.dumps(data)
            yield message


class SonioxVoiceSTTService(SonioxSTTService):
    def _get_websocket(self) -> _SonioxMessages:
        return _SonioxMessages(super()._get_websocket())  # type: ignore[no-untyped-call]
