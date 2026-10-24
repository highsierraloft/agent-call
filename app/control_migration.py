"""Upgrade current configuration without rewriting historical revisions or plans."""

from __future__ import annotations

from app import control_legacy
from app.call_personalities import PERSONALITIES
from app.control_models import DEFAULT_CALLING_GUIDE, GlobalConfiguration
from app.db import Database
from app.voice_prompts import DEFAULT_CONVERSATION, DEFAULT_OPENING


async def migrate_contract(db: Database) -> None:
    current = await db.control_current("global")
    if not current or current["value"].get("prompt_contract_version") == 2:
        return
    old = current["value"]
    value = GlobalConfiguration.model_validate(old).model_dump(mode="json")
    for name, previous, replacement in [
        ("conversation", control_legacy.DEFAULT_CONVERSATION, DEFAULT_CONVERSATION),
        ("opening", control_legacy.DEFAULT_OPENING, DEFAULT_OPENING),
    ]:
        if value["prompts"][name] == previous:
            value["prompts"][name] = replacement
    changes = [("global", value, current["revision"])]
    guide = await db.control_current("guide")
    if guide and guide["value"]["text"] == control_legacy.DEFAULT_CALLING_GUIDE:
        changes.append(("guide", {"text": DEFAULT_CALLING_GUIDE}, guide["revision"]))
    for name, prompt in PERSONALITIES.items():
        profile = await db.control_current("profile:" + name)
        if profile and profile["value"]["prompt"] == control_legacy.PERSONALITIES[name]:
            if profile["value"]["prompt"] != prompt:
                changes.append(
                    (profile["entity"], {**profile["value"], "prompt": prompt}, profile["revision"])
                )
    await db.control_migrate(changes)
