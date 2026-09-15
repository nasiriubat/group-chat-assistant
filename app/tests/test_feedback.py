"""Every action tells the admin what happened: a toast after a page load, a
toast after an htmx call, and a readable error instead of silence or JSON."""

import json
import uuid

from conftest import needs_db, post

pytestmark = needs_db

HX = {"hx-request": "true"}


def toast_of(res):
    return json.loads(res.headers["hx-trigger"])["toast"]


def test_a_flash_is_a_toast_and_an_error_one_is_an_alert(browser):
    import channels

    channels.upsert("telegram", {"token": "123:abc"})
    res = post(browser, "/admin/channels/telegram/delete")
    page = browser.get(res.headers["location"]).text
    assert 'class="toast ok" role="status"' in page and "Removed Telegram" in page
    res = post(browser, "/admin/channels/whatsapp/delete")
    page = browser.get(res.headers["location"]).text
    assert 'class="toast bad" role="alert"' in page and "cannot be removed" in page
    assert channels.get("whatsapp") is not None


def test_an_htmx_poll_does_not_eat_the_flash_meant_for_the_next_page(browser):
    import channels

    channels.upsert("telegram", {"token": "123:abc"})
    post(browser, "/admin/channels/telegram/delete")
    browser.get("/admin/documents/table", headers=HX)
    assert "Removed Telegram" in browser.get("/admin/channels").text


def test_an_htmx_error_is_readable_html_with_a_toast(browser):
    res = browser.post(
        "/admin/questions/ask",
        data={"group_id": "999999999", "question": "hello"},
        headers={**HX, "x-csrf-token": browser.csrf},
    )
    assert res.status_code == 404 and res.text.startswith('<div class="notice bad"')
    assert toast_of(res)["kind"] == "bad"


def test_a_signed_out_htmx_call_sends_the_whole_tab_to_sign_in(client):
    client.cookies.clear()
    res = client.post(
        "/admin/providers/1/test",
        headers={**HX, "hx-current-url": "http://localhost:8000/admin/providers?x=1"},
        follow_redirects=False,
    )
    assert res.status_code == 401
    # The page's own query is encoded, so every filter survives the trip through sign-in.
    assert res.headers["hx-redirect"] == "/admin/login?next=/admin/providers%3Fx%3D1"


def test_a_provider_test_result_is_a_toast_as_well(browser, monkeypatch):
    import admin_api
    import groups
    import providers

    monkeypatch.setattr(providers, "check", lambda p: "fine")
    before = groups.global_settings()["default_provider_id"]
    row = admin_api.add_provider({"name": "Toasty", "kind": "openai", "api_key": "k", "model": "m"})
    try:
        res = browser.post(f"/admin/providers/{row['id']}/test", headers={**HX, "x-csrf-token": browser.csrf})
        assert "OK" in res.text and toast_of(res) == {"kind": "ok", "text": 'OK, replied "fine"'}
    finally:
        providers.delete(row["id"])
        groups.set_global(default_provider_id=before)


def test_actions_that_used_to_say_nothing_now_do(browser):
    import gateway_state
    import groups

    res = post(
        browser, "/admin/groups", channel="whatsapp", external_id=f"test-{uuid.uuid4()}@g.us", name="Quiet"
    )
    try:
        assert "Added Quiet" in browser.get(res.headers["location"]).text
    finally:
        groups.delete(int(res.headers["location"].rsplit("/", 1)[1]))

    res = post(browser, "/admin/channels/whatsapp/relink")
    try:
        assert res.headers["location"] == "/setup/link" and "new QR code" in browser.get("/setup/link").text
    finally:
        gateway_state.take_relink()

    res = post(browser, "/admin/logout")
    assert "Signed out" in browser.get(res.headers["location"]).text


def test_a_backslash_or_control_character_is_not_a_local_path():
    from admin import auth

    assert auth.safe_next("/\\evil.example") == "/admin"
    assert auth.safe_next("/admin/x\n") == "/admin"
    assert auth.safe_next("/admin/groups?x=1") == "/admin/groups?x=1"


def test_an_old_flash_is_ignored_even_if_the_browser_kept_it(browser, monkeypatch):
    import itsdangerous.timed

    import admin

    real = itsdangerous.timed.time.time
    monkeypatch.setattr(itsdangerous.timed.time, "time", lambda: real() - 3600)
    stale = admin._flash_signer().dumps({"kind": "ok", "text": "An hour old"})
    monkeypatch.undo()
    browser.cookies.set("flash", stale)
    assert "An hour old" not in browser.get("/admin").text


def test_a_refused_header_never_repeats_the_key(monkeypatch):
    import httpx
    import pytest

    from providers import http

    def refuse(*args, **kwargs):
        raise httpx.LocalProtocolError("Illegal header value b'Bearer sk-SECRET123 '")

    monkeypatch.setattr(httpx, "post", refuse)
    monkeypatch.setattr(httpx, "get", refuse)
    for call in (lambda: http.post("https://x.invalid", {}, {}), lambda: http.get("https://x.invalid", {})):
        with pytest.raises(httpx.TransportError) as refused:
            call()
        assert "sk-SECRET123" not in str(refused.value)


def test_a_bad_number_is_a_readable_error_not_a_crash(browser):
    res = browser.post(
        "/admin/data/questions/clear",
        data={"csrf": browser.csrf, "days": "soon"},
        headers={"accept": "text/html"},
    )
    assert res.status_code == 422 and "whole number" in res.text
