import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from semantica.explorer.llm_settings import (
    delete_saved_llm_credential,
    delete_saved_llm_settings,
    llm_settings_status,
    resolve_llm_runtime_config,
    save_llm_settings,
)


class TestLLMSettings(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.settings_file = Path(self.temp_dir.name) / "explorer-settings.json"
        self.env = patch.dict(
            os.environ,
            {
                "SEMANTICA_EXPLORER_SETTINGS_PATH": str(self.settings_file),
                "SEMANTICA_LLM_PROVIDER": "",
                "SEMANTICA_LLM_MODEL": "",
                "SEMANTICA_LLM_BASE_URL": "",
                "SEMANTICA_LLM_API_KEY": "",
                "ANTHROPIC_API_KEY": "",
                "ANTHROPIC_AUTH_TOKEN": "",
                "ANTHROPIC_MODEL": "",
                "ANTHROPIC_BASE_URL": "",
                "OPENAI_API_KEY": "",
                "OPENAI_MODEL": "",
                "OPENAI_BASE_URL": "",
                "SEMANTICA_ALLOW_ANONYMOUS": "true",
            },
            clear=False,
        )
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp_dir.cleanup()

    def test_round_trip_redacts_credential_and_uses_owner_only_permissions(self):
        save_llm_settings(
            provider="anthropic",
            model="grok-4.6",
            base_url="https://gateway.example.com/claude",
            credential_type="auth_token",
            credential="top-secret-token",
        )

        status = llm_settings_status()
        runtime = resolve_llm_runtime_config()

        self.assertTrue(status["configured"])
        self.assertTrue(status["saved"])
        self.assertEqual(status["provider"], "anthropic")
        self.assertEqual(status["credential_source"], "saved")
        self.assertEqual(len(status["credentials"]), 1)
        self.assertTrue(status["credentials"][0]["active"])
        self.assertNotIn("top-secret-token", repr(status))
        self.assertEqual(runtime["auth_token"], "top-secret-token")
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(self.settings_file.stat().st_mode), 0o600)

    def test_update_without_credential_preserves_saved_secret(self):
        save_llm_settings(
            provider="anthropic",
            credential_type="auth_token",
            credential="keep-me",
        )

        save_llm_settings(
            provider="anthropic",
            model="new-model",
            credential_type="auth_token",
        )

        runtime = resolve_llm_runtime_config()
        self.assertEqual(runtime["model"], "new-model")
        self.assertEqual(runtime["auth_token"], "keep-me")

    def test_legacy_single_credential_is_available_for_switching(self):
        self.settings_file.write_text(
            json.dumps(
                {
                    "version": 1,
                    "provider": "anthropic",
                    "credential_type": "auth_token",
                    "credential": "legacy-token",
                }
            ),
            encoding="utf-8",
        )

        status = llm_settings_status()

        self.assertEqual(status["active_credential_id"], "legacy-default")
        self.assertEqual(status["credentials"][0]["label"], "Saved credential")
        self.assertEqual(resolve_llm_runtime_config()["auth_token"], "legacy-token")
        self.assertNotIn("legacy-token", repr(status))

    def test_v2_global_fields_migrate_into_the_saved_card(self):
        self.settings_file.write_text(
            json.dumps(
                {
                    "version": 2,
                    "provider": "anthropic",
                    "model": "legacy-model",
                    "base_url": "https://legacy.example.com",
                    "credential_type": "auth_token",
                    "active_credential_id": "legacy-card",
                    "credentials": [
                        {
                            "id": "legacy-card",
                            "label": "Legacy card",
                            "provider": "anthropic",
                            "credential_type": "auth_token",
                            "credential": "legacy-card-token",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

        status = llm_settings_status()

        self.assertEqual(status["credentials"][0]["model"], "legacy-model")
        self.assertEqual(status["credentials"][0]["base_url"], "https://legacy.example.com")
        self.assertEqual(resolve_llm_runtime_config()["model"], "legacy-model")

    def test_multiple_credentials_can_be_saved_and_switched(self):
        save_llm_settings(
            provider="anthropic",
            model="primary-model",
            base_url="https://primary.example.com",
            credential_type="auth_token",
            credential="primary-token",
            credential_label="Primary",
        )
        first_status = llm_settings_status()
        primary_id = first_status["active_credential_id"]

        save_llm_settings(
            provider="anthropic",
            model="backup-model",
            base_url="https://backup.example.com",
            credential_type="auth_token",
            credential="backup-token",
            credential_label="Backup",
        )
        second_status = llm_settings_status()
        backup_id = second_status["active_credential_id"]

        self.assertNotEqual(primary_id, backup_id)
        self.assertEqual(len(second_status["credentials"]), 2)
        self.assertNotIn("primary-token", repr(second_status))
        self.assertNotIn("backup-token", repr(second_status))
        self.assertEqual(resolve_llm_runtime_config()["auth_token"], "backup-token")
        self.assertEqual(resolve_llm_runtime_config()["model"], "backup-model")

        save_llm_settings(
            provider="anthropic",
            credential_type="auth_token",
            active_credential_id=primary_id,
        )

        switched_status = llm_settings_status()
        self.assertEqual(switched_status["active_credential_id"], primary_id)
        self.assertEqual(resolve_llm_runtime_config()["auth_token"], "primary-token")
        self.assertEqual(resolve_llm_runtime_config()["model"], "primary-model")
        self.assertEqual(resolve_llm_runtime_config()["base_url"], "https://primary.example.com")
        self.assertTrue(
            next(item for item in switched_status["credentials"] if item["id"] == primary_id)["active"]
        )

    def test_explicit_add_creates_separate_cards_even_when_secret_is_reused(self):
        save_llm_settings(
            provider="anthropic",
            credential_type="auth_token",
            credential="shared-token",
            credential_label="Primary route",
        )
        first_id = llm_settings_status()["active_credential_id"]

        save_llm_settings(
            provider="anthropic",
            credential_type="auth_token",
            credential="shared-token",
            credential_label="Backup route",
        )
        status = llm_settings_status()

        self.assertEqual(len(status["credentials"]), 2)
        self.assertNotEqual(first_id, status["active_credential_id"])
        self.assertEqual(
            [item["label"] for item in status["credentials"]],
            ["Primary route", "Backup route"],
        )
        self.assertNotIn("shared-token", repr(status))

    def test_profile_can_be_edited_without_activating_it(self):
        save_llm_settings(
            provider="anthropic",
            model="first-model",
            credential_type="auth_token",
            credential="first-token",
            credential_label="First",
        )
        first_id = llm_settings_status()["active_credential_id"]
        save_llm_settings(
            provider="openai",
            model="second-model",
            base_url="https://second.example.com/v1",
            credential_type="api_key",
            credential="second-key",
            credential_label="Second",
        )
        second_id = llm_settings_status()["active_credential_id"]

        save_llm_settings(
            provider="anthropic",
            model="first-model-edited",
            base_url="https://first.example.com",
            credential_type="auth_token",
            credential="first-token-replaced",
            credential_label="First edited",
            credential_id=first_id,
        )

        status = llm_settings_status()
        self.assertEqual(status["active_credential_id"], second_id)
        self.assertEqual(resolve_llm_runtime_config()["api_key"], "second-key")
        edited = next(item for item in status["credentials"] if item["id"] == first_id)
        self.assertEqual(edited["label"], "First edited")
        self.assertEqual(edited["model"], "first-model-edited")
        self.assertEqual(edited["base_url"], "https://first.example.com")
        self.assertNotIn("first-token-replaced", repr(status))

        save_llm_settings(
            provider="anthropic",
            credential_type="auth_token",
            active_credential_id=first_id,
        )
        runtime = resolve_llm_runtime_config()
        self.assertEqual(runtime["auth_token"], "first-token-replaced")
        self.assertEqual(runtime["model"], "first-model-edited")

    def test_deleting_active_credential_falls_back_to_another_saved_key(self):
        save_llm_settings(
            provider="openai",
            credential_type="api_key",
            credential="first-key",
        )
        first_id = llm_settings_status()["active_credential_id"]
        save_llm_settings(
            provider="openai",
            credential_type="api_key",
            credential="second-key",
        )
        second_id = llm_settings_status()["active_credential_id"]

        self.assertTrue(delete_saved_llm_credential(second_id))
        status = llm_settings_status()

        self.assertEqual(status["active_credential_id"], first_id)
        self.assertEqual(resolve_llm_runtime_config()["api_key"], "first-key")
        self.assertFalse(delete_saved_llm_credential(second_id))

    def test_delete_removes_saved_configuration(self):
        save_llm_settings(
            provider="openai",
            credential_type="api_key",
            credential="delete-me",
        )

        self.assertTrue(delete_saved_llm_settings())
        self.assertFalse(self.settings_file.exists())
        self.assertFalse(llm_settings_status()["configured"])
        self.assertFalse(delete_saved_llm_settings())

    def test_environment_configuration_remains_after_saved_config_is_deleted(self):
        with patch.dict(
            os.environ,
            {"SEMANTICA_LLM_PROVIDER": "anthropic", "ANTHROPIC_API_KEY": "from-env"},
            clear=False,
        ):
            save_llm_settings(
                provider="anthropic",
                credential_type="auth_token",
                credential="saved-token",
            )
            delete_saved_llm_settings()
            status = llm_settings_status()

        self.assertTrue(status["configured"])
        self.assertFalse(status["saved"])
        self.assertEqual(status["source"], "environment")
        self.assertEqual(status["credential_source"], "environment")

    def test_rejects_invalid_base_url(self):
        with self.assertRaisesRegex(ValueError, "absolute http or https URL"):
            save_llm_settings(
                provider="anthropic",
                base_url="file:///tmp/gateway",
                credential_type="auth_token",
                credential="secret",
            )

if __name__ == "__main__":
    unittest.main()
