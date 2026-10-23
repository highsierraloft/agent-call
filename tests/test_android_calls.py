from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

pytest.importorskip("pipecat")

from app.android_calls import AndroidCallService
from app.android_config import AndroidConfig
from app.asterisk_client import AsteriskClient, AsteriskError
from app.errors import CallRefusal
from app.models import CallState, PreparePhoneCallInput


class FakePhone:
    problem = None
    idle = False
    fresh = True

    def admission_problem(self):
        return self.problem

    def read(self):
        return {"control_ready": True} if self.fresh else None

    def carrier_idle_after(self, requested_at):
        return self.idle


class FakeAsterisk:
    resource_ids = staticmethod(AsteriskClient.resource_ids)

    def __init__(self):
        self.registered = True
        self.queue = asyncio.Queue()
        self.media = []
        self.dials = []
        self.bridged = []
        self.ended = []
        self.absent = True
        self.originate_error = False
        self.closed = False

    async def gateway_registered(self):
        return self.registered

    async def create_media(self, call_id, seconds):
        self.media.append(call_id)
        await self.queue.put(
            {"type": "StasisStart", "channel": {"id": call_id + "-media", "state": "Up"}}
        )

    async def bridge_media(self, call_id):
        assert call_id in self.media

    async def originate(self, call_id, number, seconds):
        self.dials.append((call_id, number, seconds))
        if self.originate_error:
            raise AsteriskError("unknown remote outcome")

    async def bridge_answered_call(self, call_id):
        self.bridged.append(call_id)

    async def hangup(self, call_id):
        self.ended.append(call_id)
        return True

    async def media_absent(self, call_id):
        return self.absent

    async def events(self):
        yield {"type": "ConnectionReady"}
        while True:
            event = await self.queue.get()
            if event is None:
                return
            yield event

    async def close(self):
        self.closed = True


class FakeVoice:
    def __init__(self, websocket, **kwargs):
        self.callbacks = kwargs["callbacks"]
        self.ready = asyncio.Event()
        self.done = asyncio.Event()
        self.started = False

    async def run(self):
        self.ready.set()
        await self.done.wait()

    async def start_conversation(self):
        self.started = True

    async def stop(self):
        self.done.set()


async def wait_until(predicate):
    async with asyncio.timeout(4):
        while not predicate():  # noqa: ASYNC110 - observe asynchronous test doubles
            await asyncio.sleep(0.01)


async def wait_state(service, call_id, state):
    async with asyncio.timeout(4):
        while (await service.get_snapshot(call_id)).state != state:  # noqa: ASYNC110
            await asyncio.sleep(0.01)


@pytest.fixture
async def android(settings, database, packet, monkeypatch):
    import app.android_calls as module

    monkeypatch.setattr(module, "AndroidVoiceSession", FakeVoice)
    settings.call_backend = "android_openrouter"
    settings.post_call_extraction_enabled = False
    packet.language = "en"
    packet.escalation.mode = "end_call"
    config = AndroidConfig(
        selected_sim_slot=1,
        caller_number="+14155550199",
        allowed_destinations=[packet.target.phone],
    )
    asterisk = FakeAsterisk()
    phone = FakePhone()
    service = AndroidCallService(
        settings, database, config=config, asterisk=asterisk, phone=phone, api_key="dummy"
    )
    await service.recover_startup()
    await service.start_watchdog()
    await wait_until(service.supervision_ready)
    harness = SimpleNamespace(
        service=service, phone=phone, asterisk=asterisk, packet=packet, media_tasks=[]
    )
    yield harness
    phone.idle = True
    await service.stop()
    await asyncio.gather(*harness.media_tasks, return_exceptions=True)


async def prepare(h):
    return await h.service.prepare(
        PreparePhoneCallInput(
            context=h.packet,
            requested_by_owner=True,
            authority_basis="The owner requested this test call",
        )
    )


