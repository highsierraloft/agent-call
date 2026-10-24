"""Persist recipient opt-outs separately from the deployment's destination policy."""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.db.engine import _iso_now

if TYPE_CHECKING:
    from app.db.protocols import DatabaseAccess


class ContactsMixin:
    async def suppress_destination(self: DatabaseAccess, phone: str, call_id: str) -> None:
        await self.execute(
            "INSERT OR IGNORE INTO destination_suppressions(phone, call_id, created_at) VALUES (?, ?, ?)",
            (phone, call_id, _iso_now()),
        )

    async def is_destination_suppressed(self: DatabaseAccess, phone: str) -> bool:
        return (
            await self.fetch_one(
                "SELECT phone FROM destination_suppressions WHERE phone=?", (phone,)
            )
            is not None
        )

    async def call_recorded_opt_out(self: DatabaseAccess, call_id: str) -> bool:
        return (
            await self.fetch_one(
                "SELECT phone FROM destination_suppressions WHERE call_id=?", (call_id,)
            )
            is not None
        )
