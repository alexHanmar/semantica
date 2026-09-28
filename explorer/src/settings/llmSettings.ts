export type LLMProvider = "anthropic" | "openai";
export type LLMCredentialType = "auth_token" | "api_key";

export interface LLMSavedCredential {
  id: string;
  label: string;
  provider: LLMProvider;
  credential_type: LLMCredentialType;
  model?: string;
  base_url?: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface LLMSettingsStatus {
  configured: boolean;
  saved: boolean;
  source: "saved" | "environment" | "none";
  provider?: LLMProvider;
  model?: string;
  base_url?: string;
  credential_type?: LLMCredentialType;
  has_credential: boolean;
  credential_source: "saved" | "environment" | "none";
  updated_at?: string;
  active_credential_id?: string;
  credentials: LLMSavedCredential[];
}

export interface LLMSettingsInput {
  provider: LLMProvider;
  model?: string;
  base_url?: string;
  credential_type: LLMCredentialType;
  credential?: string;
  credential_label?: string;
  credential_id?: string;
  active_credential_id?: string;
}

export const OPEN_LLM_SETTINGS_EVENT = "semantica:open-llm-settings";
export const LLM_SETTINGS_CHANGED_EVENT = "semantica:llm-settings-changed";

async function parseResponse(response: Response): Promise<LLMSettingsStatus> {
  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch {
      // Keep the generic status message.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<LLMSettingsStatus>;
}

export async function loadLLMSettings(): Promise<LLMSettingsStatus> {
  return parseResponse(await fetch("/api/settings/llm"));
}

export async function saveLLMSettings(input: LLMSettingsInput): Promise<LLMSettingsStatus> {
  return parseResponse(
    await fetch("/api/settings/llm", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteLLMSettings(): Promise<LLMSettingsStatus> {
  return parseResponse(await fetch("/api/settings/llm", { method: "DELETE" }));
}

export async function deleteLLMCredential(credentialId: string): Promise<LLMSettingsStatus> {
  return parseResponse(
    await fetch(`/api/settings/llm/credentials/${encodeURIComponent(credentialId)}`, { method: "DELETE" }),
  );
}

export function openGlobalLLMSettings() {
  window.dispatchEvent(new Event(OPEN_LLM_SETTINGS_EVENT));
}

export function notifyLLMSettingsChanged() {
  window.dispatchEvent(new Event(LLM_SETTINGS_CHANGED_EVENT));
}
