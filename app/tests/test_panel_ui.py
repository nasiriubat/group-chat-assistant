"""Channels and providers as cards with dialogs, and the searchable lists."""

import uuid

import pytest
from conftest import needs_db, post

pytestmark = needs_db

HX = {"hx-request": "true"}


def dialog(page, dialog_id):
    return page.split(f'id="{dialog_id}"')[1].split("</dialog>")[0]


@pytest.fixture()
def restore_default():
    import groups

    before = groups.global_settings()["default_provider_id"]
    yield
    groups.set_global(default_provider_id=before)


def test_every_channel_is_a_card_that_opens_its_own_dialog(browser):
    page = browser.get("/admin/channels").text
    for kind in ("whatsapp", "telegram", "discord", "slack", "whatsapp_cloud"):
        assert f'data-open="channel-{kind}"' in page and f'<dialog class="modal" id="channel-{kind}"' in page
    assert "data-open-on-load" not in page


def test_a_refused_channel_form_reopens_its_dialog_with_the_reason(browser):
    import channels

    res = post(browser, "/admin/channels/slack", bot_token="xapp-1", app_token="xoxb-1", enabled="true")
    assert res.status_code == 422
    slack = dialog(res.text, "channel-slack")
    assert "data-open-on-load" in slack and "swapped" in slack
    assert "xapp-1" not in res.text and channels.get("slack") is None


def test_the_card_toggle_switches_a_channel_without_retyping_its_token(browser):
    import channels

    channels.upsert("telegram", {"token": "123:abc"})
    try:
        post(browser, "/admin/channels/telegram")  # the Disable form sends no enabled field
        assert channels.get("telegram")["enabled"] is False
        post(browser, "/admin/channels/telegram", enabled="true")
        row = channels.get("telegram")
        assert row["enabled"] is True and row["config"] == {"token": "123:abc"}
    finally:
        channels.delete("telegram")


def test_a_refused_provider_edit_reopens_with_what_was_typed_but_not_the_key(browser, restore_default):
    import admin_api
    import providers

    row = admin_api.add_provider({"name": "Cardy", "kind": "openai", "api_key": "sk-secret", "model": "m"})
    try:
        page = browser.get("/admin/providers").text
        assert f'data-open="provider-{row["id"]}"' in page and 'data-open="provider-new"' in page
        res = post(browser, f"/admin/providers/{row['id']}", name="Renamed", model="m2", options="{broken")
        assert res.status_code == 422
        edit = dialog(res.text, f"provider-{row['id']}")
        assert "data-open-on-load" in edit and "not valid JSON" in edit and 'value="Renamed"' in edit
        assert "sk-secret" not in res.text and providers.get(row["id"])["name"] == "Cardy"
    finally:
        providers.delete(row["id"])


def test_a_refused_add_keeps_the_form_but_never_the_key(browser):
    import providers

    res = post(
        browser, "/admin/providers", name="Nope", kind="openai", api_key="sk-typed", model="m", price_in="-1"
    )
    assert res.status_code == 422
    new = dialog(res.text, "provider-new")
    assert "data-open-on-load" in new and 'value="Nope"' in new and "sk-typed" not in res.text
    assert not [p for p in providers.list_all() if p["name"] == "Nope"]
    res = post(browser, "/admin/providers", name="Nope", kind="openai", api_key="", model="m")
    assert res.status_code == 422 and "needs a name, an API key and a model" in res.text


def test_testing_unsaved_settings_uses_the_stored_key_and_saves_nothing(
    browser, monkeypatch, restore_default
):
    import admin_api
    import providers

    seen = {}
    monkeypatch.setattr(providers, "check", lambda p: seen.update(p) or "OK")
    row = admin_api.add_provider({"name": "Stored", "kind": "openai", "api_key": "sk-stored", "model": "old"})
    try:
        res = browser.post(
            "/admin/providers/check",
            data={"provider_id": str(row["id"]), "kind": "openai", "model": "new-model", "api_key": ""},
            headers={**HX, "x-csrf-token": browser.csrf},
        )
        assert res.status_code == 200 and "Nothing is saved" in res.text
        assert seen["model"] == "new-model" and seen["api_key"] == "sk-stored"
        assert providers.get(row["id"])["model"] == "old"
    finally:
        providers.delete(row["id"])


def test_a_pasted_key_loses_its_trailing_newline(client, restore_default):
    import admin_api
    import providers

    row = admin_api.add_provider({"name": " Spaced ", "kind": "openai", "api_key": "sk-x \n", "model": " m "})
    try:
        stored = providers.get(row["id"])
        assert (stored["api_key"], stored["model"], stored["name"]) == ("sk-x", "m", "Spaced")
    finally:
        providers.delete(row["id"])


def test_the_model_list_arrives_as_suggestions_for_the_model_field(browser, monkeypatch):
    import providers

    monkeypatch.setattr(providers, "models", lambda p: ["model-a", "model-b"])
    res = browser.post(
        "/admin/providers/models",
        data={"target": "model-new", "kind": "openai", "api_key": "k"},
        headers={**HX, "x-csrf-token": browser.csrf},
    )
    assert '<datalist id="model-new-options">' in res.text and res.text.count("<option") == 2
    assert 'data-open-list="model-new"' in res.text


def test_the_conversation_list_carries_what_the_filter_matches_on(browser):
    import gateway_state

    gateway_state.update("slack", connected=True, groups=[{"id": "sl:CFILTER", "subject": "Acme / #random"}])
    try:
        for path, list_id in (("/admin/groups", "seen"), ("/setup/groups", "wizard-seen")):
            page = browser.get(path).text
            assert f'data-filter="{list_id}" data-filter-key="channel"' in page
            assert f'data-filter="{list_id}" data-filter-key="text"' in page
            assert f'data-filter-count="{list_id}"' in page and f'data-filter-empty="{list_id}"' in page
            assert '<option value="slack">slack</option>' in page
            assert 'data-channel="slack" data-name="Acme / #random" data-id="sl:CFILTER"' in page
    finally:
        gateway_state.update("slack", connected=False, groups=[])


def test_quiet_hours_offer_every_time_zone_and_group_pickers_are_searchable(browser):
    import groups

    row = groups.create("whatsapp", f"test-{uuid.uuid4()}@g.us", name="Zones")
    try:
        page = browser.get(f"/admin/groups/{row['id']}").text
        assert '<select name="quiet_tz" data-search>' in page
        assert (
            "<option selected>Europe/Helsinki</option>" in page and "America/Argentina/Buenos_Aires" in page
        )
        assert 'name="group_id" required data-search' in browser.get("/admin/questions").text
    finally:
        groups.delete(row["id"])
