import { useEffect, useRef, useState } from "react";
import { PipecatClient } from "@pipecat-ai/client-js";
import {
  WebSocketTransport,
  WavMediaManager,
} from "@pipecat-ai/websocket-transport";
import {
  AudioLines,
  Mic,
  Square,
  Send,
  MessageSquare,
  FileText,
} from "lucide-react";
import { api, message } from "./api";
import AIInputs from "./AIInputs";
import {
  languages,
  sampleBrief,
  type Draft,
  type Brief,
  type Practice,
  type Session,
  type Status,
  type Language,
  type Intention,
  type AIInputInspection,
} from "./types";

export default function Playground({
  session,
  draft,
  clearDraft,
  status,
  onActivity,
}: {
  session: Session;
  draft?: Draft;
  clearDraft: () => void;
  status: Status | null;
  onActivity: () => Promise<unknown>;
}) {
  const [brief, setBrief] = useState<Brief>(() => ({
      ...sampleBrief(session.setup, draft?.profileId),
      language: (draft?.profile?.voice_overrides.conversation_languages ||
        draft?.global?.voice.conversation_languages ||
        session.setup.defaults.conversation_languages)[0],
    })),
    [mode, setMode] = useState<"voice" | "text">("voice"),
    [practice, setPractice] = useState<Practice | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [text, setText] = useState(""),
    [partial, setPartial] = useState(""),
    [preview, setPreview] = useState<AIInputInspection | null>(null);
  const client = useRef<PipecatClient | null>(null),
    id = useRef<string | null>(null),
    alive = useRef(true),
    closing = useRef(false);
  const running = !!practice && !["stopped", "failed"].includes(practice.state);
  useEffect(() => {
    alive.current = true;
    const release = () => {
      closing.current = true;
      client.current?.disconnect().catch(() => {});
      if (id.current)
        void api(
          "/practice/" + id.current,
          "DELETE",
          undefined,
          undefined,
          true,
        ).catch(() => {});
    };
    addEventListener("pagehide", release);
    return () => {
      alive.current = false;
      removeEventListener("pagehide", release);
      release();
    };
  }, []);

  useEffect(() => {
    if (!practice || ["stopped", "failed"].includes(practice.state)) return;
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const r = await api<Practice>("/practice/" + practice.id);
        if (alive.current) {
          setPractice(r);
          if (["stopped", "failed"].includes(r.state)) {
            closing.current = true;
            await client.current?.disconnect();
            id.current = null;
            void onActivity();
          }
        }
      } catch (e) {
        if (alive.current) setError(message(e));
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(poll, 1200);
    return () => clearInterval(timer);
  }, [practice?.id, practice?.state]);
  const overrides = () =>
    draft
      ? {
          ...(draft.global ? { global: draft.global } : {}),
          ...(draft.profile ? { profile: draft.profile } : {}),
        }
      : undefined;
  async function start() {
    let connectionTimer: ReturnType<typeof setTimeout> | undefined;
    setError("");
    setBusy(true);
    closing.current = false;
    try {
      if (mode === "voice") {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error(
            "Microphone access is unavailable. Open the private HTTPS dashboard in a browser that supports microphone input.",
          );
        const permission = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        permission.getTracks().forEach((track) => track.stop());
        if (!alive.current) return;
      }
      const r = await api<Practice>("/practice", "POST", {
        mode,
        context: { ...brief, max_duration_seconds: undefined },
        overrides: overrides(),
      });
      if (!alive.current) {
        await api("/practice/" + r.id, "DELETE");
        return;
      }
      id.current = r.id;
      setPractice(r);
      void onActivity();
      if (mode === "voice") {
        const pc = new PipecatClient({
          transport: new WebSocketTransport({
            mediaManager: new WavMediaManager(512, 16000),
            recorderSampleRate: 16000,
            playerSampleRate: 24000,
          }),
          enableMic: true,
          enableCam: false,
          callbacks: {
            onUserTranscript: (turn) => {
              if (alive.current) setPartial(turn.final ? "" : turn.text);
            },
            onError: async () => {
              if (!alive.current || closing.current) return;
              if (id.current) {
                const latest = await api<Practice>(
                  "/practice/" + id.current,
                ).catch(() => null);
                if (
                  latest &&
                  ["stopping", "stopped", "failed"].includes(latest.state)
                ) {
                  if (alive.current) setPractice(latest);
                  return;
                }
              }
              if (alive.current && !closing.current)
                setError(
                  "The audio connection failed. Check microphone access, then try again.",
                );
            },
          },
        });
        client.current = pc;
        await Promise.race([
          pc.connect({
            wsUrl:
              location.origin.replace(/^http/, "ws") +
              "/admin/api/practice/" +
              r.id +
              "/audio",
          }),
          new Promise<never>((_, reject) => {
            connectionTimer = setTimeout(
              () =>
                reject(
                  new Error(
                    "Voice connection timed out. Check your settings and try again.",
                  ),
                ),
              20000,
            );
          }),
        ]);
      }
    } catch (e) {
      setError(message(e));
      closing.current = true;
      if (id.current) {
        await api("/practice/" + id.current, "DELETE").catch(() => {});
        id.current = null;
      }
      await client.current?.disconnect().catch(() => {});
      setPractice((p) => (p ? { ...p, state: "stopped" } : p));
      void onActivity();
    } finally {
      clearTimeout(connectionTimer);
      if (alive.current) setBusy(false);
    }
  }
  async function stop() {
    setBusy(true);
    closing.current = true;
    try {
      await client.current?.disconnect();
      if (id.current) await api("/practice/" + id.current, "DELETE");
      id.current = null;
      setPractice((p) => (p ? { ...p, state: "stopped" } : p));
      setPartial("");
      void onActivity();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!practice || !text.trim()) return;
    setBusy(true);
    setError("");
    const input = text;
    setText("");
    try {
      setPractice(
        await api<Practice>("/practice/" + practice.id + "/text", "POST", {
          text: input,
        }),
      );
    } catch (e) {
      setError(message(e));
      setText(input);
    } finally {
      setBusy(false);
    }
  }
  async function showPrompt() {
    try {
      if (practice?.id) {
        setPreview(
          await api<AIInputInspection>(
            "/practice/" + practice.id + "/ai-inputs",
          ),
        );
        return;
      }
      const r = await api<AIInputInspection>("/prompt-preview", "POST", {
        mode,
        context: { ...brief, max_duration_seconds: undefined },
        overrides: overrides(),
      });
      setPreview(r);
    } catch (e) {
      setError(message(e));
    }
  }
  const blocked =
    !!status?.active_call ||
    (!running && !!status?.practice_active && !practice);
  return (
    <div className="playground-layout">
      <aside className="practice-setup">
        <span className="eyebrow">NO PHONE NUMBER NEEDED</span>
        <h2>Try a conversation</h2>
        <p className="muted">
          Use the same prompts and providers. Practice never places a telephone
          call.
        </p>
        {draft && (
          <div className="draft-notice">
            <strong>Testing unsaved changes</strong>
            <p>These settings have not been applied to real calls.</p>
            <button onClick={clearDraft} disabled={running}>
              Use Saved Settings
            </button>
          </div>
        )}
        <fieldset disabled={running || busy}>
          <label>
            Personality
            <select
              value={brief.profile_id}
              onChange={(e) => {
                clearDraft();
                setBrief((b) => ({ ...b, profile_id: e.target.value }));
              }}
            >
              {session.setup.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Initial language
            <select
              value={brief.language}
              onChange={(e) =>
                setBrief((b) => ({
                  ...b,
                  language: e.target.value as Language,
                }))
              }
            >
              {Object.entries(languages).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Purpose
            <select
              value={brief.intention}
              onChange={(e) =>
                setBrief((b) => ({
                  ...b,
                  intention: e.target.value as Intention,
                }))
              }
            >
              {["conversation", "task", "roleplay", "prank", "sales"].map(
                (v) => (
                  <option key={v}>{v}</option>
                ),
              )}
            </select>
          </label>
          <label>
            Practice brief
            <textarea
              aria-label="Practice brief"
              rows={5}
              value={brief.objective}
              onChange={(e) =>
                setBrief((b) => ({ ...b, objective: e.target.value }))
              }
            />
          </label>
          <div className="segmented" role="group" aria-label="Practice mode">
            <button
              type="button"
              aria-pressed={mode === "voice"}
              onClick={() => setMode("voice")}
            >
              <Mic size={15} />
              Voice
            </button>
            <button
              type="button"
              aria-pressed={mode === "text"}
              onClick={() => setMode("text")}
            >
              <MessageSquare size={15} />
              Text
            </button>
          </div>
        </fieldset>
        <div className="practice-actions">
          {running ? (
            <button className="danger" disabled={busy} onClick={stop}>
              <Square size={16} />
              {busy ? "Stopping…" : "End Practice"}
            </button>
          ) : (
            <button
              className="primary"
              disabled={busy || blocked}
              onClick={start}
            >
              {mode === "voice" ? (
                <Mic size={16} />
              ) : (
                <MessageSquare size={16} />
              )}{" "}
              {busy
                ? "Connecting…"
                : mode === "voice"
                  ? "Start Voice Practice"
                  : "Start Text Practice"}
            </button>
          )}
          <button onClick={showPrompt}>
            <FileText size={15} />
            Inspect AI Inputs
          </button>
        </div>
        {blocked && (
          <p className="muted">
            A call or another practice session is active. End it before starting
            practice.
          </p>
        )}
        <p className="caption muted">
          Provider usage applies. Browser audio does not include cellular
          carrier delay.
        </p>
      </aside>
      <section className="practice-conversation">
        <header className="row-top">
          <div>
            <h3>
              {running
                ? "Practice in progress"
                : practice
                  ? "Practice complete"
                  : "Conversation preview"}
            </h3>
            <span className="muted">
              {practice?.configuration.profile_name ||
                draft?.profile?.name ||
                session.setup.profiles.find((p) => p.id === brief.profile_id)
                  ?.name}
            </span>
          </div>
          {running && (
            <span className="pill">
              <Mic size={13} />
              {mode === "voice"
                ? practice?.state === "waiting"
                  ? "Connecting audio"
                  : "Microphone active"
                : "Text session"}
            </span>
          )}
        </header>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {practice?.error && (
          <p role="alert" className="error">
            {practice.error}
          </p>
        )}
        {preview !== null && (
          <AIInputs
            data={preview}
            onClose={() => setPreview(null)}
            onRefresh={showPrompt}
          />
        )}
        <div className="practice-turns" aria-live="polite">
          {practice?.messages.map((turn, i) => (
            <article className="transcript-turn" key={i}>
              <header>
                <strong>
                  {turn.speaker === "assistant" ? "Calling agent" : "You"}
                </strong>
                {turn.interrupted && (
                  <span className="caption">Interrupted</span>
                )}
              </header>
              <p>{turn.text}</p>
            </article>
          ))}
          {partial && <p className="partial">{partial}</p>}
          {!practice?.messages.length && (
            <div className="empty">
              <AudioLines size={42} />
              <h3>{running ? "Say hello." : "Make it sound like you want."}</h3>
              <p>
                {running
                  ? "Speak naturally. Try an interruption or a language switch."
                  : "Try the opening, ask a difficult question, or change languages. The conversation will appear here."}
              </p>
            </div>
          )}
        </div>
        {running && mode === "text" && (
          <form className="text-composer" onSubmit={send}>
            <input
              aria-label="Practice message"
              placeholder="Say something to the agent…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
            />
            <button
              className="primary"
              aria-label="Send practice message"
              disabled={busy || !text.trim()}
            >
              <Send size={17} />
            </button>
          </form>
        )}
        {!!practice?.metrics.length && (
          <footer className="practice-metrics">
            <span className="caption">
              {mode === "text" ? "MODEL RESPONSE" : "SERVER REPLY START"}
            </span>
            <strong>{practice.metrics.at(-1)!.seconds.toFixed(2)} s</strong>
            <span className="muted">Latest measured turn</span>
          </footer>
        )}
      </section>
    </div>
  );
}
