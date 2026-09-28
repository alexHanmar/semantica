"""Global Knowledge Explorer settings routes."""

from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, SecretStr

from ..llm_settings import (
    LLMSettingsError,
    delete_saved_llm_credential,
    delete_saved_llm_settings,
    llm_settings_status,
    save_llm_settings,
)


router = APIRouter(prefix="/api/settings", tags=["settings"])


class LLMSettingsUpdate(BaseModel):
    provider: Literal["anthropic", "openai"]
    model: Optional[str] = Field(default=None, max_length=256)
    base_url: Optional[str] = Field(default=None, max_length=2048)
    credential_type: Literal["auth_token", "api_key"] = "api_key"
    credential: Optional[SecretStr] = Field(default=None, max_length=8192)
    credential_label: Optional[str] = Field(default=None, max_length=80)
    credential_id: Optional[str] = Field(default=None, max_length=128)
    active_credential_id: Optional[str] = Field(default=None, max_length=128)


class SavedLLMCredentialStatus(BaseModel):
    id: str
    label: str
    provider: Literal["anthropic", "openai"]
    credential_type: Literal["auth_token", "api_key"]
    model: Optional[str] = None
    base_url: Optional[str] = None
    active: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class LLMSettingsStatus(BaseModel):
    configured: bool
    saved: bool
    source: Literal["saved", "environment", "none"]
    provider: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None
    credential_type: Optional[Literal["auth_token", "api_key"]] = None
    has_credential: bool
    credential_source: Literal["saved", "environment", "none"]
    updated_at: Optional[str] = None
    active_credential_id: Optional[str] = None
    credentials: List[SavedLLMCredentialStatus] = Field(default_factory=list)


@router.get("/llm", response_model=LLMSettingsStatus)
async def get_llm_settings():
    try:
        return llm_settings_status()
    except LLMSettingsError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/llm", response_model=LLMSettingsStatus)
async def update_llm_settings(body: LLMSettingsUpdate):
    credential = body.credential.get_secret_value() if body.credential else None
    try:
        save_llm_settings(
            provider=body.provider,
            model=body.model,
            base_url=body.base_url,
            credential_type=body.credential_type,
            credential=credential,
            credential_label=body.credential_label,
            credential_id=body.credential_id,
            active_credential_id=body.active_credential_id,
        )
        return llm_settings_status()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except LLMSettingsError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/llm", response_model=LLMSettingsStatus)
async def delete_llm_settings():
    try:
        delete_saved_llm_settings()
        return llm_settings_status()
    except LLMSettingsError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/llm/credentials/{credential_id}", response_model=LLMSettingsStatus)
async def delete_llm_credential(credential_id: str):
    try:
        deleted = delete_saved_llm_credential(credential_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Saved credential not found.")
        return llm_settings_status()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except LLMSettingsError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
