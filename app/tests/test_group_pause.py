"""Pausing a group stops logging and answering without deleting anything."""

import uuid
from datetime import UTC, datetime

import pytest
from conftest import GW, needs_db, post

pytestmark = needs_db


@pytest.fixture()
def group(client):
    import groups

    row = groups.create("whatsapp", f"test-{uuid.uuid4()}@g.us", name="Cabin crew")
    yield row
    groups.delete(row["id"])


def ingest(client, group, body):
    payload = {
        "wa_msg_id": f"m-{uuid.uuid4()}",
        "group_id": group["external_id"],
        "sender_jid": "anna@s.whatsapp.net",
        "sender_name": "Anna",
        "body": body,
        "ts": datetime.now(UTC).isoformat(),
    }
    assert client.post("/ingest", json=payload, headers=GW).status_code == 200


def stored(group):
    import db

    with db.connect() as conn:
        rows = conn.execute(
            "SELECT body FROM messages WHERE group_id = %s ORDER BY id", (group["external_id"],)
        ).fetchall()
    return [r["body"] for r in rows]


def last_audit(target):
    import db

    with db.connect() as conn:
        return conn.execute(
            "SELECT action FROM audit_log WHERE target = %s ORDER BY id DESC LIMIT 1", (target,)
        ).fetchone()["action"]


def test_pause_from_the_list_keeps_history_and_stops_logging(browser, client, group):
    import groups

    ingest(client, group, "before the pause")
    page = browser.get("/admin/groups").text
    assert f'action="/admin/groups/{group["id"]}/enabled"' in page and "Pause Cabin crew?" in page

    res = post(browser, f"/admin/groups/{group['id']}/enabled", enabled="false")
    assert "Paused Cabin crew" in browser.get(res.headers["location"]).text
    assert groups.get_by_id(group["id"])["enabled"] is False
    assert last_audit(group["external_id"]) == "group.pause"

    gateway_groups = client.get("/gateway/config", headers=GW).json()["groups"]
    assert group["external_id"] not in {g["external_id"] for g in gateway_groups}
    ingest(client, group, "while paused")
    assert stored(group) == ["before the pause"]
    assert "Resume" in browser.get("/admin/groups").text

    res = post(
        browser, f"/admin/groups/{group['id']}/enabled", enabled="true", back=f"/admin/groups/{group['id']}"
    )
    assert res.headers["location"] == f"/admin/groups/{group['id']}"
    assert "Resumed Cabin crew" in browser.get(res.headers["location"]).text
    assert last_audit(group["external_id"]) == "group.resume"
    ingest(client, group, "after resuming")
    assert stored(group) == ["before the pause", "after resuming"]


def test_the_settings_form_says_paused_instead_of_saved(browser, group):
    page = browser.get(f"/admin/groups/{group['id']}").text
    assert "data-confirm-off=" in page
    res = post(browser, f"/admin/groups/{group['id']}", name="Cabin crew", confidence_threshold="0")
    assert "Paused Cabin crew" in browser.get(res.headers["location"]).text
    assert last_audit(group["external_id"]) == "group.pause"
    # A save that leaves the state alone is just a save.
    res = post(browser, f"/admin/groups/{group['id']}", name="Cabin crew", confidence_threshold="0")
    assert "Saved." in browser.get(res.headers["location"]).text


def test_a_paused_group_can_still_be_asked_from_the_panel(browser, group):
    post(browser, f"/admin/groups/{group['id']}/enabled", enabled="false")
    page = browser.get("/admin/questions").text
    assert f'<option value="{group["id"]}">Cabin crew (paused)</option>' in page


def test_back_cannot_leave_the_site(browser, group):
    res = post(browser, f"/admin/groups/{group['id']}/enabled", enabled="false", back="https://evil.example/")
    assert res.headers["location"] == "/admin"
