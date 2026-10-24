import { useEffect, useRef, useState } from "react";
import { Phone, X, ChevronLeft } from "lucide-react";
import { api, message, ApiError } from "./api";
import {
  languages,
  sampleBrief,
  type Brief,
  type Session,
  type Intention,
  type Language,
} from "./types";

export default function NewCall({
  session,
  initial,
  onClose,
  onStarted,
}: {
  session: Session;
  initial?: Brief;
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [brief, setBrief] = useState<Brief>(() =>
    initial
      ? {
          ...initial,
          owner: session.setup.owner,
          escalation: { mode: "end_call" },
        }
      : {
          ...sampleBrief(session.setup),
          target: { name: "", phone: "" },
          objective: "",
          intention: "task",
        },
  );
  const [prepared, setPrepared] = useState<{
      plan_id: string;
      confirmation_summary: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const update = <K extends keyof Brief>(key: K, value: Brief[K]) =>
    setBrief((v) => ({ ...v, [key]: value }));
  async function prepare(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{
        plan_id: string | null;
        confirmation_summary: string;
        missing_fields: string[];
      }>("/calls/prepare", "POST", {
        context: {
          ...brief,
          target: {
            ...brief.target,
            phone: brief.target.phone.replace(/[\s().-]/g, ""),
          },
        },
        requested_by_owner: true,
        authority_basis: "Owner reviewed this call in the private dashboard",
      });
      if (!r.plan_id)
        throw new Error(
          "Complete these details: " + r.missing_fields.join(", "),
        );
      setPrepared({
        plan_id: r.plan_id,
        confirmation_summary: r.confirmation_summary,
      });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (!prepared) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ call_id: string }>("/calls/start", "POST", {
        ...prepared,
        confirmation_text: prepared.confirmation_summary,
        confirmation_summary: undefined,
        explicit_confirmation: true,
      });
      onStarted(r.call_id);
    } catch (e) {
      setError(message(e));
      if (e instanceof TypeError || (e instanceof ApiError && e.status >= 500))
        setUncertain(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="call-dialog"
      aria-labelledby="call-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <div>
          <span className="eyebrow">SPANISH DIGI</span>
          <h2 id="call-dialog-title">
            {prepared ? "Review Call" : "New Call"}
          </h2>
        </div>
        <button
          aria-label="Close call form"
          className="icon-button"
          onClick={onClose}
          disabled={busy}
        >
          <X size={20} />
        </button>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
          {uncertain &&
            " The start result is uncertain. Check Calls before trying again."}
        </p>
      )}
      {prepared ? (
        <>
          <p className="review-summary">{prepared.confirmation_summary}</p>
          <p className="muted">
            This call will use the saved personality settings from this
            preparation.
          </p>
          <footer>
            <button
              onClick={() => setPrepared(null)}
              disabled={busy || uncertain}
            >
              <ChevronLeft size={16} />
              Edit Brief
            </button>
            <button
              className="primary"
              onClick={start}
              disabled={busy || uncertain}
            >
              <Phone size={16} />
              {busy ? "Starting…" : "Call " + brief.target.name}
            </button>
          </footer>
        </>
      ) : (
        <form onSubmit={prepare}>
          <div className="two-fields">
            <label>
              Recipient
              <input
                required
                autoFocus
                value={brief.target.name}
                onChange={(e) =>
                  update("target", { ...brief.target, name: e.target.value })
                }
              />
            </label>
            <label>
              Phone number
              <input
                required
                type="tel"
                placeholder="+34 …"
                value={brief.target.phone}
                onChange={(e) =>
                  update("target", { ...brief.target, phone: e.target.value })
                }
              />
              <small>Include the country code.</small>
            </label>
          </div>
          <label>
            What should the agent achieve?
            <textarea
              required
              rows={3}
              value={brief.objective}
              onChange={(e) => update("objective", e.target.value)}
            />
          </label>
          <div className="two-fields">
            <label>
              Personality
              <select
                value={brief.profile_id || brief.personality || "warm"}
                onChange={(e) => update("profile_id", e.target.value)}
              >
                {session.setup.profiles.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Purpose
              <select
                value={brief.intention}
                onChange={(e) =>
                  update("intention", e.target.value as Intention)
                }
              >
                {["task", "conversation", "sales", "roleplay", "prank"].map(
                  (v) => (
                    <option key={v}>{v}</option>
                  ),
                )}
              </select>
            </label>
          </div>
          <div className="two-fields">
            <label>
              Initial language
              <select
                value={brief.language}
                onChange={(e) => update("language", e.target.value as Language)}
              >
                {Object.entries(languages).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Maximum minutes
              <input
                type="number"
                min="0.5"
                max="120"
                step="0.5"
                value={brief.max_duration_seconds / 60}
                onChange={(e) =>
                  update("max_duration_seconds", Number(e.target.value) * 60)
                }
              />
            </label>
          </div>
          <details>
            <summary>Facts and limits</summary>
            {(
              [
                "relevant_facts",
                "allowed_commitments",
                "hard_constraints",
              ] as const
            ).map((key) => (
              <label key={key}>
                {
                  {
                    relevant_facts: "Relevant facts",
                    allowed_commitments: "Allowed commitments",
                    hard_constraints: "Limits",
                  }[key]
                }
                <textarea
                  rows={3}
                  value={brief[key].join("\n")}
                  onChange={(e) => update(key, e.target.value.split("\n"))}
                />
                <small>One item per line.</small>
              </label>
            ))}
          </details>
          {brief.intention === "sales" && (
            <fieldset>
              <legend>Commercial offer</legend>
              {(
                ["name", "description", "offer", "desired_next_step"] as const
              ).map((key) => (
                <label key={key}>
                  {key.replaceAll("_", " ")}
                  <input
                    required
                    value={brief.business?.[key] || ""}
                    onChange={(e) =>
                      update("business", {
                        name: "",
                        description: "",
                        offer: "",
                        desired_next_step: "",
                        contact_permission: "",
                        ...brief.business,
                        [key]: e.target.value,
                      })
                    }
                  />
                </label>
              ))}
              <label>
                Contact permission
                <select
                  required
                  value={brief.business?.contact_permission || ""}
                  onChange={(e) =>
                    update("business", {
                      name: "",
                      description: "",
                      offer: "",
                      desired_next_step: "",
                      ...brief.business,
                      contact_permission: e.target.value,
                    })
                  }
                >
                  <option value="">Choose the actual permission</option>
                  <option value="recipient_requested">
                    Recipient requested contact
                  </option>
                  <option value="prior_consent">Prior consent</option>
                </select>
              </label>
            </fieldset>
          )}
          <footer>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Preparing…" : "Review Call"}
            </button>
          </footer>
        </form>
      )}
    </dialog>
  );
}
