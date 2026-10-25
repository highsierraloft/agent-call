import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, Search, Trash2 } from "lucide-react";
import { api, message } from "./api";
import { SectionTabs, SettingsDisclosure } from "./Controls";
import type { Contact, MemoryFact } from "./types";

export default function Contacts({
  selected,
  navigate,
}: {
  selected?: string;
  navigate: (path: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [rows, setRows] = useState<Contact[]>([]),
    [offset, setOffset] = useState<number | null>(null);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    const timer = setTimeout(
      () =>
        api<{ contacts: Contact[]; next_offset: number | null }>(
          "/contacts?" + new URLSearchParams({ search: query }),
          "GET",
          undefined,
          abort.signal,
        )
          .then((data) => {
            setRows(data.contacts);
            setOffset(data.next_offset);
            setError("");
            setLoading(false);
          })
          .catch((e) => {
            if (!abort.signal.aborted) {
              setError(message(e));
              setLoading(false);
            }
          }),
      180,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, refresh]);
  async function more() {
    try {
      const data = await api<{
        contacts: Contact[];
        next_offset: number | null;
      }>(
        "/contacts?" +
          new URLSearchParams({ search: query, offset: String(offset) }),
      );
      setRows((old) => [...old, ...data.contacts]);
      setOffset(data.next_offset);
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className={"contacts-layout " + (selected ? "has-selection" : "")}>
      <aside className="contact-list" aria-label="Contact list">
        <div className="section-heading">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Search contacts"
              placeholder="Name, company, or number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button
            className="icon-button"
            aria-label="New contact"
            onClick={() => navigate("/contacts/new")}
          >
            <Plus size={18} />
          </button>
        </div>
        {loading && (
          <p className="inset muted" role="status">
            Loading contacts…
          </p>
        )}
        {error && (
          <p role="alert" className="error inset">
            {error}
          </p>
        )}
        {!loading && !rows.length && (
          <p className="inset muted">
            {query
              ? "No matching contacts."
              : "Contacts appear here as calls are linked. You can also add one."}
          </p>
        )}
        <ul className="contact-rows">
          {rows.map((row) => (
            <li key={row.contact_id}>
              <a
                className={selected === row.contact_id ? "selected" : ""}
                href={"/contacts/" + row.contact_id}
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/contacts/" + row.contact_id);
                }}
              >
                <strong>
                  {row.name || row.numbers[0]?.phone || "Unknown caller"}
                </strong>
                <span>
                  {row.numbers.map((n) => n.phone).join(" · ") ||
                    "Number not available"}
                </span>
                <small>{row.call_count || 0} related calls</small>
              </a>
            </li>
          ))}
        </ul>
        {offset !== null && (
          <button className="load-more" onClick={more}>
            Load More Contacts
          </button>
        )}
      </aside>
      <section className="contact-detail">
        {selected ? (
          <ContactDetail
            key={selected}
            id={selected}
            navigate={navigate}
            onSaved={() => setRefresh((x) => x + 1)}
          />
        ) : (
          <div className="empty-detail">
            <h2>Contact memory and history</h2>
            <p>
              Select a contact to review conversations, edit memory, or follow
              up.
            </p>
            <p className="muted">
              Phone numbers help recognize callers. A shared number does not
              prove who is speaking.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function ContactDetail({
  id,
  navigate,
  onSaved,
}: {
  id: string;
  navigate: (path: string) => void;
  onSaved: () => void;
}) {
  const [contact, setContact] = useState<Contact>(),
    [name, setName] = useState(""),
    [background, setBackground] = useState(""),
    [note, setNote] = useState(""),
    [numbers, setNumbers] = useState("");
  const [facts, setFacts] = useState<MemoryFact[]>([]),
    [section, setSection] = useState("history"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const dirty =
    name !== (contact?.name || "") ||
    background !== (contact?.background || "") ||
    note !== (contact?.private_note || "") ||
    numbers !== (contact?.numbers.map((n) => n.phone).join("\n") || "") ||
    JSON.stringify(facts) !== JSON.stringify(contact?.memory.facts || []);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    const navigation = (event: Event) => {
      if (
        dirtyRef.current &&
        (event as CustomEvent<string>).detail !== "/contacts/" + id &&
        !window.confirm("Discard the unsaved contact changes?")
      )
        event.preventDefault();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("calling-navigation", navigation);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("calling-navigation", navigation);
      window.removeEventListener("beforeunload", unload);
    };
  }, [id]);
  function assign(row: Contact) {
    setContact(row);
    setName(row.name);
    setBackground(row.background);
    setNote(row.private_note || "");
    setNumbers(row.numbers.map((n) => n.phone).join("\n"));
    setFacts(row.memory.facts);
  }
  useEffect(() => {
    if (id === "new") {
      setSection("details");
      return;
    }
    let alive = true;
    api<Contact>("/contacts/" + id)
      .then((row) => {
        if (alive) assign(row);
      })
      .catch((e) => {
        if (alive) setError(message(e));
      });
    return () => {
      alive = false;
    };
  }, [id]);
  async function save(memory = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (memory && contact) {
        await api("/contacts/" + id + "/memory", "PUT", {
          expected_revision: contact.memory.revision,
          facts,
        });
        const next = await api<Contact>("/contacts/" + id);
        setContact((old) => (old ? { ...old, memory: next.memory } : next));
        setFacts(next.memory.facts);
      } else {
        const row = await api<Contact>(
          "/contacts" + (id === "new" ? "" : "/" + id),
          id === "new" ? "POST" : "PUT",
          {
            expected_revision: contact?.revision || 0,
            name,
            background,
            private_note: note,
            numbers: numbers
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          },
        );
        setContact((old) =>
          old ? { ...old, ...row, memory: old.memory } : row,
        );
        setName(row.name);
        setBackground(row.background);
        setNote(row.private_note || "");
        setNumbers(row.numbers.map((n) => n.phone).join("\n"));
        if (id === "new") {
          dirtyRef.current = false;
          navigate("/contacts/" + row.contact_id);
        }
      }
      setNotice("Saved. Existing call snapshots stay unchanged.");
      onSaved();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function review(callId: string) {
    setBusy(true);
    try {
      await api("/calls/" + callId + "/review", "POST");
      const next = await api<Contact>("/contacts/" + id);
      setContact((old) =>
        old
          ? { ...old, calls: next.calls, next_offset: next.next_offset }
          : next,
      );
      setNotice(
        "Queued for Hermes. The summary and memory will appear after review.",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    if (!contact) return;
    try {
      const next = await api<Contact>(
        `/contacts/${id}?offset=${contact.next_offset}`,
      );
      setContact({ ...next, calls: [...contact.calls, ...next.calls] });
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <>
      <button className="mobile-back" onClick={() => navigate("/contacts")}>
        <ArrowLeft size={17} />
        Contacts
      </button>
      <header className="contact-heading">
        <h2>
          {id === "new"
            ? "New contact"
            : contact?.name || contact?.numbers[0]?.phone || "Unknown caller"}
        </h2>
        <p className="muted">
          {contact?.numbers.map((n) => n.phone).join(" · ")}
        </p>
        {dirty && <p className="change-label">Unsaved changes</p>}
      </header>
      {error && (
        <p className="error inset" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="success-notice inset">
          {notice}
        </p>
      )}
      {!contact && id !== "new" ? (
        <p className="inset" role="status">
          Loading contact…
        </p>
      ) : (
        <SectionTabs
          label="Contact workspace"
          value={section}
          onChange={setSection}
          items={[
            { id: "history", label: "Conversations" },
            { id: "memory", label: "Memory" },
            { id: "details", label: "Details" },
          ]}
        >
          {section === "history" ? (
            <div className="contact-history">
              <p className="muted">
                Original recordings and full transcripts stay with each call.
              </p>
              {!contact?.calls.length && <p>No linked calls yet.</p>}
              {contact?.calls.map((call) => (
                <article className="timeline-call" key={call.call_id}>
                  <div className="section-heading">
                    <strong>
                      {call.direction === "inbound" ? "Incoming" : "Outgoing"}{" "}
                      call
                    </strong>
                    <time>{new Date(call.created_at).toLocaleString()}</time>
                  </div>
                  <p>
                    {call.summary?.text ||
                      (call.review_state === "pending" ||
                      call.review_state === "leased"
                        ? "Hermes review pending."
                        : "No summary recorded.")}
                  </p>
                  <small className="muted">
                    {call.summary?.outcome || call.state}
                  </small>
                  <div className="save-row">
                    <button onClick={() => navigate("/calls/" + call.call_id)}>
                      Open Transcript & Recording
                    </button>
                    {!["pending", "leased"].includes(
                      call.review_state || "",
                    ) && (
                      <button
                        disabled={busy}
                        onClick={() => review(call.call_id)}
                      >
                        {call.review_state
                          ? "Review Again with Hermes"
                          : "Review with Hermes"}
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {contact?.next_offset !== null &&
                contact?.next_offset !== undefined && (
                  <button onClick={more}>Load Earlier Calls</button>
                )}
              {!!contact?.callbacks.length && (
                <section>
                  <h3>Related callbacks</h3>
                  {contact.callbacks.map((row) => (
                    <p key={row.schedule_id}>
                      <a
                        href="/callbacks"
                        onClick={(e) => {
                          e.preventDefault();
                          navigate("/callbacks");
                        }}
                      >
                        {row.destination} · {row.state.replaceAll("_", " ")} ·{" "}
                        {new Date(row.window_start).toLocaleString()}
                      </a>
                    </p>
                  ))}
                </section>
              )}
            </div>
          ) : section === "memory" ? (
            <div className="form-section contact-form">
              <p className="muted">
                Reusable facts for future conversations. Saving your corrections
                protects these facts from automatic changes. Removed facts
                cannot be revived by reviewing the same evidence.
              </p>
              {facts.map((fact, index) => (
                <div className="memory-fact" key={fact.key}>
                  <label>
                    Fact {index + 1}
                    <textarea
                      rows={2}
                      value={fact.text}
                      onChange={(e) =>
                        setFacts((old) =>
                          old.map((f, i) =>
                            i === index ? { ...f, text: e.target.value } : f,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    className="icon-button"
                    aria-label={"Remove fact " + (index + 1)}
                    onClick={() =>
                      setFacts((old) => old.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                  {fact.source_call_id && (
                    <a
                      href={"/calls/" + fact.source_call_id}
                      onClick={(e) => {
                        e.preventDefault();
                        navigate("/calls/" + fact.source_call_id);
                      }}
                    >
                      Source conversation
                    </a>
                  )}
                </div>
              ))}
              <div className="save-row">
                <button
                  disabled={facts.length >= 40}
                  onClick={() =>
                    setFacts((old) => [
                      ...old,
                      {
                        key: "owner_" + crypto.randomUUID().slice(0, 8),
                        text: "",
                        evidence_turn_ids: [],
                        source_call_id: null,
                        owner_protected: true,
                      },
                    ])
                  }
                >
                  Add Fact
                </button>
                <button
                  className="primary"
                  disabled={
                    busy || !contact || facts.some((f) => !f.text.trim())
                  }
                  onClick={() => save(true)}
                >
                  Save Memory
                </button>
              </div>
            </div>
          ) : (
            <div className="form-section contact-form">
              <label>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                About this person
                <textarea
                  rows={4}
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                />
              </label>
              <p className="field-help">
                Relevant context the agent may use. This is not permission to
                disclose sensitive history.
              </p>
              <label>
                Phone numbers
                <textarea
                  rows={3}
                  value={numbers}
                  onChange={(e) => setNumbers(e.target.value)}
                  placeholder="One international number per line"
                />
              </label>
              <p className="field-help">
                A number may belong to more than one person. Saving it here does
                not merge contacts.
              </p>
              <SettingsDisclosure
                title="Private owner notes"
                summary="Excluded from calls and Hermes reviews"
              >
                <label>
                  Notes
                  <textarea
                    rows={6}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
              </SettingsDisclosure>
              <button
                className="primary"
                disabled={busy || (!name.trim() && !numbers.trim())}
                onClick={() => save()}
              >
                Save Contact
              </button>
            </div>
          )}
        </SectionTabs>
      )}
    </>
  );
}
