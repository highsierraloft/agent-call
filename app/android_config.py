"""Configuration for the private Android/OpenRouter deployment."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


class AndroidConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    asterisk_url: str = "http://asterisk:8088/ari"
    asterisk_credentials_file: Path = Path("/run/secrets/asterisk.json")
    openrouter_key_file: Path = Path("/run/secrets/openrouter-api-key")
    phone_status_file: Path = Path("/run/phone/status.json")
    selected_sim_slot: Literal[1, 2]
    caller_number: str = Field(pattern=r"^\+[1-9][0-9]{7,14}$")
    allowed_destinations: list[str] = Field(min_length=1, max_length=20)
    max_call_seconds: int = Field(default=90, ge=30, le=600)
    stt_transport: Literal["openrouter_file", "deepgram_flux", "soniox"] = "openrouter_file"
    deepgram_key_file: Path = Path("/run/secrets/deepgram-api-key")
    soniox_key_file: Path = Path("/run/secrets/soniox-api-key")
    soniox_model: str = "stt-rt-v5"
    soniox_turn_detection: Literal["semantic", "vad"] = "semantic"
    soniox_endpoint_delay_ms: int = Field(default=500, ge=500, le=3000)
    soniox_endpoint_latency_level: int = Field(default=2, ge=0, le=3)
    soniox_endpoint_sensitivity: float = Field(default=0.3, ge=-1, le=1)
    stt_model: str = "deepgram/nova-3"
    dialogue_model: str = "google/gemini-3.1-flash-lite"
    reasoning_effort: Literal["none", "minimal", "low", "medium", "high"] = "none"
    tts_model: str = "elevenlabs/eleven-flash-v2.5"
    voice: str = "sarah"
    tts_transport: Literal["openrouter", "inworld"] = "openrouter"
    inworld_key_file: Path = Path("/run/secrets/inworld-api-key")
    inworld_model: str = "inworld-tts-2-flash"
    inworld_voice: str = "Ashley"
    inworld_delivery_mode: Literal["STABLE", "BALANCED", "CREATIVE"] | None = None

    @staticmethod
    def _provider_key(path: Path, provider: str) -> SecretStr:
        try:
            value = path.read_text().strip()
        except OSError:
            raise ValueError(f"The direct {provider} credential is unavailable") from None
        if len(value) < 20 or any(char.isspace() for char in value):
            raise ValueError(f"The direct {provider} credential is invalid")
        return SecretStr(value)

    def deepgram_key(self) -> SecretStr:
        return self._provider_key(self.deepgram_key_file, "Deepgram")

    def soniox_key(self) -> SecretStr:
        return self._provider_key(self.soniox_key_file, "Soniox")

    def inworld_key(self) -> SecretStr:
        return self._provider_key(self.inworld_key_file, "Inworld")

    def validate_voice_credentials(self) -> None:
        if self.stt_transport == "deepgram_flux":
            self.deepgram_key()
        elif self.stt_transport == "soniox":
            self.soniox_key()
        if self.tts_transport == "inworld":
            self.inworld_key()

    @field_validator("allowed_destinations")
    @classmethod
    def validate_destinations(cls, values: list[str]) -> list[str]:
        import re

        if any(not re.fullmatch(r"\+[1-9][0-9]{7,14}", value) for value in values):
            raise ValueError("Test destinations must use full international numbers")
        return values

    def openrouter_key(self) -> SecretStr:
        value = self.openrouter_key_file.read_text().strip()
        if not value.startswith("sk-or-v1-") or any(char.isspace() for char in value):
            raise ValueError("The private OpenRouter credential is missing or invalid")
        return SecretStr(value)

    def asterisk_credentials(self) -> dict[str, str]:
        data = json.loads(self.asterisk_credentials_file.read_text())
        result: dict[str, str] = {}
        for name in ("ari_password", "media_password"):
            value = data.get(name)
            if not isinstance(value, str) or len(value) < 32:
                raise ValueError("The private Asterisk credentials are missing or invalid")
            result[name] = value
        return result
