import type { Page } from "@playwright/test";

export const voice = {
  conversation_languages: ["en", "es", "ru", "uk"],
  dialogue_model: "google/gemini-3.1-flash-lite",
  dialogue_provider: "google-ai-studio",
  dialogue_fallback_providers: ["google-vertex"],
  reasoning_effort: "none",
  dialogue_temperature: 0.4,
  soniox_model: "stt-rt-v5",
  soniox_turn_detection: "semantic",
  soniox_endpoint_delay_ms: 500,
  soniox_endpoint_latency_level: 2,
  soniox_endpoint_sensitivity: 0.3,
  inworld_model: "inworld-tts-2",
  inworld_voice: "Wade",
  inworld_delivery_mode: "CREATIVE",
  default_call_seconds: 1800,
  max_call_seconds: 7200,
};
export const globals = {
  voice,
  prompts: {
    conversation: "Speak naturally and leave room for the other person.",
    opening: "Give a short greeting and explain the purpose.",
    intentions: {
      task: "Complete the approved task.",
      conversation: "Follow the conversation.",
      sales: "Use only approved business facts.",
      roleplay: "Keep the fictional premise clear.",
      prank: "Keep it harmless and playful.",
    },
  },
};
export const profile = (name = "Warm") => ({
  name,
  description:
    name === "Warm"
      ? "Friendly, attentive conversations"
      : "A starting personality",
  personality: name.toLowerCase(),
  prompt: "Be friendly and attentive. Ask one useful question.",
  voice_overrides: {},
  archived: false,
});
export async function installFixture(page: Page) {
  const records: Record<string, any> = {
    global: {
      entity: "global",
      revision: 1,
      created_at: "2026-10-24T08:00:00Z",
      value: structuredClone(globals),
    },
    guide: {
      entity: "guide",
      revision: 1,
      created_at: "2026-10-24T08:00:00Z",
      value: {
        text: "Read the setup, prepare the call, and return its recording and transcript.",
      },
    },
  };
  for (const name of ["Warm", "Professional", "Salesperson", "Playful"])
    records["profile:" + name.toLowerCase()] = {
      entity: "profile:" + name.toLowerCase(),
      revision: 1,
      created_at: "2026-10-24T08:00:00Z",
      value: profile(name),
    };
  const histories: Record<string, any[]> = {};
  for (const [key, value] of Object.entries(records))
    histories[key] = [structuredClone(value)];
  const state = {
    records,
    histories,
    prepared: 0,
    started: 0,
    ended: 0,
    paginate: false,
    practiceStarts: 0,
    practiceStops: 0,
    onPracticeStop: null as null | (() => void),
    practice: null as any,
    active: null as string | null,
    brief: null as any,
    annotation: { note: "", tags: [] as string[] },
  };
  const setup = () => ({
    guide: records.guide.value.text,
    guide_revision: records.guide.revision,
    owner: { display_name: "Owner", timezone: "Atlantic/Canary" },
    profiles: Object.entries(records)
      .filter(([k, v]) => k.startsWith("profile:") && !v.value.archived)
      .map(([k, v]) => ({
        id: k.slice(8),
        revision: v.revision,
        name: v.value.name,
        personality: v.value.personality,
        description: v.value.description,
      })),
    defaults: records.global.value.voice,
    source_line: "Spanish DIGI",
  });
  const brief = {
    owner: setup().owner,
    target: { name: "Alex Morgan", phone: "+12025550110" },
    objective: "Arrange a time for a weekend walk.",
    language: "en",
    intention: "task",
    personality: "warm",
    profile_id: "warm",
    max_duration_seconds: 1800,
    relevant_facts: ["Available on Saturday afternoon."],
    allowed_commitments: ["Agree on a meeting time."],
    hard_constraints: ["Do not change other plans."],
    escalation: { mode: "end_call" },
  };
  const snapshot = {
    profile_id: "warm",
    profile_name: "Warm",
    profile_revision: 1,
    configuration_revision: 1,
    personality_prompt: records["profile:warm"].value.prompt,
    prompts: globals.prompts,
    voice,
    unsaved: false,
  };
  const calls = [
    {
      call_id: "call_demo_1",
      state: "completed",
      created_at: "2026-10-24T08:20:00Z",
      answered_at: "2026-10-24T08:20:12Z",
      ended_at: "2026-10-24T08:22:12Z",
      duration_seconds: 120,
      termination_reason: "assistant_finished",
      target: brief.target,
      objective: brief.objective,
      language: "en",
      profile_id: "warm",
      personality: "warm",
    },
    {
      call_id: "call_demo_2",
      state: "completed",
      created_at: "2026-10-23T13:00:00Z",
      answered_at: "2026-10-23T13:00:12Z",
      ended_at: "2026-10-23T13:01:00Z",
      duration_seconds: 48,
      termination_reason: "callee_hangup",
      target: { name: "Bookshop", phone: "+34911555101" },
      objective: "Ask about tomorrow’s opening hours.",
      language: "es",
      profile_id: "professional",
      personality: "professional",
    },
  ];
  await page.route("**/admin/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace("/admin/api", ""),
      method = request.method(),
      body = request.postDataJSON?.();
    const respond = (json: any, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(json),
      });
    if (path === "/session")
      return respond({
        csrf: "local-test-csrf",
        owner_login: "owner@example.test",
        timezone: "Atlantic/Canary",
        hermes_url: "https://example.ts.net:8443",
        setup: setup(),
      });
    if (path === "/status")
      return respond({
        ready: true,
        sip_registered: true,
        source_line: "Spanish DIGI",
        phone: { phase: "gateway_ready", call_ready: true },
        active_call: state.active,
        practice_active:
          !!state.practice &&
          !["stopped", "failed"].includes(state.practice.state),
        last_hermes_request: null,
      });
    if (path === "/profiles")
      return respond(
        Object.entries(records)
          .filter(([k]) => k.startsWith("profile:"))
          .map(([, v]) => v),
      );
    if (path.startsWith("/configuration/")) {
      const parts = path.split("/");
      const entity = decodeURIComponent(parts[2]);
      if (parts[3] === "history") return respond(histories[entity] || []);
      if (method === "GET")
        return records[entity]
          ? respond(records[entity])
          : respond({ detail: "Not found" }, 404);
      if (method === "PUT") {
        if ((records[entity]?.revision || 0) !== body.expected_revision)
          return respond(
            {
              detail:
                "This configuration changed in another window. Reload it before saving.",
            },
            409,
          );
        records[entity] = {
          entity,
          revision: body.expected_revision + 1,
          value: body.value,
          actor: "owner@example.test",
          created_at: "2026-10-24T10:00:00Z",
        };
        (histories[entity] ??= []).unshift(structuredClone(records[entity]));
        return respond(records[entity]);
      }
    }
    if (path === "/prompt-preview")
      return respond({
        prompt:
          "Your identity is an AI calling assistant.\n" +
          (body.overrides?.profile?.prompt ||
            records["profile:warm"].value.prompt) +
          "\nApproved brief: " +
          body.context.objective,
        configuration: snapshot,
      });
    if (path === "/integration")
      return respond({
        setup: setup(),
        tools: [
          {
            name: "get_calling_setup",
            description: "Read the current guide and available profiles.",
            parameters: { type: "object" },
          },
          {
            name: "prepare_phone_call",
            description: "Prepare a call without dialing.",
            parameters: { type: "object" },
          },
          {
            name: "start_phone_call",
            description: "Start an approved call.",
            parameters: { type: "object" },
          },
        ],
      });
    if (path === "/calls" && method === "GET") {
      const q = (url.searchParams.get("q") || "").toLowerCase(),
        filter = url.searchParams.get("state"),
        lang = url.searchParams.get("language");
      return respond({
        calls: calls
          .filter(
            (c) =>
              (!q || JSON.stringify(c).toLowerCase().includes(q)) &&
              (!filter || filter === c.state) &&
              (!lang || lang === c.language),
          )
          .slice(
            state.paginate && url.searchParams.has("cursor") ? 1 : 0,
            state.paginate && !url.searchParams.has("cursor") ? 1 : undefined,
          ),
        next_cursor:
          state.paginate && !url.searchParams.has("cursor")
            ? "next-page"
            : null,
      });
    }
    if (path === "/calls/prepare") {
      state.prepared++;
      state.brief = body.context;
      return respond({
        plan_id: "plan_local_test",
        confirmation_summary:
          "Call " + body.context.target.name + " to: " + body.context.objective,
        missing_fields: [],
      });
    }
    if (path === "/calls/start") {
      state.started++;
      state.active = "call_started";
      return respond({ call_id: state.active, state: "active" });
    }
    if (path.startsWith("/calls/")) {
      const parts = path.split("/"),
        id = parts[2],
        call = calls.find((c) => c.call_id === id) || {
          ...calls[0],
          call_id: id,
          state: state.active ? "active" : "completed",
        };
      if (parts[3] === "end") {
        state.ended++;
        state.active = null;
        return respond({ ended: true });
      }
      if (parts[3] === "annotation") {
        state.annotation = body;
        return route.fulfill({ status: 204 });
      }
      if (parts[3] === "files") {
        return route.fulfill({
          status: 200,
          contentType: "application/octet-stream",
          headers: {
            "content-disposition": 'attachment; filename="transcript.md"',
          },
          body: "# Call transcript\n\nThe full conversation.",
        });
      }
      return respond({
        call_id: id,
        state: call.state,
        brief: id === "call_started" ? state.brief : brief,
        configuration: id === "call_demo_2" ? null : snapshot,
        prompt: "Saved prompt for this call.",
        annotation: state.annotation,
        timing: call,
        latency: [
          {
            seconds: 1.14,
            measured_from: "server",
            parts: [
              { stage: "transcription", seconds: 0.4 },
              { stage: "model", seconds: 0.32 },
              { stage: "speech", seconds: 0.42 },
            ],
          },
        ],
        artifacts: {
          audio_status: "unavailable",
          files: [{ name: "transcript.md" }],
        },
        next_transcript_cursor: null,
        transcript: [
          {
            sequence_number: 1,
            speaker: "assistant",
            text: "Hi Alex, I’m calling for the owner about the weekend walk.",
            created_at: "2026-10-24T08:20:16Z",
          },
          {
            sequence_number: 2,
            speaker: "callee",
            text: "Saturday afternoon works. Can we meet by the park?",
            created_at: "2026-10-24T08:20:20Z",
          },
          {
            sequence_number: 3,
            speaker: "assistant",
            text: "That works. What time would suit you?",
            created_at: "2026-10-24T08:20:24Z",
          },
        ],
      });
    }
    if (path === "/practice" && method === "POST") {
      state.practiceStarts++;
      state.practice = {
        id: "practice_local",
        mode: body.mode,
        state: "waiting",
        messages: [],
        metrics: [],
        error: null,
        configuration: { ...snapshot, unsaved: !!body.overrides },
      };
      return respond(state.practice);
    }
    if (path === "/practice/practice_local/text") {
      state.practice.messages.push(
        { speaker: "callee", text: body.text },
        { speaker: "assistant", text: "What would you like to talk about?" },
      );
      state.practice.state = "ready";
      state.practice.metrics.push({ seconds: 0.96, measured_from: "text" });
      return respond(state.practice);
    }
    if (path === "/practice/practice_local" && method === "DELETE") {
      state.practiceStops++;
      state.practice.state = "stopped";
      state.onPracticeStop?.();
      return route.fulfill({ status: 204 });
    }
    if (path === "/practice/practice_local") return respond(state.practice);
    return respond({ detail: "Fixture route not found: " + path }, 404);
  });
  return state;
}
