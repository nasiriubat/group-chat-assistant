// The panel's one script: what used to be inline attributes. Everything else
// is htmx. Behaviour hangs off data attributes so the templates stay HTML.
document.addEventListener("submit", (e) => {
  const form = e.target;
  const stop = () => e.preventDefault();

  // A destructive action names what it destroys; typing it back is the confirmation.
  if (form.dataset.confirmTyped) {
    const typed = prompt(form.dataset.confirm || `Type ${form.dataset.confirmTyped} to continue`);
    if (typed !== form.dataset.confirmTyped) stop();
    return;
  }
  if (form.dataset.confirm && !confirm(form.dataset.confirm)) return stop();

  // Unticking a box that turns something live off.
  const box = form.querySelector("[data-confirm-off]");
  if (box && box.defaultChecked && !box.checked && !confirm(box.dataset.confirmOff)) return stop();

  // Lines added to a list that erases history when saved.
  const list = form.querySelector("[data-confirm-added]");
  if (list) {
    const before = new Set((list.dataset.original || "").split("\n").map((s) => s.trim()).filter(Boolean));
    const added = list.value.split(/[\n,]/).map((s) => s.trim()).filter((s) => s && !before.has(s));
    if (added.length && !confirm(list.dataset.confirmAdded.replace("{ids}", added.join(", ")))) return stop();
  }
});

// A range shows its value next to it.
document.addEventListener("input", (e) => {
  if (!e.target.matches("[data-mirror]")) return;
  const out = e.target.parentElement.querySelector("output");
  if (out) out.value = e.target.value;
});

// ---------- toasts ----------
// The result of an action: the server's flash on a full page, a "toast" event
// from an HX-Trigger header after an htmx call, or a failed request nobody
// else reported. Errors stay until dismissed; they usually need reading twice.
const TOAST_MS = 6000;

function arm(el) {
  if (!el.classList.contains("bad")) setTimeout(() => el.remove(), TOAST_MS);
}

function toast(text, kind = "ok") {
  const box = document.getElementById("toasts");
  if (!box || !text) return;
  // A poll failing every few seconds is one problem, not a pile of them.
  if ([...box.querySelectorAll(".toast span")].some((s) => s.textContent === text)) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.setAttribute("role", kind === "bad" ? "alert" : "status");
  const span = document.createElement("span");
  span.textContent = text;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";
  el.append(span, close);
  box.append(el);
  arm(el);
}

document.querySelectorAll(".toast").forEach(arm);
document.addEventListener("click", (e) => {
  if (e.target.matches(".toast-close")) e.target.closest(".toast").remove();
});
document.addEventListener("toast", (e) => {
  const d = e.detail?.value ?? e.detail ?? {};
  toast(d.text, d.kind);
});
document.addEventListener("htmx:responseError", (e) => {
  const xhr = e.detail.xhr;
  // The panel's own errors already carry a toast, or send the tab to sign in.
  if (xhr.getResponseHeader("HX-Trigger") || xhr.getResponseHeader("HX-Redirect")) return;
  toast(`The panel answered ${xhr.status}. Reload the page and try again.`, "bad");
});
for (const failure of ["htmx:sendError", "htmx:timeout"]) {
  document.addEventListener(failure, () => toast("Could not reach the panel. Is it still running?", "bad"));
}

// A dropdown that fills a text field (the model picker).
document.addEventListener("change", (e) => {
  if (!e.target.matches("[data-fill]")) return;
  const target = document.getElementById(e.target.dataset.fill);
  if (target && e.target.value) {
    target.value = e.target.value;
    target.classList.add("filled");
  }
});
