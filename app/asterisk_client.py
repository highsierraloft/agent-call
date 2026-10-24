"""Control owned Asterisk channels. Asterisk supplies SIP and audio transport."""

from __future__ import annotations

import base64
import json
import re
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx
from websockets.asyncio.client import connect


class AsteriskError(RuntimeError):
    """A sanitized failure; request bodies and authorization never enter its message."""


class AsteriskClient:
    def __init__(
        self,
        *,
        base_url: str,
        username: str,
        password: str,
        application: str = "agent-call",
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        parsed = urlsplit(base_url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.query
        ):
            raise ValueError("Invalid Asterisk service URL")
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", application):
            raise ValueError("Invalid Asterisk application name")
        self.application = application
        self.base_url = base_url.rstrip("/")
        self._authorization = (
            "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()
        )
        self._http = httpx.AsyncClient(
            base_url=self.base_url + "/",
            auth=httpx.BasicAuth(username, password),
            timeout=httpx.Timeout(8, connect=3),
            follow_redirects=False,
            transport=transport,
        )

    async def close(self) -> None:
        await self._http.aclose()

    @staticmethod
    def resource_ids(call_id: str) -> tuple[str, str, str]:
        if not re.fullmatch(r"call_[A-Za-z0-9_-]{1,128}", call_id):
            raise ValueError("Invalid call identifier")
        return call_id + "-cell", call_id + "-media", call_id + "-bridge"

    async def request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        missing_ok: bool = False,
    ) -> httpx.Response:
        try:
            response = await self._http.request(method, path, json=body)
        except httpx.RequestError as exc:
            raise AsteriskError("Asterisk request failed; remote outcome may be unknown") from exc
        if missing_ok and response.status_code == 404:
            return response
        if not 200 <= response.status_code < 300:
            raise AsteriskError(f"Asterisk rejected the operation: HTTP {response.status_code}")
        return response

    async def healthy(self) -> bool:
        try:
            await self.request("GET", "asterisk/info")
            return True
        except AsteriskError:
            return False

    async def gateway_registered(self) -> bool:
        response = await self.request("GET", "endpoints/PJSIP/android", missing_ok=True)
        return response.status_code == 200 and response.json().get("state") == "online"

    async def create_media(self, call_id: str, max_seconds: int) -> None:
        _, media, bridge = self.resource_ids(call_id)
        self._validate_duration(max_seconds)
        await self.request("POST", "bridges/" + bridge, body={"type": "mixing,proxy_media"})
        await self.request(
            "POST",
            "channels/externalMedia",
            body={
                "channelId": media,
                "app": self.application,
                "external_host": "agent-call",
                "transport": "websocket",
                "encapsulation": "none",
                "connection_type": "client",
                "format": "slin",
                "direction": "both",
                "transport_data": "f(json)",
                "variables": {"AGENT_CALL_ID": call_id, "TIMEOUT(absolute)": str(max_seconds)},
            },
        )

    async def bridge_media(self, call_id: str) -> None:
        _, media, bridge = self.resource_ids(call_id)
        await self.request("POST", "bridges/" + bridge + "/addChannel", body={"channel": media})

    async def start_recording(self, call_id: str, max_seconds: int) -> None:
        _, _, bridge = self.resource_ids(call_id)
        self._validate_duration(max_seconds)
        await self.request(
            "POST",
            "bridges/" + bridge + "/record",
            body={
                "name": call_id,
                "format": "wav",
                "maxDurationSeconds": max_seconds,
                "maxSilenceSeconds": 0,
                "ifExists": "fail",
                "beep": False,
                "terminateOn": "none",
            },
        )

    async def stop_recording(self, call_id: str) -> None:
        self.resource_ids(call_id)
        await self.request("POST", f"recordings/live/{call_id}/stop", missing_ok=True)

    async def recording_bytes(self, call_id: str) -> bytes | None:
        self.resource_ids(call_id)
        try:
            async with self._http.stream("GET", f"recordings/stored/{call_id}/file") as response:
                if response.status_code == 404:
                    return None
                if response.status_code != 200:
                    raise AsteriskError("The stored recording is unavailable")
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > 20 * 1024 * 1024:
                        raise AsteriskError("The stored recording exceeds the size limit")
                return bytes(data)
        except httpx.RequestError as exc:
            raise AsteriskError("The stored recording download failed") from exc

    async def delete_recording(self, call_id: str) -> None:
        self.resource_ids(call_id)
        await self.request("DELETE", f"recordings/stored/{call_id}", missing_ok=True)

    @staticmethod
    def _validate_duration(seconds: int) -> None:
        if not 1 <= seconds <= 600:
            raise ValueError("Call duration must be between 1 and 600 seconds")

    async def originate(self, call_id: str, number: str, max_seconds: int) -> None:
        cell, _, _ = self.resource_ids(call_id)
        if not re.fullmatch(r"\+[1-9][0-9]{7,14}", number):
            raise ValueError("Destination must be a complete international number")
        self._validate_duration(max_seconds)
        await self.request(
            "POST",
            "channels/" + cell,
            body={
                "endpoint": f"PJSIP/{number}@android",
                "app": self.application,
                "appArgs": "cell," + call_id,
                "timeout": min(45, max_seconds),
                "formats": "alaw,ulaw",
                "variables": {"AGENT_CALL_ID": call_id, "TIMEOUT(absolute)": str(max_seconds)},
            },
        )

    async def bridge_answered_call(self, call_id: str) -> None:
        cell, _, bridge = self.resource_ids(call_id)
        response = await self.request("GET", "channels/" + cell)
        if response.json().get("state") != "Up":
            raise AsteriskError("The telephone channel has not answered")
        await self.request("POST", "bridges/" + bridge + "/addChannel", body={"channel": cell})

    async def hangup(self, call_id: str) -> bool:
        cell, media, bridge = self.resource_ids(call_id)
        succeeded = True
        for path in ["channels/" + cell, "channels/" + media, "bridges/" + bridge]:
            try:
                await self.request("DELETE", path, missing_ok=True)
            except AsteriskError:
                succeeded = False
        return succeeded

    async def media_absent(self, call_id: str) -> bool:
        cell, media, _ = self.resource_ids(call_id)
        for identifier in [cell, media]:
            response = await self.request("GET", "channels/" + identifier, missing_ok=True)
            if response.status_code != 404:
                return False
        return True

    async def events(self) -> AsyncIterator[dict[str, Any]]:
        parsed = urlsplit(self.base_url)
        url = urlunsplit(
            (
                "wss" if parsed.scheme == "https" else "ws",
                parsed.netloc,
                parsed.path.rstrip("/") + "/events",
                urlencode({"app": self.application}),
                "",
            )
        )
        async with connect(
            url,
            additional_headers={"Authorization": self._authorization},
            open_timeout=5,
            ping_interval=15,
            ping_timeout=15,
            max_size=262144,
        ) as websocket:
            yield {"type": "ConnectionReady"}
            async for raw in websocket:
                event = json.loads(raw)
                if isinstance(event, dict):
                    yield event
