export type Language = "en" | "es" | "ru" | "uk";
export type Intention =
  "task" | "conversation" | "sales" | "roleplay" | "prank";
export type Personality = "professional" | "warm" | "salesperson" | "playful";
export interface Voice {
  conversation_languages: Language[];
  dialogue_model: string;
  dialogue_provider: string | null;
  dialogue_fallback_providers: string[];
  reasoning_effort: string | null;
  dialogue_temperature: number | null;
  dialogue_max_tokens?: number;
  soniox_model: string;
  soniox_turn_detection: "semantic" | "vad";
  soniox_endpoint_delay_ms: number;
  soniox_endpoint_latency_level: number;
  soniox_endpoint_sensitivity: number;
  inworld_model: string;
  inworld_voice: string;
  inworld_delivery_mode: string | null;
  default_call_seconds: number;
  max_call_seconds: number;
}
export interface Global {
  prompts: {
    conversation: string;
    opening: string;
    intentions: Record<Intention, string>;
  };
  voice: Voice;
}
export interface Profile {
  name: string;
  description: string;
  personality: Personality;
  prompt: string;
  voice_overrides: Partial<Voice>;
  archived: boolean;
}
export interface Guide {
  text: string;
}
export interface Revision<T> {
  entity: string;
  revision: number;
  value: T;
  actor: string;
  created_at: string;
}
export interface Setup {
  guide: string;
  guide_revision: number;
  owner: { display_name: string; timezone: string };
  profiles: {
    id: string;
    name: string;
    description: string;
    personality: Personality;
    revision: number;
  }[];
  defaults: Voice;
  source_line: string;
}
export interface Session {
  csrf: string;
  owner_login: string;
  timezone: string;
  hermes_url: string;
  setup: Setup;
}
export interface Status {
  ready: boolean;
  sip_registered: boolean;
  source_line: string;
  phone: { phase: string; call_ready: boolean };
  active_call: string | null;
  practice_active: boolean;
  last_hermes_request: { observed_at: string } | null;
}
export interface Brief {
  owner: { display_name: string; timezone: string };
  target: { name: string; phone: string; organization?: string };
  objective: string;
  profile_id?: string;
  personality?: Personality;
  language: Language;
  intention: Intention;
  max_duration_seconds: number;
  relevant_facts: string[];
  allowed_commitments: string[];
  hard_constraints: string[];
  escalation: { mode: "end_call" };
  business?: {
    name: string;
    description: string;
    offer: string;
    desired_next_step: string;
    contact_permission: string;
  };
}
export interface Call {
  call_id: string;
  state: string;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  termination_reason: string | null;
  target: { name: string; phone: string };
  objective: string;
  language: Language;
  profile_id: string;
  personality: Personality;
}
export interface Turn {
  speaker: string;
  text: string;
  sequence_number?: number;
  created_at?: string;
  interrupted?: boolean;
  source_event_type?: string;
}
export interface Snapshot {
  effective_prompt?: string;
  profile_id: string;
  profile_name: string;
  profile_revision: number;
  configuration_revision: number;
  personality_prompt: string;
  prompts: Global["prompts"];
  voice: Voice;
  unsaved: boolean;
}
export interface Metric {
  seconds: number;
  measured_from: string;
  parts?: { stage: string; seconds: number }[];
  created_at?: string;
}
export interface AIInputContract {
  version: number;
  mode: "voice" | "text";
  system_prompt: string;
  prompt_sections: {
    id: string;
    label: string;
    source: string;
    editable: boolean;
    text: string;
  }[];
  model_options: {
    model: string;
    temperature?: number;
    max_tokens: number;
    [key: string]: unknown;
  };
  tools: {
    type: string;
    function: { name: string; description: string; parameters: unknown };
  }[];
  initial_request_example: unknown;
  runtime_messages: Record<string, unknown>;
  speech_settings: Record<string, unknown>;
  limits: Record<string, unknown>;
  scope: string;
}
export interface AIInputInspection {
  configured: AIInputContract | null;
  last_request: {
    recorded_at: string;
    bytes: number;
    body: {
      model?: string;
      messages?: unknown[];
      [key: string]: unknown;
    } | null;
    omitted: boolean;
    scope: string;
  } | null;
  saved_system_prompt?: string | null;
}
export interface Detail {
  call_id: string;
  state: string;
  transcript: Turn[];
  next_transcript_cursor: number | null;
  brief: Brief;
  configuration: Snapshot | null;
  prompt: string | null;
  annotation: { note: string; tags: string[] };
  timing: Pick<
    Call,
    | "created_at"
    | "answered_at"
    | "ended_at"
    | "duration_seconds"
    | "termination_reason"
  >;
  latency: Metric[];
  artifacts: { audio_status: string; files: { name: string }[] };
}
export interface Practice {
  id: string;
  mode: "voice" | "text";
  state: string;
  messages: Turn[];
  metrics: Metric[];
  error: string | null;
  configuration: Snapshot;
}
export interface Draft {
  profileId: string;
  global?: Global;
  profile?: Profile;
}
export const languages: Record<Language, string> = {
  en: "English",
  es: "Spanish",
  ru: "Russian",
  uk: "Ukrainian",
};
export const terminal = (state: string) =>
  ["completed", "failed", "timed_out", "transferred"].includes(state);
export const sampleBrief = (setup: Setup, profileId = "warm"): Brief => ({
  owner: setup.owner,
  target: { name: "Practice partner", phone: "+12025550100" },
  objective:
    "Have a relaxed conversation. Follow interesting details and answer questions naturally.",
  profile_id: profileId,
  language: "en",
  intention: "conversation",
  max_duration_seconds: setup.defaults.default_call_seconds,
  relevant_facts: [],
  allowed_commitments: [],
  hard_constraints: [],
  escalation: { mode: "end_call" },
});
