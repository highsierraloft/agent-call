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
  prompt_contract_version?: number;
  prompts: {
    conversation: string;
    opening: string;
    intentions?: Record<Intention, string>; // Historical revisions only.
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
  check_active?: boolean;
  check_id?: string | null;
  last_hermes_request: { observed_at: string } | null;
}
export interface Brief {
  owner: { display_name: string; timezone: string };
  target: {
    name: string;
    phone: string;
    organization?: string;
    background?: string;
  };
  objective: string;
  profile_id?: string;
  personality?: Personality;
  language: Language;
  intention?: Intention;
  completion_criteria?: string;
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
  outcome_status?: OutcomeStatus | null;
  pending_followups?: number;
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
  turn_id?: string;
  speaker: string;
  text: string;
  sequence_number?: number;
  created_at?: string;
  interrupted?: boolean;
  source_event_type?: string;
}
export interface Snapshot {
  prompt_contract_version?: number;
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
  assessment?: CallAssessment | null;
  followups?: Followup[];
  cost?: ProviderCost;
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
  max_duration_seconds: setup.defaults.default_call_seconds,
  relevant_facts: [],
  allowed_commitments: [],
  hard_constraints: [],
  escalation: { mode: "end_call" },
});

export type OutcomeStatus =
  "achieved" | "declined" | "incomplete" | "uncertain";
export type FollowupStatus =
  "needs_information" | "ready" | "completed" | "cancelled";
export interface SupportedFact {
  text: string;
  evidence_turn_ids: string[];
}
export interface CallAssessment {
  call_id: string;
  revision: number;
  actor: string;
  updated_at: string;
  value: {
    status: OutcomeStatus;
    explanation: string;
    evidence_turn_ids: string[];
    facts: SupportedFact[];
  };
}
export interface CallbackDraft {
  source_key: string;
  objective: string;
  source: "agent_promise" | "recipient_request" | "owner_request";
  needed_information: string[];
  evidence_turn_ids: string[];
  window_start: string | null;
  window_end: string | null;
  timezone: string | null;
}
export interface Followup {
  followup_id: string;
  source_call_id: string;
  revision: number;
  status: FollowupStatus;
  value: CallbackDraft & {
    new_facts?: string[];
    note: string;
    completion_call_id: string | null;
  };
  actor: string;
  created_at: string;
  updated_at: string;
  target: { name: string; phone: string };
  recipient_opted_out: boolean;
  attempts: {
    plan_id: string;
    call_id: string | null;
    state: string | null;
    created_at: string | null;
    ended_at: string | null;
    outcome: OutcomeStatus | null;
  }[];
}
export interface ProviderCost {
  currency: string;
  coverage: "complete" | "partial" | "unavailable" | "pending";
  total_usd: number | null;
  known_subtotal_usd: number | null;
  note: string;
  providers: {
    provider: string;
    usd: number | null;
    basis: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    requests_missing?: number;
    session_seconds?: number;
    input_characters?: number;
  }[];
  pricing?: { revision: number; rates: Pricing; captured_at: string };
}
export interface Pricing {
  soniox_usd_per_hour: number;
  inworld_tts2_usd_per_million_characters: number;
  inworld_flash_usd_per_million_characters: number;
  note: string;
}
export interface MonthlyCosts {
  month: string;
  timezone: string;
  currency: string;
  scope: string;
  call_count: number;
  coverage: { complete: number; partial: number; unavailable: number };
  known_subtotal_usd: number;
  providers: { provider: string; usd: number }[];
  calls: {
    call_id: string;
    created_at: string;
    target: string;
    state: string;
    duration_seconds: number | null;
    cost: ProviderCost;
  }[];
  next_offset: number | null;
}
export interface ConfigurationCheck {
  id: string;
  state:
    "running" | "stopping" | "passed" | "failed" | "cancelled" | "interrupted";
  configuration: Snapshot & { check_fingerprint: string };
  created_at: string;
  updated_at: string;
  scenario_count: number;
  scenario_names: string[];
  judge_model: string;
  scope: string;
  error: string | null;
  results: {
    name: string;
    status: "passed" | "failed" | "skipped";
    reason: string;
    duration_ms?: number;
    objective?: string;
    messages?: string[];
    responses: { type: string; text: string }[];
  }[];
}
