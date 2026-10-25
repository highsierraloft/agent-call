import { useEffect, useState } from "react";
import Calls from "./Calls";
import Followups from "./Followups";
import Costs from "./Costs";
import { SectionTabs } from "./Controls";
import type { Brief, Session } from "./types";

export default function CallsWorkspace({
  selected,
  session,
  navigate,
  onNew,
}: {
  selected?: string;
  session: Session;
  navigate: (path: string) => void;
  onNew: (brief?: Brief, followupId?: string) => void;
}) {
  const mode =
    selected === "followups" || selected === "costs" ? selected : "history";
  const [visited, setVisited] = useState(new Set([mode]));
  useEffect(() => setVisited((old) => new Set([...old, mode])), [mode]);
  return (
    <div className="calls-workspace">
      <SectionTabs
        label="Calls workspace"
        value={mode}
        onChange={(id) =>
          navigate(id === "history" ? "/calls" : "/calls/" + id)
        }
        items={[
          { id: "history", label: "History" },
          { id: "followups", label: "Follow-ups" },
          { id: "costs", label: "Costs" },
        ]}
      >
        {(visited.has("history") || mode === "history") && (
          <div className="calls-subview" hidden={mode !== "history"}>
            <Calls
              selected={mode === "history" ? selected : undefined}
              session={session}
              navigate={navigate}
              onNew={onNew}
            />
          </div>
        )}
        {(visited.has("followups") || mode === "followups") && (
          <div className="calls-subview" hidden={mode !== "followups"}>
            <Followups session={session} navigate={navigate} onNew={onNew} />
          </div>
        )}
        {(visited.has("costs") || mode === "costs") && (
          <div className="calls-subview" hidden={mode !== "costs"}>
            <Costs session={session} navigate={navigate} />
          </div>
        )}
      </SectionTabs>
    </div>
  );
}
