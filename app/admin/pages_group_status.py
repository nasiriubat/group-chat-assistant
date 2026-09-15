"""Pausing and resuming a group without deleting anything."""

from fastapi import APIRouter, Form, HTTPException

import admin
import audit
import groups
from admin import auth

pages = APIRouter()
actions = APIRouter()


def record(before, after):
    """Audit a pause or a resume and say what it means. None when the group's
    state did not change, so a plain settings save stays a plain save."""
    if before["enabled"] == after["enabled"]:
        return None
    name = after["name"] or after["external_id"]
    if after["enabled"]:
        audit.log("group.resume", after["external_id"])
        return (
            f"Resumed {name}. New messages are logged and answered again; "
            "what was said while paused was not kept."
        )
    audit.log("group.pause", after["external_id"])
    return (
        f"Paused {name}. New messages are no longer logged or answered. "
        "Its history, decisions and retention stay as they are."
    )


@actions.post("/groups/{group_id}/enabled")
def set_enabled(group_id: int, enabled: bool = Form(False), back: str = Form("/admin/groups")):
    before = groups.get_by_id(group_id)
    if before is None:
        raise HTTPException(404, "that group no longer exists")
    after = groups.update(group_id, enabled=enabled)
    name = after["name"] or after["external_id"]
    note = record(before, after) or f"{name} was already {'active' if enabled else 'paused'}."
    return admin.redirect(auth.safe_next(back), note)
