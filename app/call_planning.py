"""Provider-independent preparation and atomic admission for the existing MCP contract."""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.db import ClaimOutcome, Database, DeploymentLockedError
from app.errors import CallRefusal, ErrorCode
from app.models import ContextPacket, PreparePhoneCallInput, PreparePhoneCallOutput
from app.policy import validate_context
from app.settings import Settings


def confirmation_summary(packet: ContextPacket) -> str:
    target = packet.target
    return (
        f"Call {target.name}"
        f"{f' at {target.organization}' if target.organization else ''} "
        f"on {target.phone} to: {packet.objective}. "
        f"Intention: {packet.intention}; personality: {packet.personality}. "
        + (
            f"Duration budget: {packet.max_duration_seconds} seconds. "
            if packet.max_duration_seconds
            else ""
        )
        + "The assistant may only make the listed allowed commitments and will follow all "
        "hard constraints."
    )


async def prepare_call(
    settings: Settings, db: Database, request: PreparePhoneCallInput
) -> PreparePhoneCallOutput:
    missing: list[str] = []
    if not request.requested_by_owner:
        missing.append("requested_by_owner")
    if not request.authority_basis:
        missing.append("authority_basis")
    if settings.call_backend == "android_openrouter" and request.context.language is None:
        missing.append("language")
    if request.context.intention == "sales":
        for name in ["name", "description", "offer", "desired_next_step", "contact_permission"]:
            if request.context.business is None or not getattr(request.context.business, name):
                missing.append("business." + name)
    errors = validate_context(request.context, settings)
    if errors:
        first = errors[0]
        raise CallRefusal(first.code, first.message, details=first.details)
    summary = confirmation_summary(request.context)
    if missing:
        return PreparePhoneCallOutput(confirmation_summary=summary, missing_fields=missing)
    plan_id = f"plan_{secrets.token_urlsafe(18)}"
    expires_at = datetime.now(UTC) + timedelta(seconds=settings.plan_ttl_seconds)
    await db.create_plan(
        plan_id, request.context.model_dump(mode="json"), request.authority_basis, expires_at
    )
    return PreparePhoneCallOutput(
        plan_id=plan_id, confirmation_summary=summary, missing_fields=[], expires_at=expires_at
    )


@dataclass(frozen=True, slots=True)
class ApprovedCall:
    call_id: str
    plan_id: str
    conference_name: str
    context: ContextPacket


async def claim_approved_call(
    db: Database,
    *,
    plan_id: str,
    explicit_confirmation: bool,
    confirmation_text: str,
) -> ApprovedCall:
    if not explicit_confirmation or not confirmation_text.strip():
        raise CallRefusal(ErrorCode.CONFIRMATION_REQUIRED)
    plan = await db.get_plan_record(plan_id)
    if plan is None:
        raise CallRefusal(ErrorCode.PLAN_NOT_FOUND)
    if confirmation_text.strip() != confirmation_summary(plan.context):
        raise CallRefusal(ErrorCode.CONFIRMATION_MISMATCH)
    call_id = f"call_{secrets.token_urlsafe(18)}"
    conference_name = f"agent-{secrets.token_hex(16)}"
    try:
        claimed = await db.claim_plan_and_create_call(
            plan_id=plan_id,
            call_id=call_id,
            conference_name=conference_name,
            confirmation_text=confirmation_text,
        )
    except DeploymentLockedError as exc:
        raise CallRefusal(ErrorCode.DEPLOYMENT_IN_PROGRESS) from exc
    if not claimed:
        if claimed.outcome is ClaimOutcome.BUSY:
            raise CallRefusal(ErrorCode.CALL_BUSY)
        if claimed.outcome is ClaimOutcome.CALL_ENDING:
            raise CallRefusal(ErrorCode.CALL_ENDING)
        raise CallRefusal(ErrorCode.PLAN_UNAVAILABLE)
    return ApprovedCall(call_id, plan_id, conference_name, plan.context)
