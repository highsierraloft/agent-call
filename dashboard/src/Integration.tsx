import { useEffect, useState } from "react";
import { ArrowUpRight, Plug, ChevronRight } from "lucide-react";
import { api, message } from "./api";
import { tabKeys } from "./a11y";
import type { Session, Setup, Status } from "./types";
import { ConfigurationEditor } from "./Profiles";

export default function Integration({
  session,
  onSaved,
  status,
}: {
  session: Session;
  onSaved: () => Promise<void>;
  status: Status | null;
}) {
  const [data, setData] = useState<{
      setup: Setup;
      tools: { name: string; description: string; parameters: unknown }[];
    } | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("guide");
  useEffect(() => {
    api<typeof data>("/integration")
      .then(setData)
      .catch((e) => setError(message(e)));
  }, []);
  return (
    <div className="integration-page">
      <section className="integration-heading">
        <div className="integration-mark">
          <Plug size={25} />
        </div>
        <div>
          <span className="eyebrow">HERMES CONNECTION</span>
          <h2>One source for calling instructions.</h2>
          <p className="muted">
            Hermes fetches the current guide and personality library before
            preparing a call.
          </p>
        </div>
        <a
          className="button"
          href={session.hermes_url}
          target="_blank"
          rel="noreferrer"
        >
          Open Hermes <ArrowUpRight size={15} />
        </a>
      </section>
      <p className="muted">
        Last MCP setup request:{" "}
        {status?.last_hermes_request?.observed_at
          ? new Date(status.last_hermes_request.observed_at).toLocaleString(
              "en-GB",
              { timeZone: session.timezone },
            )
          : "No request recorded yet"}
      </p>
      <div className="integration-flow">
        <span>Hermes</span>
        <ChevronRight size={16} />
        <span>Calling MCP</span>
        <ChevronRight size={16} />
        <span>Voice agent</span>
        <ChevronRight size={16} />
        <span>Spanish DIGI</span>
      </div>
      <div
        className="detail-tabs"
        role="tablist"
        aria-label="Integration details"
        onKeyDown={tabKeys}
      >
        <button
          role="tab"
          aria-selected={tab === "guide"}
          tabIndex={tab === "guide" ? 0 : -1}
          id="integration-tab-guide"
          aria-controls="integration-panel-guide"
          onClick={() => setTab("guide")}
        >
          Calling Instructions
        </button>
        <button
          role="tab"
          aria-selected={tab === "tools"}
          tabIndex={tab === "tools" ? 0 : -1}
          id="integration-tab-tools"
          aria-controls="integration-panel-tools"
          onClick={() => setTab("tools")}
        >
          Exposed Tools
        </button>
        <button
          role="tab"
          aria-selected={tab === "setup"}
          tabIndex={tab === "setup" ? 0 : -1}
          id="integration-tab-setup"
          aria-controls="integration-panel-setup"
          onClick={() => setTab("setup")}
        >
          Connection Guide
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {
        <div
          hidden={tab !== "guide"}
          role="tabpanel"
          id="integration-panel-guide"
          aria-labelledby="integration-tab-guide"
        >
          <ConfigurationEditor
            entity="guide"
            session={session}
            onSaved={onSaved}
          />
        </div>
      }
      {tab === "tools" && (
        <section
          className="integration-content"
          role="tabpanel"
          id="integration-panel-tools"
          aria-labelledby="integration-tab-tools"
        >
          <h3>What the MCP server exposes</h3>
          <p className="muted">
            These are the live tool descriptions and schemas. A tool being
            exposed does not prove that a phone call is ready.
          </p>
          {data?.tools.map((tool) => (
            <details className="tool-row" key={tool.name}>
              <summary>
                <code>{tool.name}</code>
              </summary>
              <p>{tool.description}</p>
              <details>
                <summary>Input schema</summary>
                <pre>{JSON.stringify(tool.parameters, null, 2)}</pre>
              </details>
            </details>
          ))}
        </section>
      )}
      {tab === "setup" && (
        <section
          className="integration-content reading"
          role="tabpanel"
          id="integration-panel-setup"
          aria-labelledby="integration-tab-setup"
        >
          <h3>Hermes setup</h3>
          <p>
            Your existing Hermes instance uses the private calling-agent MCP
            connection. It keeps its current account and model.
          </p>
          <ol>
            <li>
              Keep <code>calling-agent</code> enabled in Hermes’s MCP settings.
            </li>
            <li>
              Make <code>get_calling_setup</code> available alongside prepare,
              start, poll, end, and result tools.
            </li>
            <li>
              Before preparing a call, read the setup tool’s guide and choose a
              profile ID from its current library.
            </li>
            <li>
              Supply the recipient in <code>target.phone</code>. Omit owner
              callback fields; the server fills them in.
            </li>
            <li>
              Poll until completion, then return the full Markdown transcript
              and MP3 using their native file paths.
            </li>
          </ol>
          <p>
            Save calling-specific guidance in the Calling Instructions tab. Use
            Hermes’s dashboard for its own model, account, tools, and other
            tasks.
          </p>
          <details>
            <summary>Private connection template</summary>
            <pre>
              {JSON.stringify(
                {
                  name: "calling-agent",
                  url: "http://agent-call:8000/mcp/",
                  headers: {
                    Authorization: "Bearer <existing private MCP credential>",
                    "X-Agent-User-Id": "<configured owner ID>",
                  },
                },
                null,
                2,
              )}
            </pre>
            <p className="muted">
              This address is internal to Hermes’s private server network.
              Credentials remain in its existing private setup.
            </p>
          </details>
        </section>
      )}
    </div>
  );
}
