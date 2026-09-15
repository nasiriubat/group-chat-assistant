import json

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import HTMLResponse

import admin
import admin_api
import audit
import db
import groups
import providers

pages = APIRouter()
actions = APIRouter()

KIND_HELP = {
    "anthropic": "Anthropic. Model e.g. claude-opus-5 or claude-sonnet-5.",
    "gemini": "Google Gemini. Model e.g. gemini-3.8-flash.",
    "openai": "OpenAI-compatible: OpenAI, OpenRouter, LiteLLM proxy, Groq, Mistral, Together, Ollama. "
    "Set the base URL for anything but api.openai.com.",
}


def _options(raw):
    try:
        value = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        raise HTTPException(422, f"options is not valid JSON: {e}") from e
    if not isinstance(value, dict):
        raise HTTPException(422, "options must be a JSON object")
    return value


def _price(raw, field):
    # Taken as text, so a typo comes back inside the dialog instead of as a bare error page.
    try:
        return float(raw) if raw.strip() else 0.0
    except ValueError:
        raise HTTPException(422, f"{field} is not a number") from None


@pages.get("/providers", response_class=HTMLResponse)
def page(request: Request):
    return _render(request)


def _render(request, error=None, status_code=200):
    """Cards, a dialog per provider and one to add. `error` reopens the dialog
    whose form was refused, with what was typed (never the key) and why."""
    with db.connect() as conn:
        answered = {
            r["provider_id"]: r["n"]
            for r in conn.execute(
                "SELECT provider_id, count(*) AS n FROM query_log "
                "WHERE provider_id IS NOT NULL GROUP BY provider_id"
            )
        }
    used_by = {}
    for g in groups.list_all():
        if g["provider_id"] is not None:
            used_by[g["provider_id"]] = used_by.get(g["provider_id"], 0) + 1
    return admin.render(
        request,
        "providers.html",
        providers=providers.list_all(),
        default_id=groups.global_settings()["default_provider_id"],
        kinds={k: KIND_HELP.get(k, "") for k in providers.KINDS},
        answered=answered,
        used_by=used_by,
        error=error,
        status_code=status_code,
    )


def _refused(request, dialog, detail, typed):
    return _render(request, {"dialog": dialog, "message": admin.plain_error(detail), "values": typed}, 422)


@actions.post("/providers")
def create(
    request: Request,
    name: str = Form(""),
    kind: str = Form(""),
    api_key: str = Form(""),
    model: str = Form(""),
    base_url: str = Form(""),
    price_in: str = Form("0"),
    price_out: str = Form("0"),
    options: str = Form(""),
):
    typed = {"name": name, "kind": kind, "model": model, "base_url": base_url}
    typed |= {"price_in": price_in, "price_out": price_out, "options": options}
    try:
        if not (name.strip() and api_key.strip() and model.strip()):
            raise HTTPException(422, "a provider needs a name, an API key and a model")
        row = admin_api.add_provider(
            {
                "name": name.strip(),
                "kind": kind,
                "api_key": api_key,
                "model": model.strip(),
                "base_url": base_url.strip() or None,
                "price_in": _price(price_in, "price in"),
                "price_out": _price(price_out, "price out"),
                "options": _options(options),
            }
        )
    except HTTPException as e:
        if e.status_code != 422:
            raise
        return _refused(request, "provider-new", e.detail, typed)
    return admin.redirect("/admin/providers", f"Added {row['name']}. Press Test to make one real call.")


# Before the /providers/{provider_id} routes, or "models" and "check" are parsed as ids.
@actions.post("/providers/models", response_class=HTMLResponse)
def list_models(
    request: Request,
    target: str = Form(),
    kind: str = Form(),
    api_key: str = Form(""),
    base_url: str = Form(""),
    provider_id: str = Form(""),
):
    """Ask the provider what this key can use, as suggestions for the Model
    field. The key may be the one already stored, which is why an id is accepted."""
    if kind not in providers.KINDS:
        raise HTTPException(422, "unknown kind")
    stored = providers.get(int(provider_id)) if provider_id.strip() else None
    api_key = api_key.strip()
    if not api_key and stored is None:
        return _failed("Paste the key first.")
    probe = {
        "kind": kind,
        "api_key": api_key or stored["api_key"],
        "base_url": base_url or (stored["base_url"] if stored else None),
    }
    try:
        names = providers.models(probe)
    except Exception as e:  # any provider or network failure reads the same here
        return _failed(f"Could not list models: {e}")
    if not names:
        return _failed("The provider returned no models.")
    return admin.render(request, "model_picker.html", names=names, target=target)