async def start(h):
    plan = await prepare(h)
    return await h.service.start(
        plan.plan_id, explicit_confirmation=True, confirmation_text=plan.confirmation_summary
    )


async def attach(h):
    async def accept(**kwargs):
        pass

    async def close(**kwargs):
        pass

    await wait_until(lambda: bool(h.asterisk.media))
    task = asyncio.create_task(h.service.media_session(SimpleNamespace(accept=accept, close=close)))
    h.media_tasks.append(task)
    await wait_until(lambda: bool(h.asterisk.dials))


async def answer(h, call_id):
    await h.asterisk.queue.put(
        {"type": "StasisStart", "channel": {"id": call_id + "-cell", "state": "Up"}}
    )
    await wait_state(h.service, call_id, CallState.ACTIVE)


async def test_media_precedes_dial_and_only_answer_starts_voice(android):
    h = android
    call = await start(h)
    await wait_until(lambda: bool(h.asterisk.media))
    assert h.asterisk.dials == []
    await attach(h)
    assert not h.service._runtime.voice.started
    await h.asterisk.queue.put(
        {
            "type": "ChannelStateChange",
            "channel": {"id": call.call_id + "-cell", "state": "Ringing"},
        }
    )
    await asyncio.sleep(0.02)
    assert not h.asterisk.bridged
    await answer(h, call.call_id)
    assert h.asterisk.bridged == [call.call_id]
    assert h.service._runtime.voice.started
    assert h.asterisk.dials == [(call.call_id, h.packet.target.phone, 90)]


async def test_persists_transcript_only_after_confirmed_carrier_hangup(android):
    h = android
    call = await start(h)
    await attach(h)
    await answer(h, call.call_id)
    h.service._runtime.voice.callbacks.transcript("callee", "We open at nine.", "test", False)
    h.service._runtime.voice.callbacks.transcript("assistant", "Thank you. Goodbye.", "test", False)
    assert await h.service.terminate_call(call.call_id, "owner_request")
    await wait_until(lambda: bool(h.asterisk.ended))
    assert (await h.service.get_snapshot(call.call_id)).state == CallState.TERMINATING
    other = await prepare(h)
    with pytest.raises(CallRefusal, match="call_ending"):
        await h.service.start(
            other.plan_id, explicit_confirmation=True, confirmation_text=other.confirmation_summary
        )
    h.phone.idle = True
    await wait_state(h.service, call.call_id, CallState.COMPLETED)
    result = await h.service.get_result(call.call_id)
    assert [t["text"] for t in result["transcript"]] == ["We open at nine.", "Thank you. Goodbye."]
    assert result["result"]["result_source"] == "transcript_only"
    assert result["result"]["outcome"] == "unknown"
    assert result["cost"] is None


@pytest.mark.parametrize("blocker", ["phone", "registration", "supervision"])
async def test_readiness_refusals_never_consume_or_dial_a_plan(android, blocker):
    h = android
    plan = await prepare(h)
    if blocker == "phone":
        h.phone.problem = "SIM policy is not confirmed"
    elif blocker == "registration":
        h.asterisk.registered = False
    else:
        h.service._events_connected = False
    with pytest.raises(CallRefusal, match="supervision_unavailable"):
        await h.service.start(
            plan.plan_id, explicit_confirmation=True, confirmation_text=plan.confirmation_summary
        )
    assert h.asterisk.media == []
    assert h.asterisk.dials == []
    assert (await h.service.db.get_plan(plan.plan_id))["state"] == "prepared"


async def test_unknown_originate_outcome_is_ended_without_redial(android):
    h = android
    h.asterisk.originate_error = True
    call = await start(h)
    await attach(h)
    await wait_until(lambda: bool(h.asterisk.ended))
    h.phone.idle = True
    await wait_state(h.service, call.call_id, CallState.FAILED)
    assert len(h.asterisk.dials) == 1


