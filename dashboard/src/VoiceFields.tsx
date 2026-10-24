import { useState, useId } from "react";
import { api, message } from "./api";
import { languages, type Language, type Voice } from "./types";

export default function VoiceFields({
  value,
  base,
  onChange,
  overrides = false,
}: {
  value: Partial<Voice>;
  base: Voice;
  onChange: (value: Partial<Voice>) => void;
  overrides?: boolean;
}) {
  const listId = useId();
  const [catalog, setCatalog] = useState<{
    voices: { id: string; name: string; description: string }[];
    models: { id: string; name: string }[];
    errors: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  async function loadChoices() {
    setLoading(true);
    try {
      setCatalog(await api("/catalog"));
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  const effective = { ...base, ...value };
  const change = <K extends keyof Voice>(key: K, next: Voice[K]) =>
    onChange({ ...value, [key]: next });
  const inherit = (key: keyof Voice) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };
  function reset(key: keyof Voice) {
    return overrides && Object.hasOwn(value, key) ? (
      <button
        className="text-button"
        type="button"
        onClick={() => inherit(key)}
      >
        Use Global Default
      </button>
    ) : null;
  }
  return (
    <div className="voice-fields">
      <div className="section-heading">
        <span className="muted">Choose a provider voice or enter its ID.</span>
        <button type="button" onClick={loadChoices} disabled={loading}>
          {loading ? "Loading…" : "Load Voice and Model Choices"}
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {catalog?.errors.map((text) => (
        <p key={text} className="muted">
          {text}
        </p>
      ))}
      <datalist id={listId + "-voices"}>
        {catalog?.voices.map((voice) => (
          <option key={voice.id} value={voice.id}>
            {voice.name} — {voice.description}
          </option>
        ))}
      </datalist>
      <datalist id={listId + "-models"}>
        {catalog?.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
      </datalist>
      <div className="two-fields">
        <label>
          Voice name or ID
          <input
            list={listId + "-voices"}
            aria-label="Voice name or ID"
            value={effective.inworld_voice}
            onChange={(e) => change("inworld_voice", e.target.value)}
          />
          {reset("inworld_voice")}
          <small>Use an Inworld voice such as Wade or Ashley.</small>
        </label>
        <label>
          Voice model
          <select
            value={effective.inworld_model}
            onChange={(e) => change("inworld_model", e.target.value)}
          >
            <option value="inworld-tts-2">Inworld TTS-2</option>
            <option value="inworld-tts-2-flash">Inworld TTS-2 Flash</option>
            {!["inworld-tts-2", "inworld-tts-2-flash"].includes(
              effective.inworld_model,
            ) && <option>{effective.inworld_model}</option>}
          </select>
          {reset("inworld_model")}
        </label>
      </div>
      <label>
        Delivery
        <select
          value={effective.inworld_delivery_mode || ""}
          onChange={(e) =>
            change("inworld_delivery_mode", e.target.value || null)
          }
        >
          <option value="">Provider default</option>
          <option value="STABLE">Stable</option>
          <option value="BALANCED">Balanced</option>
          <option value="CREATIVE">Expressive</option>
        </select>
        {reset("inworld_delivery_mode")}
      </label>
      <fieldset className="language-options">
        <legend>Allowed languages</legend>
        {Object.entries(languages).map(([k, v]) => (
          <label className="check" key={k}>
            <input
              type="checkbox"
              checked={effective.conversation_languages.includes(k as Language)}
              onChange={(e) =>
                change(
                  "conversation_languages",
                  e.target.checked
                    ? [...effective.conversation_languages, k as Language]
                    : effective.conversation_languages.filter((l) => l !== k),
                )
              }
            />
            {v}
          </label>
        ))}
        {reset("conversation_languages")}
      </fieldset>
      <details>
        <summary>Model and response timing</summary>
        <p className="muted">
          These settings use your existing provider accounts. Try changes in the
          playground.
        </p>
        <label>
          OpenRouter model
          <input
            list={listId + "-models"}
            aria-label="OpenRouter model"
            value={effective.dialogue_model}
            onChange={(e) =>
              onChange({
                ...value,
                dialogue_model: e.target.value,
                dialogue_provider: null,
                dialogue_fallback_providers: [],
                reasoning_effort: null,
              })
            }
          />
          {reset("dialogue_model")}
          <small>
            Changing models resets provider routing and reasoning to automatic.
            Adjust them below when needed.
          </small>
        </label>
        <div className="two-fields">
          <label>
            Preferred provider
            <input
              value={effective.dialogue_provider || ""}
              placeholder="Automatic routing"
              onChange={(e) =>
                change("dialogue_provider", e.target.value || null)
              }
            />
            {reset("dialogue_provider")}
          </label>
          <label>
            Fallback providers
            <input
              value={effective.dialogue_fallback_providers.join(", ")}
              onChange={(e) =>
                change(
                  "dialogue_fallback_providers",
                  e.target.value
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean),
                )
              }
            />
            {reset("dialogue_fallback_providers")}
          </label>
        </div>
        <div className="two-fields">
          <label>
            Reasoning
            <select
              value={effective.reasoning_effort ?? ""}
              onChange={(e) =>
                change("reasoning_effort", e.target.value || null)
              }
            >
              <option value="">Provider default</option>
              {["none", "minimal", "low", "medium", "high"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            {reset("reasoning_effort")}
          </label>
          <label>
            Temperature
            <input
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={effective.dialogue_temperature}
              onChange={(e) =>
                change("dialogue_temperature", Number(e.target.value))
              }
            />
            {reset("dialogue_temperature")}
          </label>
        </div>
        <h4>Speech recognition</h4>
        <label>
          Soniox model
          <input
            value={effective.soniox_model}
            onChange={(e) => change("soniox_model", e.target.value)}
          />
          {reset("soniox_model")}
        </label>
        <label>
          Turn detection
          <select
            value={effective.soniox_turn_detection}
            onChange={(e) =>
              change(
                "soniox_turn_detection",
                e.target.value as Voice["soniox_turn_detection"],
              )
            }
          >
            <option value="semantic">Meaning and speech</option>
            <option value="vad">Speech activity</option>
          </select>
          {reset("soniox_turn_detection")}
        </label>
        <div className="three-fields">
          <label>
            Endpoint delay (ms)
            <input
              type="number"
              min="500"
              max="3000"
              step="100"
              value={effective.soniox_endpoint_delay_ms}
              onChange={(e) =>
                change("soniox_endpoint_delay_ms", Number(e.target.value))
              }
            />
            {reset("soniox_endpoint_delay_ms")}
          </label>
          <label>
            Latency level
            <input
              type="number"
              min="0"
              max="3"
              step="1"
              value={effective.soniox_endpoint_latency_level}
              onChange={(e) =>
                change("soniox_endpoint_latency_level", Number(e.target.value))
              }
            />
            {reset("soniox_endpoint_latency_level")}
          </label>
          <label>
            Sensitivity
            <input
              type="number"
              min="-1"
              max="1"
              step="0.1"
              value={effective.soniox_endpoint_sensitivity}
              onChange={(e) =>
                change("soniox_endpoint_sensitivity", Number(e.target.value))
              }
            />
            {reset("soniox_endpoint_sensitivity")}
          </label>
        </div>
        <h4>Call duration</h4>
        <div className="two-fields">
          <label>
            Default minutes
            <input
              type="number"
              min="0.5"
              max="120"
              step="0.5"
              value={effective.default_call_seconds / 60}
              onChange={(e) =>
                change("default_call_seconds", Number(e.target.value) * 60)
              }
            />
            {reset("default_call_seconds")}
          </label>
          <label>
            Maximum minutes
            <input
              type="number"
              min="0.5"
              max="120"
              step="0.5"
              value={effective.max_call_seconds / 60}
              onChange={(e) =>
                change("max_call_seconds", Number(e.target.value) * 60)
              }
            />
            {reset("max_call_seconds")}
          </label>
        </div>
      </details>
    </div>
  );
}
