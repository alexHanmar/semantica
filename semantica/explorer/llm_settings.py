"""Persistent, redacted LLM settings for the Knowledge Explorer."""

from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse


_SETTINGS_PATH_ENV = "SEMANTICA_EXPLORER_SETTINGS_PATH"
_MAX_SETTINGS_BYTES = 64 * 1024
_MAX_SAVED_CREDENTIALS = 20
_ALLOWED_PROVIDERS = frozenset({"anthropic", "openai"})
_ALLOWED_CREDENTIAL_TYPES = frozenset({"auth_token", "api_key"})
_settings_lock = threading.RLock()


class LLMSettingsError(RuntimeError):
    """Raised when the persisted Explorer settings cannot be read or written."""


def settings_path() -> Path:
    """Return the settings path, allowing deployments to override the default."""
    configured = os.environ.get(_SETTINGS_PATH_ENV)
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".semantica" / "explorer-settings.json"


def _optional_text(value: Any, field: str, max_length: int) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string.")
    cleaned = value.strip()
    if not cleaned:
        return None
    if len(cleaned) > max_length:
        raise ValueError(f"{field} must be at most {max_length} characters.")
    return cleaned


def _validate_base_url(value: Any) -> Optional[str]:
    base_url = _optional_text(value, "base_url", 2048)
    if base_url is None:
        return None
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("base_url must be an absolute http or https URL.")
    return base_url.rstrip("/")


def _normalize_saved_credential(
    data: Any,
    index: int,
    *,
    default_model: Optional[str] = None,
    default_base_url: Optional[str] = None,
) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise ValueError(f"credentials[{index}] must be an object.")

    credential_id = _optional_text(data.get("id"), f"credentials[{index}].id", 128)
    if credential_id is None:
        raise ValueError(f"credentials[{index}].id is required.")

    provider = str(data.get("provider", "")).strip().lower()
    if provider not in _ALLOWED_PROVIDERS:
        raise ValueError(f"credentials[{index}].provider is unsupported.")

    credential_type = str(data.get("credential_type", "")).strip().lower()
    if credential_type not in _ALLOWED_CREDENTIAL_TYPES:
        raise ValueError(f"credentials[{index}].credential_type is unsupported.")
    if provider != "anthropic" and credential_type != "api_key":
        raise ValueError("OpenAI-compatible saved credentials must be API keys.")

    credential = _optional_text(data.get("credential"), f"credentials[{index}].credential", 8192)
    if credential is None:
        raise ValueError(f"credentials[{index}].credential is required.")

    label = _optional_text(data.get("label"), f"credentials[{index}].label", 80)
    model = (
        _optional_text(data.get("model"), f"credentials[{index}].model", 256)
        if "model" in data
        else default_model
    )
    base_url = (
        _validate_base_url(data.get("base_url"))
        if "base_url" in data
        else default_base_url
    )
    created_at = _optional_text(data.get("created_at"), f"credentials[{index}].created_at", 128)
    updated_at = _optional_text(data.get("updated_at"), f"credentials[{index}].updated_at", 128)
    normalized = {
        "id": credential_id,
        "label": label or f"Saved credential {index + 1}",
        "provider": provider,
        "credential_type": credential_type,
        "credential": credential,
    }
    if model:
        normalized["model"] = model
    if base_url:
        normalized["base_url"] = base_url
    if created_at:
        normalized["created_at"] = created_at
    if updated_at:
        normalized["updated_at"] = updated_at
    return normalized


