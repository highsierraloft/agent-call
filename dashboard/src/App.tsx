import { useCallback, useEffect, useState, lazy, Suspense } from "react";
import {
  AudioLines,
  Phone,
  SlidersHorizontal,
  Plug,
  Plus,
  ArrowUpRight,
  Radio,
  CheckCircle2,
  Square,
} from "lucide-react";
import { api, message, setCsrf } from "./api";
import type { Brief, Draft, Session, Status } from "./types";
import Calls from "./Calls";
import Profiles from "./Profiles";
const Playground = lazy(() => import("./Playground"));
import Integration from "./Integration";
import NewCall from "./NewCall";

const sections = [
  { id: "calls", label: "Calls", icon: Phone },
  { id: "personalities", label: "Personalities", icon: SlidersHorizontal },
  { id: "playground", label: "Playground", icon: AudioLines },
  { id: "integration", label: "Integration", icon: Plug },
];
export default function App() {
  const [path, setPath] = useState(location.pathname),
    [session, setSession] = useState<Session | null>(null),
    [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(""),
    [newCall, setNewCall] = useState(false),
    [reuse, setReuse] = useState<Brief>(),
    [draft, setDraft] = useState<Draft>();
  const [ending, setEnding] = useState(false);
  useEffect(() => {
    if (!status?.active_call) setEnding(false);
  }, [status?.active_call]);
  async function endActive() {
    if (!status?.active_call) return;
    setEnding(true);
    try {
      await api("/calls/" + status.active_call + "/end", "POST");
      setStatus(await api<Status>("/status"));
    } catch (e) {
      setError(message(e));
      setEnding(false);
    }
  }
  const [visited, setVisited] = useState<Set<string>>(
    () => new Set([location.pathname.split("/")[1] || "calls"]),
  );
  const navigate = useCallback((next: string) => {
    history.pushState({}, "", next);
    setPath(next);
    setVisited((v) => new Set([...v, next.split("/")[1] || "calls"]));
  }, []);
  const refresh = useCallback(async () => {
    const next = await api<Session>("/session");
    setCsrf(next.csrf);
    setSession(next);
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(message(e)));
    const pop = () => {
      setPath(location.pathname);
      setVisited(
        (v) => new Set([...v, location.pathname.split("/")[1] || "calls"]),
      );
    };
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, [refresh]);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    const poll = () =>
      api<Status>("/status")
        .then((v) => {
          if (alive) setStatus(v);
        })
        .catch(() => {
          if (alive) setStatus(null);
        });
    poll();
    const timer = setInterval(poll, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [session]);
  const section =
    sections.find((s) => path.split("/")[1] === s.id) || sections[0];
  const openCall = (brief?: Brief) => {
    setReuse(brief);
    setNewCall(true);
  };
  const testDraft = (value: Draft) => {
    setDraft(value);
    navigate("/playground");
  };
  if (!session)
    return (
      <main className="access-screen">
        <AudioLines size={40} />
        <h1>Calling Agent</h1>
        <p>{error || "Opening your private workspace…"}</p>
        {error && (
          <>
            <p className="muted">
              Connect with your personal Tailscale account, then open the
              private dashboard address.
            </p>
            <button
              onClick={() => {
                setError("");
                refresh().catch((e) => setError(message(e)));
              }}
            >
              Try Again
            </button>
          </>
        )}
      </main>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="/calls"
          onClick={(e) => {
            e.preventDefault();
            navigate("/calls");
          }}
        >
          <AudioLines size={27} />
          <span>
            Calling Agent<small>Private workspace</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {sections.map((s) => (
            <a
              key={s.id}
              href={"/" + s.id}
              aria-current={section.id === s.id ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate("/" + s.id);
              }}
            >
              <s.icon size={19} />
              <span>{s.label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="caption">CALLING THROUGH</span>
          <strong>Spanish DIGI</strong>
          <a href={session.hermes_url} target="_blank" rel="noreferrer">
            Open Hermes <ArrowUpRight size={14} />
          </a>
        </div>
      </aside>
      <main className="workspace">
        <header className="app-toolbar">
          <h1>{section.label}</h1>
          <div className="toolbar-actions">
            <span
              className="readiness"
              role="img"
              aria-label={
                status?.active_call
                  ? "Call in progress"
                  : status?.practice_active
                    ? "Practice active"
                    : status?.ready
                      ? "Phone ready"
                      : "Phone unavailable"
              }
              title={
                status?.phone.phase?.replaceAll("_", " ") ||
                "Checking connection"
              }
            >
              {status?.ready ? <CheckCircle2 size={15} /> : <Radio size={15} />}
              <span>
                {status?.active_call
                  ? "Call in progress"
                  : status?.practice_active
                    ? "Practice active"
                    : status?.ready
                      ? "Phone ready"
                      : status
                        ? "Phone unavailable"
                        : "Checking phone"}
              </span>
            </span>
            {status?.active_call && (
              <button className="danger" onClick={endActive} disabled={ending}>
                <Square size={15} />
                {ending ? "Ending…" : "End Active Call"}
              </button>
            )}
            <button
              className="primary"
              onClick={() => openCall()}
              disabled={!!status?.active_call || !!status?.practice_active}
            >
              <Plus size={16} />
              New Call
            </button>
          </div>
        </header>
        {status?.active_call &&
          !(
            section.id === "calls" && path.split("/")[2] === status.active_call
          ) && (
            <div className="active-strip">
              <Radio size={16} />
              <span>A telephone call is in progress.</span>
              <button onClick={() => navigate("/calls/" + status.active_call)}>
                View Call
              </button>
            </div>
          )}
        {error && (
          <div role="alert" className="error banner">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              Dismiss
            </button>
          </div>
        )}
        {section.id === "calls" && (
          <Calls
            selected={path.split("/")[2]}
            session={session}
            navigate={navigate}
            onNew={openCall}
          />
        )}
        {visited.has("personalities") && (
          <div
            className="section-container"
            hidden={section.id !== "personalities"}
          >
            <Profiles session={session} onTest={testDraft} onSaved={refresh} />
          </div>
        )}
        {section.id === "playground" && (
          <Suspense
            fallback={
              <p className="inset muted" role="status">
                Opening playground…
              </p>
            }
          >
            <Playground
              session={session}
              draft={draft}
              clearDraft={() => setDraft(undefined)}
              status={status}
              onActivity={() =>
                api<Status>("/status")
                  .then(setStatus)
                  .catch(() => setStatus(null))
              }
            />
          </Suspense>
        )}
        {visited.has("integration") && (
          <div
            className="section-container"
            hidden={section.id !== "integration"}
          >
            <Integration session={session} onSaved={refresh} status={status} />
          </div>
        )}
      </main>
      {newCall && (
        <NewCall
          session={session}
          initial={reuse}
          onClose={() => setNewCall(false)}
          onStarted={(id) => {
            setNewCall(false);
            setStatus((v) => (v ? { ...v, active_call: id } : v));
            navigate("/calls/" + id);
          }}
        />
      )}
    </div>
  );
}