async def test_duplicate_start_only_originates_once(android):
    h = android
    plan = await prepare(h)
    results = await asyncio.gather(
        *(
            h.service.start(
                plan.plan_id,
                explicit_confirmation=True,
                confirmation_text=plan.confirmation_summary,
            )
            for _ in range(2)
        ),
        return_exceptions=True,
    )
    assert sum(isinstance(r, CallRefusal) for r in results) == 1
    await attach(h)
    assert len(h.asterisk.dials) == 1


async def test_owner_cancel_before_media_never_dials(android):
    h = android
    call = await start(h)
    assert await h.service.terminate_call(call.call_id, "owner_request")
    h.phone.idle = True
    await wait_state(h.service, call.call_id, CallState.FAILED)
    assert not h.asterisk.dials


async def test_reply_cancels_farewell_termination_claim(android):
    h = android
    call = await start(h)
    await attach(h)
    await answer(h, call.call_id)
    assert not await h.service.terminate_call(
        call.call_id, "assistant_finished", guard=lambda: False
    )
    assert (await h.service.get_snapshot(call.call_id)).state == CallState.ACTIVE
    assert not h.asterisk.ended


async def test_unrelated_channel_cannot_end_or_activate_owned_call(android):
    h = android
    call = await start(h)
    await attach(h)
    await h.service._handle_event({"type": "ChannelDestroyed", "channel": {"id": "unrelated"}})
    assert (await h.service.get_snapshot(call.call_id)).state == CallState.ACTIVATING
    assert not h.asterisk.ended


async def test_duration_limit_ends_without_model_request(android):
    h = android
    call = await start(h)
    await attach(h)
    await answer(h, call.call_id)
    await h.service.db.execute(
        "UPDATE calls SET created_at=? WHERE call_id=?", ("2020-01-01T00:00:00+00:00", call.call_id)
    )
    await wait_until(lambda: bool(h.asterisk.ended))
    h.phone.idle = True
    await wait_state(h.service, call.call_id, CallState.TIMED_OUT)


async def test_restart_recovery_requires_new_idle_observation_without_redial(android):
    h = android
    call = await start(h)
    await attach(h)
    await h.service.stop()
    h.service._runtime = None
    h.service._tasks.clear()
    h.service._stopping = False
    await h.service.recover_startup()
    await h.service.start_watchdog()
    await wait_until(lambda: len(h.asterisk.ended) >= 2)
    h.phone.idle = True
    await wait_state(h.service, call.call_id, CallState.FAILED)
    assert len(h.asterisk.dials) == 1


async def test_disabled_destinations_and_transfer_are_rejected(android):
    h = android
    h.packet.target.phone = "+14155550123"
    with pytest.raises(CallRefusal, match="destination_not_enabled"):
        await prepare(h)
    h.packet.target.phone = h.service.config.allowed_destinations[0]
    h.packet.escalation.mode = "transfer_to_owner"
    with pytest.raises(CallRefusal, match="unsupported_transfer"):
        await prepare(h)


async def test_owned_media_must_enter_asterisk_application_before_dial(android):
    h = android

    async def create_without_stasis(call_id, seconds):
        h.asterisk.media.append(call_id)

    async def noop(**kwargs):
        pass

    h.asterisk.create_media = create_without_stasis
    call = await start(h)
    await wait_until(lambda: bool(h.asterisk.media))
    h.media_tasks.append(
        asyncio.create_task(h.service.media_session(SimpleNamespace(accept=noop, close=noop)))
    )
    await wait_until(
        lambda: h.service._runtime.voice is not None and h.service._runtime.voice.ready.is_set()
    )
    await asyncio.sleep(0.05)
    assert not h.asterisk.dials
    await h.service._handle_event(
        {"type": "StasisStart", "channel": {"id": call.call_id + "-media", "state": "Up"}}
    )
    await wait_until(lambda: bool(h.asterisk.dials))
    assert len(h.asterisk.dials) == 1