def _active_saved_credential(
    saved: Optional[Dict[str, Any]],
    provider: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    if not saved:
        return None
    active_id = saved.get("active_credential_id")
    for credential in saved.get("credentials", []):
        if credential.get("id") != active_id:
            continue
        if provider is not None and credential.get("provider") != provider:
            return None
        return credential
    return None


def _normalize_saved_settings(data: Any) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise LLMSettingsError("Explorer settings must contain a JSON object.")

    provider = str(data.get("provider", "")).strip().lower()
    if provider not in _ALLOWED_PROVIDERS:
        raise LLMSettingsError("Explorer settings contain an unsupported LLM provider.")

    credential_type = str(data.get("credential_type", "")).strip().lower()
    if credential_type not in _ALLOWED_CREDENTIAL_TYPES:
        credential_type = "auth_token" if provider == "anthropic" else "api_key"
    if provider != "anthropic":
        credential_type = "api_key"

    try:
        saved_version = int(data.get("version", 1))
    except (TypeError, ValueError):
        saved_version = 1

    normalized: Dict[str, Any] = {
        "version": 3,
        "provider": provider,
        "credential_type": credential_type,
    }
    model = _optional_text(data.get("model"), "model", 256)
    base_url = _validate_base_url(data.get("base_url"))
    updated_at = _optional_text(data.get("updated_at"), "updated_at", 128)

    raw_credentials = data.get("credentials")
    credentials = []
    if raw_credentials is not None:
        if not isinstance(raw_credentials, list):
            raise LLMSettingsError("Explorer settings credentials must be a list.")
        if len(raw_credentials) > _MAX_SAVED_CREDENTIALS:
            raise LLMSettingsError("Explorer settings contain too many saved credentials.")
        seen_ids = set()
        for index, item in enumerate(raw_credentials):
            credential = _normalize_saved_credential(
                item,
                index,
                default_model=model if saved_version < 3 else None,
                default_base_url=base_url if saved_version < 3 else None,
            )
            if credential["id"] in seen_ids:
                raise LLMSettingsError("Explorer settings contain duplicate credential IDs.")
            seen_ids.add(credential["id"])
            credentials.append(credential)
    else:
        # Migrate the original single-secret format in memory. The next write
        # persists it as a v2 credential entry without exposing the secret.
        legacy_credential = _optional_text(data.get("credential"), "credential", 8192)
        if legacy_credential:
            credentials.append(
                {
                    "id": "legacy-default",
                    "label": "Saved credential",
                    "provider": provider,
                    "credential_type": credential_type,
                    "credential": legacy_credential,
                    **({"model": model} if model else {}),
                    **({"base_url": base_url} if base_url else {}),
                    **({"created_at": updated_at} if updated_at else {}),
                    **({"updated_at": updated_at} if updated_at else {}),
                }
            )

    active_credential_id = _optional_text(
        data.get("active_credential_id"),
        "active_credential_id",
        128,
    )
    if not any(item["id"] == active_credential_id for item in credentials):
        matching_credentials = [item for item in credentials if item["provider"] == provider]
        fallback_credentials = matching_credentials or credentials
        active_credential_id = fallback_credentials[-1]["id"] if fallback_credentials else None

    if model:
        normalized["model"] = model
    if base_url:
        normalized["base_url"] = base_url
    normalized["credentials"] = credentials
    if active_credential_id:
        normalized["active_credential_id"] = active_credential_id
        active = next(item for item in credentials if item["id"] == active_credential_id)
        normalized["provider"] = active["provider"]
        normalized["credential_type"] = active["credential_type"]
        if active.get("model"):
            normalized["model"] = active["model"]
        else:
            normalized.pop("model", None)
        if active.get("base_url"):
            normalized["base_url"] = active["base_url"]
        else:
            normalized.pop("base_url", None)
    if updated_at:
        normalized["updated_at"] = updated_at
    return normalized


def _write_saved_llm_settings(path: Path, payload: Dict[str, Any]) -> None:
    serialized = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if len(serialized.encode("utf-8")) > _MAX_SETTINGS_BYTES:
        raise ValueError("Explorer LLM settings exceed the maximum saved size.")

    parent = path.parent
    temp_path = parent / f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    try:
        parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        fd = os.open(temp_path, flags, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
        os.chmod(path, 0o600)
    except OSError as exc:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise LLMSettingsError(f"Could not save Explorer LLM settings: {exc}") from exc


def load_saved_llm_settings() -> Optional[Dict[str, Any]]:
    """Load the saved settings, returning secrets only to backend callers."""
    path = settings_path()
    with _settings_lock:
        try:
            if not path.exists():
                return None
            if not path.is_file():
                raise LLMSettingsError("Explorer settings path is not a regular file.")
            if path.stat().st_size > _MAX_SETTINGS_BYTES:
                raise LLMSettingsError("Explorer settings file is unexpectedly large.")
            with path.open("r", encoding="utf-8") as handle:
                return _normalize_saved_settings(json.load(handle))
        except LLMSettingsError:
            raise
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            raise LLMSettingsError(f"Could not read Explorer LLM settings: {exc}") from exc


def _sync_payload_with_active_profile(
    payload: Dict[str, Any],
    credentials: list,
    active_credential_id: Optional[str],
) -> None:
    """Keep legacy top-level fields aligned with the active v3 profile."""
    payload.pop("active_credential_id", None)
    if not active_credential_id:
        return
    active = next(
        (item for item in credentials if item["id"] == active_credential_id),
        None,
    )
    if active is None:
        return
    payload["active_credential_id"] = active["id"]
    payload["provider"] = active["provider"]
    payload["credential_type"] = active["credential_type"]
    for key in ("model", "base_url"):
        if active.get(key):
            payload[key] = active[key]
        else:
            payload.pop(key, None)


def save_llm_settings(
    *,
    provider: str,
    model: Optional[str] = None,
    base_url: Optional[str] = None,
    credential_type: str = "api_key",
    credential: Optional[str] = None,
    credential_label: Optional[str] = None,
    credential_id: Optional[str] = None,
    active_credential_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Create, edit, or activate a backend-only LLM configuration profile."""
    normalized_provider = provider.strip().lower()
    if normalized_provider not in _ALLOWED_PROVIDERS:
        raise ValueError("provider must be 'anthropic' or 'openai'.")

    normalized_credential_type = credential_type.strip().lower()
    if normalized_credential_type not in _ALLOWED_CREDENTIAL_TYPES:
        raise ValueError("credential_type must be 'auth_token' or 'api_key'.")
    if normalized_provider != "anthropic" and normalized_credential_type != "api_key":
        raise ValueError("OpenAI-compatible providers require an API key.")

    normalized_model = _optional_text(model, "model", 256)
    normalized_base_url = _validate_base_url(base_url)
    normalized_credential = _optional_text(credential, "credential", 8192)
    normalized_label = _optional_text(credential_label, "credential_label", 80)
    editing_id = _optional_text(credential_id, "credential_id", 128)
    requested_active_id = _optional_text(active_credential_id, "active_credential_id", 128)
    if editing_id and requested_active_id:
        raise ValueError("Edit a credential or activate one, not both.")
    if normalized_credential and requested_active_id:
        raise ValueError("Provide a new credential or select a saved credential, not both.")

    path = settings_path()
    with _settings_lock:
        existing = load_saved_llm_settings()
        credentials = [dict(item) for item in (existing or {}).get("credentials", [])]
        current_active_id = (existing or {}).get("active_credential_id")
        now = datetime.now(timezone.utc).isoformat()

        if editing_id:
            editing = next(
                (item for item in credentials if item["id"] == editing_id),
                None,
            )
            if editing is None:
                raise ValueError("The credential being edited does not exist.")
            editing["provider"] = normalized_provider
            editing["credential_type"] = normalized_credential_type
            if normalized_label:
                editing["label"] = normalized_label
            if normalized_credential:
                editing["credential"] = normalized_credential
            for key, value in (("model", normalized_model), ("base_url", normalized_base_url)):
                if value:
                    editing[key] = value
                else:
                    editing.pop(key, None)
            editing["updated_at"] = now
        elif normalized_credential:
            if len(credentials) >= _MAX_SAVED_CREDENTIALS:
                raise ValueError(
                    f"At most {_MAX_SAVED_CREDENTIALS} LLM credentials can be saved."
                )
            type_label = "Auth Token" if normalized_credential_type == "auth_token" else "API Key"
            type_count = sum(
                1 for item in credentials
                if item["provider"] == normalized_provider
                and item["credential_type"] == normalized_credential_type
            )
            # An explicit "add" action always creates a new selectable entry.
            # Two profiles may intentionally share the same underlying secret
            # while carrying different names or serving as separate fallbacks.
            new_credential = {
                "id": f"cred_{uuid.uuid4().hex}",
                "label": normalized_label or f"{type_label} {type_count + 1}",
                "provider": normalized_provider,
                "credential_type": normalized_credential_type,
                "credential": normalized_credential,
                "created_at": now,
                "updated_at": now,
            }
            if normalized_model:
                new_credential["model"] = normalized_model
            if normalized_base_url:
                new_credential["base_url"] = normalized_base_url
            credentials.append(new_credential)
            current_active_id = new_credential["id"]
        elif requested_active_id:
            selected = next(
                (item for item in credentials if item["id"] == requested_active_id),
                None,
            )
            if selected is None:
                raise ValueError("The selected saved credential does not exist.")
            current_active_id = selected["id"]
        else:
            current = next(
                (item for item in credentials if item["id"] == current_active_id),
                None,
            )
            if current:
                current["provider"] = normalized_provider
                current["credential_type"] = normalized_credential_type
                for key, value in (("model", normalized_model), ("base_url", normalized_base_url)):
                    if value:
                        current[key] = value
                    else:
                        current.pop(key, None)
                current["updated_at"] = now
            else:
                current_active_id = None

        payload: Dict[str, Any] = {
            "version": 3,
            "provider": normalized_provider,
            "credential_type": normalized_credential_type,
            "credentials": credentials,
            "updated_at": now,
        }
        if normalized_model:
            payload["model"] = normalized_model
        if normalized_base_url:
            payload["base_url"] = normalized_base_url
        _sync_payload_with_active_profile(payload, credentials, current_active_id)

        _write_saved_llm_settings(path, payload)

        return _normalize_saved_settings(payload)


def delete_saved_llm_credential(credential_id: str) -> bool:
    """Delete one saved credential while retaining all other global settings."""
    normalized_id = _optional_text(credential_id, "credential_id", 128)
    if normalized_id is None:
        raise ValueError("credential_id is required.")

    path = settings_path()
    with _settings_lock:
        existing = load_saved_llm_settings()
        if not existing:
            return False
        credentials = [
            dict(item) for item in existing.get("credentials", [])
            if item["id"] != normalized_id
        ]
        if len(credentials) == len(existing.get("credentials", [])):
            return False

        payload = dict(existing)
        payload["version"] = 3
        payload["credentials"] = credentials
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        if existing.get("active_credential_id") == normalized_id:
            replacements = [
                item for item in credentials
                if item["provider"] == existing["provider"]
            ]
            if replacements:
                replacement = replacements[-1]
                current_active_id = replacement["id"]
            else:
                current_active_id = None
        else:
            current_active_id = existing.get("active_credential_id")

        _sync_payload_with_active_profile(payload, credentials, current_active_id)

        _write_saved_llm_settings(path, payload)
        return True


def delete_saved_llm_settings() -> bool:
    """Delete the saved settings file without changing environment variables."""
    path = settings_path()
    with _settings_lock:
        try:
            if not path.exists() and not path.is_symlink():
                return False
            if not path.is_file() and not path.is_symlink():
                raise LLMSettingsError("Explorer settings path is not a file.")
            path.unlink()
            return True
        except LLMSettingsError:
            raise
        except OSError as exc:
            raise LLMSettingsError(f"Could not delete Explorer LLM settings: {exc}") from exc


def _infer_environment_provider() -> Optional[str]:
    explicit = (os.environ.get("SEMANTICA_LLM_PROVIDER") or "").strip().lower()
    if explicit in _ALLOWED_PROVIDERS:
        return explicit
    if any(
        os.environ.get(name)
        for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL", "ANTHROPIC_BASE_URL")
    ):
        return "anthropic"
    if any(
        os.environ.get(name)
        for name in ("OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL")
    ):
        return "openai"
    return None


def _environment_config(provider: str) -> Dict[str, Any]:
    config: Dict[str, Any] = {"provider": provider}
    generic_model = os.environ.get("SEMANTICA_LLM_MODEL")
    generic_base_url = os.environ.get("SEMANTICA_LLM_BASE_URL")
    generic_api_key = os.environ.get("SEMANTICA_LLM_API_KEY")

    if provider == "anthropic":
        model = generic_model or os.environ.get("ANTHROPIC_MODEL")
        base_url = generic_base_url or os.environ.get("ANTHROPIC_BASE_URL")
        auth_token = os.environ.get("ANTHROPIC_AUTH_TOKEN")
        api_key = generic_api_key or os.environ.get("ANTHROPIC_API_KEY")
        if auth_token:
            config["auth_token"] = auth_token
            config["credential_type"] = "auth_token"
        elif api_key:
            config["api_key"] = api_key
            config["credential_type"] = "api_key"
    else:
        model = generic_model or os.environ.get("OPENAI_MODEL")
        base_url = generic_base_url or os.environ.get("OPENAI_BASE_URL")
        api_key = generic_api_key or os.environ.get("OPENAI_API_KEY")
        if api_key:
            config["api_key"] = api_key
            config["credential_type"] = "api_key"

    if model:
        config["model"] = model
    if base_url:
        config["base_url"] = base_url
    return config


def resolve_llm_runtime_config(overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Resolve request overrides over saved settings and environment defaults."""
    overrides = {key: value for key, value in (overrides or {}).items() if value is not None}
    saved = load_saved_llm_settings()
    override_provider = str(overrides.get("provider", "")).strip().lower() or None
    saved_provider = saved.get("provider") if saved else None
    provider = override_provider or saved_provider or _infer_environment_provider()
    if provider not in _ALLOWED_PROVIDERS:
        return {}

    runtime = _environment_config(provider)
    if saved and saved_provider == provider:
        for key in ("model", "base_url"):
            if saved.get(key):
                runtime[key] = saved[key]
        active_credential = _active_saved_credential(saved, provider)
        if active_credential:
            runtime.pop("api_key", None)
            runtime.pop("auth_token", None)
            credential_type = active_credential["credential_type"]
            runtime[credential_type] = active_credential["credential"]
            runtime["credential_type"] = credential_type

    runtime["provider"] = provider
    for key in ("model", "base_url"):
        if overrides.get(key):
            runtime[key] = overrides[key]
    if overrides.get("api_key"):
        runtime.pop("auth_token", None)
        runtime["api_key"] = overrides["api_key"]
        runtime["credential_type"] = "api_key"
    if overrides.get("auth_token"):
        runtime.pop("api_key", None)
        runtime["auth_token"] = overrides["auth_token"]
        runtime["credential_type"] = "auth_token"
    return runtime


def llm_settings_status() -> Dict[str, Any]:
    """Return a frontend-safe status object with all credential data redacted."""
    saved = load_saved_llm_settings()
    runtime = resolve_llm_runtime_config()
    has_credential = bool(runtime.get("api_key") or runtime.get("auth_token"))
    active_saved_credential = _active_saved_credential(
        saved,
        runtime.get("provider") or (saved.get("provider") if saved else None),
    )
    saved_has_credential = active_saved_credential is not None
    if saved_has_credential:
        credential_source = "saved"
    elif has_credential:
        credential_source = "environment"
    else:
        credential_source = "none"

    source = "saved" if saved else ("environment" if runtime.get("provider") else "none")
    return {
        "configured": bool(runtime.get("provider") and has_credential),
        "saved": saved is not None,
        "source": source,
        "provider": runtime.get("provider") or (saved.get("provider") if saved else None),
        "model": runtime.get("model") or (saved.get("model") if saved else None),
        "base_url": runtime.get("base_url") or (saved.get("base_url") if saved else None),
        "credential_type": runtime.get("credential_type")
        or (saved.get("credential_type") if saved else None),
        "has_credential": has_credential,
        "credential_source": credential_source,
        "updated_at": saved.get("updated_at") if saved else None,
        "active_credential_id": saved.get("active_credential_id") if saved_has_credential else None,
        "credentials": [
            {
                "id": item["id"],
                "label": item["label"],
                "provider": item["provider"],
                "credential_type": item["credential_type"],
                "model": item.get("model"),
                "base_url": item.get("base_url"),
                "active": bool(
                    saved_has_credential
                    and item["id"] == saved.get("active_credential_id")
                ),
                "created_at": item.get("created_at"),
                "updated_at": item.get("updated_at"),
            }
            for item in (saved or {}).get("credentials", [])
        ],
    }