@actions.post("/providers/check", response_class=HTMLResponse)
def check(
    kind: str = Form(""),
    model: str = Form(""),
    api_key: str = Form(""),
    base_url: str = Form(""),
    options: str = Form(""),
    provider_id: str = Form(""),
):
    """One real call with what the form holds, before anything is saved. An
    empty key field stands for the stored key, as on the model list."""
    stored = providers.get(int(provider_id)) if provider_id.strip().isdigit() else None
    kind = kind or (stored["kind"] if stored else "")
    api_key = api_key.strip()
    if kind not in providers.KINDS:
        return _failed("Pick a kind first.")
    if not (api_key or stored):
        return _failed("Paste the key first.")
    if not model.strip():
        return _failed("Type or pick a model first.")
    probe = {
        **(stored or {"name": "unsaved", "price_in": 0, "price_out": 0}),
        "kind": kind,
        "model": model.strip(),
        "api_key": api_key or stored["api_key"],
        "base_url": base_url.strip() or None,
        "options": _options(options),
    }
    try:
        reply = admin_api.check_provider(probe)
    except HTTPException as e:
        return _failed(f"Failed: {e.detail}")
    audit.log("provider.check", provider_id or "new", {"kind": kind, "model": probe["model"]})
    text = f'OK, replied "{reply[:60]}". Nothing is saved until you press Save.'
    return HTMLResponse(f'<span class="ok">{admin.escape(text)}</span>', headers=admin.toast(text))


def _failed(text):
    # 200, so htmx still swaps the reason in next to the button; the toast
    # says it too, for whoever was looking elsewhere.
    return HTMLResponse(f'<span class="bad">{admin.escape(text)}</span>', headers=admin.toast(text, "bad"))


@actions.post("/providers/{provider_id}")
def update(
    request: Request,
    provider_id: int,
    name: str = Form(""),
    model: str = Form(""),
    base_url: str = Form(""),
    price_in: str = Form("0"),
    price_out: str = Form("0"),
    options: str = Form(""),
    enabled: bool = Form(False),
    api_key: str = Form(""),
):
    typed = {"name": name, "model": model, "base_url": base_url, "enabled": enabled}
    typed |= {"price_in": price_in, "price_out": price_out, "options": options}
    try:
        if not (name.strip() and model.strip()):
            raise HTTPException(422, "a provider needs a name and a model")
        fields = {
            "name": name.strip(),
            "model": model.strip(),
            "base_url": base_url.strip() or None,
            "price_in": _price(price_in, "price in"),
            "price_out": _price(price_out, "price out"),
            "options": _options(options),
            "enabled": enabled,
        }
        if api_key:
            fields["api_key"] = api_key
        admin_api.apply_provider(provider_id, fields)
    except HTTPException as e:
        if e.status_code != 422:
            raise
        return _refused(request, f"provider-{provider_id}", e.detail, typed)
    return admin.redirect("/admin/providers", f"Saved {name.strip()}.")


@actions.post("/providers/{provider_id}/delete")
def delete(provider_id: int):
    row = providers.get(provider_id)
    admin_api.remove_provider(provider_id)
    return admin.redirect("/admin/providers", f"Deleted {row['name'] if row else 'the provider'}.")


@actions.post("/providers/{provider_id}/default")
def make_default(provider_id: int):
    if providers.get(provider_id) is None:
        raise HTTPException(404)
    groups.set_global(default_provider_id=provider_id)
    audit.log("settings.update", "global", {"default_provider_id": provider_id})
    row = providers.get(provider_id)
    return admin.redirect(
        "/admin/providers", f"{row['name']} now answers in every group without its own choice."
    )


@actions.post("/providers/{provider_id}/test", response_class=HTMLResponse)
def test(provider_id: int):
    try:
        reply = admin_api.run_provider_test(provider_id)
    except HTTPException as e:
        return _failed(f"Failed: {e.detail}")
    text = f'OK, replied "{reply[:60]}"'
    return HTMLResponse(f'<span class="ok">{admin.escape(text)}</span>', headers=admin.toast(text))
