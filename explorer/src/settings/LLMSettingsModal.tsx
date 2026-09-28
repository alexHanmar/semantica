import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Save,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import {
  deleteLLMCredential,
  deleteLLMSettings,
  loadLLMSettings,
  notifyLLMSettingsChanged,
  saveLLMSettings,
  type LLMCredentialType,
  type LLMProvider,
  type LLMSavedCredential,
  type LLMSettingsStatus,
} from "./llmSettings";


const NEW_CREDENTIAL_VALUE = "__new_credential__";

interface LLMSettingsModalProps {
  open: boolean;
  onClose: () => void;
}


function providerLabel(provider?: LLMProvider) {
  return provider === "openai" ? "OpenAI-compatible" : "Anthropic / Claude";
}


export function LLMSettingsModal({ open, onClose }: LLMSettingsModalProps) {
  const [status, setStatus] = useState<LLMSettingsStatus | null>(null);
  const [provider, setProvider] = useState<LLMProvider>("anthropic");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [credentialType, setCredentialType] = useState<LLMCredentialType>("auth_token");
  const [credential, setCredential] = useState("");
  const [credentialLabel, setCredentialLabel] = useState("");
  const [credentialSelection, setCredentialSelection] = useState(NEW_CREDENTIAL_VALUE);
  const [editorMode, setEditorMode] = useState<"overview" | "new" | "edit">("overview");
  const [editingCredentialId, setEditingCredentialId] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "saving" | "switching" | "deleting" | "deleting-credential">("loading");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmCredentialDelete, setConfirmCredentialDelete] = useState<string | null>(null);

  const applyStatus = (next: LLMSettingsStatus) => {
    setStatus(next);
    const nextProvider = next.provider === "openai" ? "openai" : "anthropic";
    setProvider(nextProvider);
    setModel(next.model || "");
    setBaseUrl(next.base_url || "");
    setCredentialType(
      nextProvider === "openai"
        ? "api_key"
        : next.credential_type === "api_key"
          ? "api_key"
          : "auth_token",
    );
    setCredential("");
    setCredentialLabel("");
    setCredentialSelection(next.active_credential_id || NEW_CREDENTIAL_VALUE);
    setEditorMode("overview");
    setEditingCredentialId(null);
    setConfirmCredentialDelete(null);
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    loadLLMSettings()
      .then((next) => {
        if (!active) return;
        applyStatus(next);
        setState("idle");
      })
      .catch((error) => {
        if (!active) return;
        setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load settings" });
        setState("idle");
      });
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const savedCredentials = status?.credentials ?? [];
  const editingCredential = (status?.credentials ?? []).find(
    (item) => item.id === editingCredentialId,
  );
  const addingNewCredential = editorMode === "new";

  const beginAddCredential = () => {
    const active = (status?.credentials ?? []).find((item) => item.active);
    const nextProvider = active?.provider || status?.provider || "anthropic";
    const nextType = nextProvider === "openai"
      ? "api_key"
      : active?.credential_type || status?.credential_type || "auth_token";
    setProvider(nextProvider);
    setModel(active?.model || status?.model || "");
    setBaseUrl(active?.base_url || status?.base_url || "");
    setCredentialType(nextType);
    setCredential("");
    setCredentialLabel("");
    setCredentialSelection(NEW_CREDENTIAL_VALUE);
    setEditingCredentialId(null);
    setEditorMode("new");
    setConfirmCredentialDelete(null);
    setMessage(null);
  };

  const beginEditCredential = (item: LLMSavedCredential) => {
    setProvider(item.provider);
    setModel(item.model || "");
    setBaseUrl(item.base_url || "");
    setCredentialType(item.credential_type);
    setCredential("");
    setCredentialLabel(item.label);
    setCredentialSelection(item.id);
    setEditingCredentialId(item.id);
    setEditorMode("edit");
    setConfirmCredentialDelete(null);
    setMessage(null);
  };

  const closeEditor = () => {
    if (status) applyStatus(status);
    setMessage(null);
  };

  const handleSave = async () => {
    if (editorMode === "overview") return;
    if (addingNewCredential && !credential.trim()) {
      setMessage({ tone: "error", text: "Enter a new credential, or select a saved credential to activate." });
      return;
    }
    setState("saving");
    setMessage(null);
    setConfirmDelete(false);
    try {
      const next = await saveLLMSettings({
        provider,
        model: model.trim() || undefined,
        base_url: baseUrl.trim() || undefined,
        credential_type: provider === "openai" ? "api_key" : credentialType,
        credential: credential.trim() || undefined,
        credential_label: credentialLabel.trim() || undefined,
        credential_id: editorMode === "edit" ? editingCredentialId || undefined : undefined,
      });
      applyStatus(next);
      notifyLLMSettingsChanged();
      setMessage({
        tone: "success",
        text: addingNewCredential
          ? "New configuration card saved and activated."
          : `Updated “${editingCredential?.label || credentialLabel.trim()}”.`,
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not save settings" });
    } finally {
      setState("idle");
    }
  };

  const handleActivateCredential = async (item: LLMSavedCredential) => {
    setCredentialSelection(item.id);
    setCredential("");
    setCredentialLabel("");
    setConfirmCredentialDelete(null);
    if (item.active) {
      setMessage({ tone: "success", text: `“${item.label}” is already active.` });
      return;
    }

    setState("switching");
    setMessage(null);
    try {
      const next = await saveLLMSettings({
        provider: item.provider,
        model: item.model,
        base_url: item.base_url,
        credential_type: item.credential_type,
        active_credential_id: item.id,
      });
      applyStatus(next);
      notifyLLMSettingsChanged();
      setMessage({ tone: "success", text: `Switched to “${item.label}”.` });
    } catch (error) {
      setCredentialSelection(status?.active_credential_id || NEW_CREDENTIAL_VALUE);
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not switch credential" });
    } finally {
      setState("idle");
    }
  };

  const handleDeleteCredential = async (item: LLMSavedCredential) => {
    if (confirmCredentialDelete !== item.id) {
      setConfirmCredentialDelete(item.id);
      setMessage({ tone: "error", text: "Click Remove Key again to delete this saved credential." });
      return;
    }
    setState("deleting-credential");
    setMessage(null);
    try {
      const next = await deleteLLMCredential(item.id);
      applyStatus(next);
      notifyLLMSettingsChanged();
      setMessage({ tone: "success", text: `Removed “${item.label}”.` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not remove credential" });
    } finally {
      setState("idle");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setMessage({ tone: "error", text: "Click Delete again to remove the saved configuration." });
      return;
    }
    setState("deleting");
    setMessage(null);
    try {
      const next = await deleteLLMSettings();
      applyStatus(next);
      notifyLLMSettingsChanged();
      setConfirmDelete(false);
      setMessage({
        tone: "success",
        text: next.source === "environment"
          ? "Saved configuration deleted. Backend environment settings are still active."
          : "Saved LLM configuration deleted.",
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not delete settings" });
    } finally {
      setState("idle");
    }
  };

  const busy = state !== "idle";
  const sourceLabel = status?.source === "saved"
    ? "Saved globally"
    : status?.source === "environment"
      ? "Backend environment"
      : "Not configured";

  return (
    <div style={overlayStyle} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section style={modalStyle} role="dialog" aria-modal="true" aria-label="Global settings">
        <header style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={headerIconStyle}><Settings size={18} /></div>
            <div>
              <div style={{ color: "#ebf3ff", fontSize: 17, fontWeight: 800 }}>Global Settings</div>
              <div style={{ color: "#7d95b1", fontSize: 11, marginTop: 3 }}>Shared by all Explorer workspaces</div>
            </div>
          </div>
          <button type="button" onClick={onClose} style={iconButtonStyle} aria-label="Close settings">
            <X size={17} />
          </button>
        </header>

        <div style={bodyStyle}>
          <aside style={settingsNavStyle}>
            <div style={activeNavItemStyle}><KeyRound size={15} /> LLM Provider</div>
          </aside>

          <main style={contentStyle}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                {editorMode !== "overview" ? (
                  <button type="button" onClick={closeEditor} style={editorBackButtonStyle} aria-label="Back to credentials">
                    <ArrowLeft size={15} />
                  </button>
                ) : null}
                <div>
                  <h2 style={{ margin: 0, color: "#e8f2ff", fontSize: 16 }}>
                    {editorMode === "overview"
                      ? "LLM Configurations"
                      : editorMode === "new"
                        ? "Add Configuration"
                        : `Edit ${editingCredential?.label || "Configuration"}`}
                  </h2>
                  <p style={{ margin: "6px 0 0", color: "#7890ac", fontSize: 12, lineHeight: 1.55 }}>
                    {editorMode === "overview"
                      ? "Click a card to activate it. Use Edit or Add only when configuration fields need to change."
                      : editorMode === "new"
                        ? "Create a separate, switchable LLM configuration card."
                        : "Update this card without exposing its saved credential."}
                  </p>
                </div>
              </div>
              <span style={{ ...statusBadgeStyle, color: status?.configured ? "#78d9a8" : "#f2b66d" }}>
                {sourceLabel}
              </span>
            </div>

            {state === "loading" ? (
              <div style={loadingStyle}><Loader2 size={16} className="ws-spin" /> Loading configuration…</div>
            ) : editorMode === "overview" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
                <div style={fieldStyle}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <span style={labelStyle}>Saved Configurations</span>
                    <span style={credentialCountStyle}>{savedCredentials.length} saved</span>
                  </span>
                  <div style={credentialGridStyle}>
                    {savedCredentials.map((item) => {
                      const isSwitching = state === "switching" && credentialSelection === item.id;
                      return (
                        <article
                          key={item.id}
                          style={{
                            ...credentialEntityStyle,
                            borderColor: item.active
                              ? "rgba(76,195,138,0.5)"
                              : credentialSelection === item.id
                                ? "rgba(127,208,255,0.38)"
                                : "rgba(127,208,255,0.14)",
                            background: item.active
                              ? "rgba(76,195,138,0.08)"
                              : credentialSelection === item.id
                                ? "rgba(74,163,255,0.08)"
                                : "rgba(255,255,255,0.02)",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => handleActivateCredential(item)}
                            disabled={busy}
                            style={credentialEntityMainStyle}
                            aria-label={`${item.active ? "Active configuration" : "Switch to"} ${item.label}`}
                          >
                            <span style={credentialEntityHeaderStyle}>
                              <span style={{ ...credentialEntityIconStyle, color: item.active ? "#78d9a8" : "#7fd0ff" }}>
                                {isSwitching ? <Loader2 size={15} className="ws-spin" /> : <KeyRound size={15} />}
                              </span>
                              <span style={{ minWidth: 0 }}>
                                <span style={credentialEntityNameStyle}>{item.label}</span>
                                <span style={credentialEntityTypeStyle}>
                                  {providerLabel(item.provider)} · {item.credential_type === "auth_token" ? "Auth Token" : "API Key"}
                                </span>
                              </span>
                            </span>
                            <span style={credentialProfileModelStyle}>{item.model || "Model not specified"}</span>
                            {item.base_url ? <span style={credentialProfileBaseStyle}>{item.base_url}</span> : null}
                            <span style={{ ...credentialStateStyle, color: item.active ? "#78d9a8" : "#8fa8c6" }}>
                              {item.active ? <><CheckCircle2 size={12} /> Active</> : isSwitching ? "Switching…" : "Click card to switch"}
                            </span>
                          </button>
                          <span style={credentialEntityActionsStyle}>
                            <button
                              type="button"
                              onClick={() => beginEditCredential(item)}
                              disabled={busy}
                              style={credentialEntityActionStyle}
                              aria-label={`Edit ${item.label}`}
                              title={`Edit ${item.label}`}
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCredential(item)}
                              disabled={busy}
                              style={{ ...credentialEntityActionStyle, color: "#ff9e97" }}
                              aria-label={`Remove ${item.label}`}
                              title={`Remove ${item.label}`}
                            >
                              {state === "deleting-credential" && confirmCredentialDelete === item.id
                                ? <Loader2 size={12} className="ws-spin" />
                                : confirmCredentialDelete === item.id
                                  ? "Confirm"
                                  : <Trash2 size={12} />}
                            </button>
                          </span>
                        </article>
                      );
                    })}
                    <button
                      type="button"
                      onClick={beginAddCredential}
                      disabled={busy}
                      style={credentialAddCardStyle}
                    >
                      <span style={credentialAddIconStyle}><Plus size={16} /></span>
                      <span>
                        <span style={credentialEntityNameStyle}>Add configuration</span>
                        <span style={credentialEntityTypeStyle}>Create a new provider, model, endpoint, and key profile</span>
                      </span>
                    </button>
                  </div>
                  <span style={fieldHintStyle}>
                    {savedCredentials.length === 0
                      ? "No saved configurations yet. Add one to enable LLM-assisted workflows."
                      : savedCredentials.length === 1
                        ? "1 saved configuration. Add another card to create a switch target."
                        : `${savedCredentials.length} saved configurations. Click any inactive card to switch immediately.`}
                  </span>
                </div>
                <div style={securityNoteStyle}>
                  Cards keep their own provider, model, endpoint, and backend-only credential. Secrets are never returned to the browser.
                </div>
              </div>
            ) : (
              <div style={editorPanelStyle}>
                <div style={editorModeBannerStyle}>
                  <span style={credentialEntityIconStyle}>{editorMode === "new" ? <Plus size={15} /> : <Pencil size={15} />}</span>
                  <span>
                    <span style={credentialEntityNameStyle}>{editorMode === "new" ? "New configuration card" : editingCredential?.label}</span>
                    <span style={credentialEntityTypeStyle}>
                      {editorMode === "new" ? "This card becomes active after it is saved." : "Leave the credential blank to keep the current secret."}
                    </span>
                  </span>
                </div>

                <div style={twoColumnStyle}>
                  <label style={fieldStyle}>
                    <span style={labelStyle}>Card Name</span>
                    <input
                      value={credentialLabel}
                      onChange={(event) => setCredentialLabel(event.target.value)}
                      placeholder="e.g. Production Grok"
                      maxLength={80}
                      style={inputStyle}
                    />
                  </label>
                  <label style={fieldStyle}>
                    <span style={labelStyle}>Provider</span>
                    <select
                      value={provider}
                      onChange={(event) => {
                        const next = event.target.value as LLMProvider;
                        setProvider(next);
                        if (next === "openai") setCredentialType("api_key");
                      }}
                      style={inputStyle}
                    >
                      <option value="anthropic">Anthropic / Claude</option>
                      <option value="openai">OpenAI-compatible gateway</option>
                    </select>
                  </label>
                </div>

                <div style={twoColumnStyle}>
                  <label style={fieldStyle}>
                    <span style={labelStyle}>Model ID</span>
                    <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="e.g. grok-4.6" style={inputStyle} />
                  </label>
                  <label style={fieldStyle}>
                    <span style={labelStyle}>Credential Type</span>
                    {provider === "anthropic" ? (
                      <select value={credentialType} onChange={(event) => setCredentialType(event.target.value as LLMCredentialType)} style={inputStyle}>
                        <option value="auth_token">Auth Token</option>
                        <option value="api_key">API Key</option>
                      </select>
                    ) : (
                      <div style={{ ...inputStyle, color: "#7890ac" }}>API Key</div>
                    )}
                  </label>
                </div>

                <label style={fieldStyle}>
                  <span style={labelStyle}>API Base URL</span>
                  <input
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="https://your-gateway.example.com"
                    style={inputStyle}
                  />
                </label>

                <label style={fieldStyle}>
                  <span style={labelStyle}>{provider === "anthropic" && credentialType === "auth_token" ? "Auth Token" : "API Key"}</span>
                  <input
                    type="password"
                    value={credential}
                    onChange={(event) => setCredential(event.target.value)}
                    placeholder={editorMode === "edit" ? "Leave blank to keep the current credential" : "Enter credential"}
                    autoComplete="new-password"
                    style={inputStyle}
                  />
                </label>

                <div style={securityNoteStyle}>
                  Credentials use an owner-only backend settings file and are never returned to the browser.
                </div>
              </div>
            )}

            {message ? (
              <div style={{ ...messageStyle, color: message.tone === "success" ? "#78d9a8" : "#ff9e97", borderColor: message.tone === "success" ? "rgba(76,195,138,0.25)" : "rgba(255,123,114,0.28)" }}>
                {message.tone === "success" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                {message.text}
              </div>
            ) : null}
          </main>
        </div>

        <footer style={footerStyle}>
          {editorMode === "overview" ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy || !status?.saved}
              style={{ ...buttonStyle, ...dangerButtonStyle, opacity: !status?.saved ? 0.45 : 1 }}
            >
              {state === "deleting" ? <Loader2 size={14} className="ws-spin" /> : <Trash2 size={14} />}
              {confirmDelete ? "Confirm Delete" : "Delete All Configurations"}
            </button>
          ) : (
            <button type="button" onClick={closeEditor} disabled={busy} style={{ ...buttonStyle, ...secondaryButtonStyle }}>
              <ArrowLeft size={14} /> Back to Cards
            </button>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            {editorMode === "overview" ? (
              <>
                <button type="button" onClick={onClose} style={{ ...buttonStyle, ...secondaryButtonStyle }}>Close</button>
                <button type="button" onClick={beginAddCredential} disabled={busy} style={{ ...buttonStyle, ...primaryButtonStyle }}>
                  <Plus size={14} /> Add Configuration
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={closeEditor} disabled={busy} style={{ ...buttonStyle, ...secondaryButtonStyle }}>Cancel</button>
                <button type="button" onClick={handleSave} disabled={busy} style={{ ...buttonStyle, ...primaryButtonStyle }}>
                  {state === "saving" ? <Loader2 size={14} className="ws-spin" /> : <Save size={14} />}
                  {state === "saving" ? "Saving…" : editorMode === "new" ? "Save Configuration" : "Save Changes"}
                </button>
              </>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}


const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 1600, display: "grid", placeItems: "center",
  padding: 20, background: "rgba(2,7,14,0.78)", backdropFilter: "blur(8px)",
};
const modalStyle: React.CSSProperties = {
  width: "min(840px, 96vw)", maxHeight: "92vh", display: "flex", flexDirection: "column",
  overflow: "hidden", borderRadius: 18, border: "1px solid rgba(127,208,255,0.18)",
  background: "linear-gradient(180deg, rgba(11,21,34,0.99), rgba(6,13,22,0.99))",
  boxShadow: "0 32px 90px rgba(0,0,0,0.58)",
};
const headerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px",
  borderBottom: "1px solid rgba(127,208,255,0.12)",
};
const headerIconStyle: React.CSSProperties = {
  width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: 11,
  color: "#7fd0ff", background: "rgba(74,163,255,0.12)", border: "1px solid rgba(127,208,255,0.18)",
};
const iconButtonStyle: React.CSSProperties = {
  border: 0, background: "transparent", color: "#7890ac", cursor: "pointer", padding: 6,
};
const editorBackButtonStyle: React.CSSProperties = {
  width: 29, height: 29, display: "grid", placeItems: "center", flex: "0 0 auto", borderRadius: 8,
  color: "#8fa8c6", background: "rgba(255,255,255,0.035)", cursor: "pointer",
  border: "1px solid rgba(127,208,255,0.13)",
};
const bodyStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "170px 1fr", minHeight: 0, overflow: "auto" };
const settingsNavStyle: React.CSSProperties = {
  padding: 14, borderRight: "1px solid rgba(127,208,255,0.1)", background: "rgba(0,0,0,0.14)",
};
const activeNavItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "10px 11px", borderRadius: 9,
  color: "#e8f2ff", background: "rgba(74,163,255,0.12)", border: "1px solid rgba(127,208,255,0.18)",
  fontSize: 12, fontWeight: 700,
};
const contentStyle: React.CSSProperties = { padding: 22, display: "flex", flexDirection: "column", gap: 18, overflowY: "auto" };
const statusBadgeStyle: React.CSSProperties = {
  padding: "5px 9px", borderRadius: 999, border: "1px solid rgba(127,208,255,0.15)",
  background: "rgba(255,255,255,0.025)", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
};
const loadingStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, color: "#7890ac", fontSize: 12, padding: "32px 0" };
const fieldStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const labelStyle: React.CSSProperties = { color: "#8fa8c6", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em" };
const fieldHintStyle: React.CSSProperties = { color: "#6f88a5", fontSize: 10, lineHeight: 1.45 };
const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 9,
  border: "1px solid rgba(127,208,255,0.16)", background: "rgba(0,0,0,0.24)",
  color: "#ebf3ff", fontSize: 12, outline: "none",
};
const twoColumnStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
const credentialCountStyle: React.CSSProperties = {
  padding: "2px 7px", borderRadius: 999, color: "#7890ac", background: "rgba(255,255,255,0.035)",
  border: "1px solid rgba(127,208,255,0.12)", fontSize: 9, fontWeight: 700,
};
const credentialGridStyle: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 9,
};
const credentialEntityStyle: React.CSSProperties = {
  position: "relative", minHeight: 148, overflow: "hidden", borderRadius: 11,
  border: "1px solid", transition: "border-color 140ms ease, background 140ms ease",
};
const credentialEntityMainStyle: React.CSSProperties = {
  width: "100%", minHeight: 148, display: "flex", flexDirection: "column", justifyContent: "space-between",
  gap: 8, padding: "12px 74px 11px 12px", border: 0, background: "transparent", color: "inherit",
  textAlign: "left", cursor: "pointer",
};
const credentialEntityHeaderStyle: React.CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: 9, minWidth: 0,
};
const credentialEntityIconStyle: React.CSSProperties = {
  flex: "0 0 auto", width: 29, height: 29, display: "grid", placeItems: "center", borderRadius: 8,
  background: "rgba(74,163,255,0.1)", border: "1px solid rgba(127,208,255,0.14)",
};
const credentialEntityNameStyle: React.CSSProperties = {
  display: "block", overflow: "hidden", color: "#dcecff", fontSize: 12, fontWeight: 780,
  textOverflow: "ellipsis", whiteSpace: "nowrap",
};
const credentialEntityTypeStyle: React.CSSProperties = {
  display: "block", marginTop: 4, color: "#6f88a5", fontSize: 9.5, lineHeight: 1.35,
};
const credentialStateStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700,
};
const credentialProfileModelStyle: React.CSSProperties = {
  display: "block", overflow: "hidden", color: "#a9c2df", fontSize: 11, fontWeight: 700,
  textOverflow: "ellipsis", whiteSpace: "nowrap",
};
const credentialProfileBaseStyle: React.CSSProperties = {
  display: "block", overflow: "hidden", color: "#617994", fontSize: 9.5,
  textOverflow: "ellipsis", whiteSpace: "nowrap",
};
const credentialEntityActionsStyle: React.CSSProperties = {
  position: "absolute", zIndex: 2, top: 8, right: 8, display: "flex", gap: 5,
};
const credentialEntityActionStyle: React.CSSProperties = {
  minWidth: 27, height: 27, display: "grid", placeItems: "center", padding: "0 6px", borderRadius: 7,
  color: "#8fa8c6", cursor: "pointer", background: "rgba(6,13,22,0.72)",
  border: "1px solid rgba(127,208,255,0.14)", fontSize: 9,
};
const credentialAddCardStyle: React.CSSProperties = {
  minHeight: 148, display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: 11,
  color: "#dcecff", textAlign: "left", cursor: "pointer", border: "1px dashed rgba(127,208,255,0.2)",
  background: "rgba(74,163,255,0.035)",
};
const credentialAddIconStyle: React.CSSProperties = {
  flex: "0 0 auto", width: 29, height: 29, display: "grid", placeItems: "center", borderRadius: 8,
  color: "#7fd0ff", background: "rgba(74,163,255,0.11)", border: "1px solid rgba(127,208,255,0.18)",
};
const editorPanelStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 15, padding: 16, borderRadius: 12,
  background: "rgba(0,0,0,0.16)", border: "1px solid rgba(127,208,255,0.12)",
};
const editorModeBannerStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, padding: 11, borderRadius: 9,
  background: "rgba(74,163,255,0.055)", border: "1px solid rgba(127,208,255,0.12)",
};
const securityNoteStyle: React.CSSProperties = {
  padding: 11, borderRadius: 9, color: "#7890ac", background: "rgba(74,163,255,0.045)",
  border: "1px solid rgba(127,208,255,0.11)", fontSize: 11, lineHeight: 1.55,
};
const messageStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", borderRadius: 9,
  border: "1px solid", background: "rgba(0,0,0,0.16)", fontSize: 11,
};
const footerStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", gap: 12, padding: "14px 20px",
  borderTop: "1px solid rgba(127,208,255,0.12)",
};
const buttonStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
  padding: "8px 13px", borderRadius: 9, fontSize: 11, fontWeight: 700, cursor: "pointer",
};
const primaryButtonStyle: React.CSSProperties = { color: "#dff3ff", background: "rgba(74,163,255,0.2)", border: "1px solid rgba(127,208,255,0.3)" };
const secondaryButtonStyle: React.CSSProperties = { color: "#8fa8c6", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(127,208,255,0.13)" };
const dangerButtonStyle: React.CSSProperties = { color: "#ff9e97", background: "rgba(255,123,114,0.08)", border: "1px solid rgba(255,123,114,0.22)" };
