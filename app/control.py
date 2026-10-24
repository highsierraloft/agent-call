"""Application services for the private control panel and Hermes setup."""

from __future__ import annotations

import asyncio
import base64
import json
import re
from datetime import UTC, datetime
from datetime import time as day_time
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

from app.android_config import AndroidConfig
from app.call_personalities import PERSONALITIES
from app.control_models import (
    DEFAULT_CALLING_GUIDE,
    CallingGuide,
    GlobalConfiguration,
    ProfileConfiguration,
    VoiceSettings,
)
from app.db import Database
from app.errors import CallRefusal
from app.models import ContextPacket
from app.voice_catalog import VoiceCatalog
from app.voice_prompts import voice_instructions

if TYPE_CHECKING:
    from app.android_calls import AndroidCallService


class ControlPlane:
    def __init__(self, service: AndroidCallService, db: Database) -> None:
        from app.playground import Playground

        self.service, self.db = service, db
        self._seed_lock = asyncio.Lock()
        self._seeded = False
        self.practice = Playground(self)
        self.catalog = VoiceCatalog(service.config, service._api_key)

    async def initialize(self) -> None:
        async with self._seed_lock:
            if self._seeded:
                return
            seeded_voice = {
                name: getattr(self.service.config, name) for name in VoiceSettings.model_fields
            }
            seeded_voice["default_call_seconds"] = min(
                seeded_voice["default_call_seconds"], seeded_voice["max_call_seconds"]
            )
            voice = VoiceSettings.model_validate(seeded_voice)
            await self.db.control_seed(
                "global", GlobalConfiguration(voice=voice).model_dump(mode="json")
            )
            await self.db.control_seed("guide", {"text": DEFAULT_CALLING_GUIDE})
            for name, prompt in PERSONALITIES.items():
                value = ProfileConfiguration.model_validate(
                    {
                        "name": name.title(),
                        "personality": name,
                        "prompt": prompt,
                        "description": "Built-in starting personality",
                    }
                )
                await self.db.control_seed("profile:" + name, value.model_dump(mode="json"))
            self._seeded = True

    async def current(self, entity: str) -> dict[str, Any]:
        await self.initialize()
        value = await self.db.control_current(entity)
        if value is None:
            raise LookupError("Configuration not found")
        return value

    async def profiles(self, *, archived: bool = False) -> list[dict[str, Any]]:
        await self.initialize()
        return [
            row
            for row in await self.db.control_entities()
            if row["entity"].startswith("profile:") and (archived or not row["value"]["archived"])
        ]

    async def save(
        self, entity: str, value: dict[str, Any], expected: int, actor: str
    ) -> dict[str, Any]:
        await self.initialize()
        if entity == "global":
            valid = GlobalConfiguration.model_validate(value)
            for profile in await self.profiles():
                VoiceSettings.model_validate(
                    {**valid.voice.model_dump(), **profile["value"]["voice_overrides"]}
                )
            payload = valid.model_dump(mode="json")
        elif entity == "guide":
            payload = CallingGuide.model_validate(value).model_dump(mode="json")
        elif re.fullmatch(r"profile:[a-z0-9][a-z0-9_-]{0,63}", entity):
            profile_value = ProfileConfiguration.model_validate(value)
            global_value = (await self.current("global"))["value"]
            VoiceSettings.model_validate({**global_value["voice"], **profile_value.voice_overrides})
            if entity.removeprefix("profile:") in PERSONALITIES and profile_value.archived:
                raise ValueError(
                    "Built-in profiles cannot be archived because older clients use their names"
                )
            payload = profile_value.model_dump(mode="json")
        else:
            raise ValueError("Unknown configuration type")
        await self.db.control_save(entity, payload, expected, actor)
        return await self.current(entity)

    async def history(self, entity: str) -> list[dict[str, Any]]:
        await self.current(entity)
        return await self.db.control_history(entity)

    async def resolve(
        self, packet: ContextPacket, *, overrides: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        global_record = await self.current("global")
        profile_record = await self.current("profile:" + (packet.profile_id or packet.personality))
        global_value = GlobalConfiguration.model_validate(
            (overrides or {}).get("global", global_record["value"])
        )
        profile = ProfileConfiguration.model_validate(
            (overrides or {}).get("profile", profile_record["value"])
        )
        if profile.archived:
            raise ValueError("This profile is archived. Select another profile.")
        voice = VoiceSettings.model_validate(
            {**global_value.voice.model_dump(), **profile.voice_overrides}
        )
        if packet.language is not None and packet.language not in voice.conversation_languages:
            raise CallRefusal(
                "language_required", "The initial language must be enabled in this profile"
            )
        return {
            "profile_id": profile_record["entity"].removeprefix("profile:"),
            "profile_revision": profile_record["revision"],
            "configuration_revision": global_record["revision"],
            "profile_name": profile.name,
            "personality": profile.personality,
            "personality_prompt": profile.prompt,
            "prompts": global_value.prompts.model_dump(),
            "voice": voice.model_dump(mode="json"),
            "unsaved": bool(overrides),
        }

    def normalize_packet(self, packet: ContextPacket, snapshot: dict[str, Any]) -> ContextPacket:
        config = self.runtime_config(snapshot)
        return packet.model_copy(
            update={
                "personality": snapshot["personality"],
                "profile_id": snapshot["profile_id"],
                "max_duration_seconds": config.call_duration(packet.max_duration_seconds),
            }
        )

    @staticmethod
    def reference(snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
        if not snapshot:
            return None
        return {
            key: snapshot[key]
            for key in ["profile_id", "profile_revision", "configuration_revision", "profile_name"]
        }

    def runtime_config(self, snapshot: dict[str, Any] | None) -> AndroidConfig:
        if not snapshot:
            return self.service.config
        voice = VoiceSettings.model_validate(snapshot["voice"])
        return AndroidConfig.model_validate(
            {**self.service.config.model_dump(), **voice.model_dump()}
        )

    @staticmethod
    def prompt(packet: ContextPacket, snapshot: dict[str, Any]) -> str:
        if isinstance(snapshot.get("effective_prompt"), str):
            return str(snapshot["effective_prompt"])
        return voice_instructions(
            packet,
            conversation_languages=snapshot["voice"]["conversation_languages"],
            prompts=snapshot["prompts"],
            personality_prompt=snapshot["personality_prompt"],
            intention_prompts=snapshot["prompts"]["intentions"],
        )

    async def setup(self, *, from_mcp: bool = False) -> dict[str, Any]:
        if from_mcp:
            await self.db.control_seen("hermes_setup")
        global_record, guide = await self.current("global"), await self.current("guide")
        return {
            "guide": guide["value"]["text"],
            "guide_revision": guide["revision"],
            "owner": {
                "display_name": self.service.settings.owner_display_name,
                "timezone": self.access_timezone(),
            },
            "profiles": [
                {
                    "id": row["entity"].removeprefix("profile:"),
                    "revision": row["revision"],
                    "name": row["value"]["name"],
                    "description": row["value"]["description"],
                    "personality": row["value"]["personality"],
                }
                for row in await self.profiles()
            ],
            "defaults": global_record["value"]["voice"],
            "destination_policy": "any_valid_international_number",
            "source_line": "Spanish DIGI",
            "owner_numbers": "Omit callback_number and owner_phone; the server resolves them.",
        }

    def access_timezone(self) -> str:
        from app.control_auth import read_access

        access = read_access(self.service.config)
        return access.timezone if access else "UTC"

    async def status(self) -> dict[str, Any]:
        phone = self.service.phone.read()
        try:
            registered = await self.service.asterisk.gateway_registered()
        except Exception:
            registered = False
        active = await self.db.list_nonterminal_calls()
        return {
            "ready": self.service.supervision_ready()
            and not self.service.phone.admission_problem()
            and registered,
            "sip_registered": registered,
            "source_line": "Spanish DIGI",
            "phone": {
                key: (phone or {}).get(key) for key in ["phase", "control_ready", "call_ready"]
            },
            "active_call": active[0]["call_id"] if active else None,
            "practice_active": self.practice.active is not None,
            "last_hermes_request": await self.db.fetch_one(
                "SELECT observed_at FROM control_activity WHERE name='hermes_setup'"
            ),
            "measured_at": datetime.now(UTC).isoformat(),
        }

    async def calls(
        self,
        *,
        query: str = "",
        state: str = "",
        language: str = "",
        profile: str = "",
        start: str = "",
        end: str = "",
        cursor: str = "",
        limit: int = 40,
    ) -> dict[str, Any]:
        clauses, values = ["1=1"], []
        if query:
            needle = (
                "%"
                + query.casefold().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                + "%"
            )
            clauses.append(
                "(casefold(p.context_json) LIKE ? ESCAPE '\\' OR EXISTS "
                "(SELECT 1 FROM transcripts t WHERE t.call_id=c.call_id AND casefold(t.text) LIKE ? ESCAPE '\\'))"
            )
            values.extend([needle, needle])
        for expr, value in [
            ("c.state", state),
            ("json_extract(p.context_json,'$.language')", language),
            (
                "COALESCE(json_extract(pc.snapshot_json,'$.profile_id'),json_extract(p.context_json,'$.personality'))",
                profile,
            ),
        ]:
            if value:
                clauses.append(expr + "=?")
                values.append(value)
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", start):
            start = (
                datetime.combine(
                    datetime.fromisoformat(start).date(),
                    day_time.min,
                    ZoneInfo(self.access_timezone()),
                )
                .astimezone(UTC)
                .isoformat()
            )
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", end):
            end = (
                datetime.combine(
                    datetime.fromisoformat(end).date(),
                    day_time.max,
                    ZoneInfo(self.access_timezone()),
                )
                .astimezone(UTC)
                .isoformat()
            )
        for op, value in [(">=", start), ("<=", end)]:
            if value:
                clauses.append("c.created_at" + op + "?")
                values.append(value)
        if cursor:
            try:
                stamp, call_id = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
                if not isinstance(stamp, str) or not isinstance(call_id, str):
                    raise ValueError("Invalid cursor")
            except (ValueError, TypeError, UnicodeError) as exc:
                raise ValueError("Invalid call history cursor") from exc
            clauses.append("(c.created_at<? OR (c.created_at=? AND c.call_id<?))")
            values.extend([stamp, stamp, call_id])
        sql = "SELECT c.call_id,c.state,c.created_at,c.answered_at,c.ended_at,c.duration_seconds,c.termination_reason,p.context_json,pc.snapshot_json "
        sql += (
            "FROM calls c JOIN plans p ON p.plan_id=c.plan_id LEFT JOIN plan_configurations pc ON pc.plan_id=p.plan_id WHERE "
            + " AND ".join(clauses)
        )
        rows = await self.db.fetch_all(
            sql + " ORDER BY c.created_at DESC,c.call_id DESC LIMIT ?", (*values, limit + 1)
        )
        result = []
        for row in rows[:limit]:
            context = json.loads(row.pop("context_json"))
            row.pop("context", None)
            snapshot = json.loads(row.pop("snapshot_json") or "{}")
            result.append(
                {
                    **row,
                    "target": context["target"],
                    "objective": context["objective"],
                    "language": context.get("language"),
                    "profile_id": snapshot.get("profile_id") or context.get("personality"),
                    "personality": context.get("personality"),
                }
            )
        return {
            "calls": result,
            "next_cursor": base64.urlsafe_b64encode(
                json.dumps([rows[limit - 1]["created_at"], rows[limit - 1]["call_id"]]).encode()
            ).decode()
            if len(rows) > limit
            else None,
        }

    async def detail(self, call_id: str, after: int = 0) -> dict[str, Any]:
        row = await self.db.get_call(call_id)
        if row is None:
            raise LookupError("Call not found")
        plan = await self.db.get_plan_record(row["plan_id"])
        result = await self.service.get_result(call_id, after_sequence=after)
        snapshot = await self.db.control_plan(row["plan_id"])
        metrics = await self.db.fetch_all(
            "SELECT data_json,created_at FROM voice_measurements WHERE call_id=? ORDER BY id",
            (call_id,),
        )
        return {
            **result,
            "brief": plan.context.model_dump(mode="json") if plan else None,
            "configuration": snapshot,
            "prompt": self.prompt(plan.context, snapshot) if plan and snapshot else None,
            "annotation": await self.db.control_annotation(call_id),
            "timing": {
                key: row.get(key)
                for key in [
                    "created_at",
                    "answered_at",
                    "ended_at",
                    "duration_seconds",
                    "termination_reason",
                ]
            },
            "latency": [
                {**json.loads(m["data_json"]), "created_at": m["created_at"]} for m in metrics
            ],
        }

    async def annotate(self, call_id: str, note: str, tags: list[str]) -> None:
        if not await self.db.get_call(call_id):
            raise LookupError("Call not found")
        await self.db.control_annotate(call_id, note, tags)
