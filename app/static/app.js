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
const OFFLINE = "Could not reach the panel. Is it still running?";
for (const failure of ["htmx:sendError", "htmx:timeout"]) {
  document.addEventListener(failure, () => toast(OFFLINE, "bad"));
}
// The panel answered again: the outage toast is no longer true.
document.addEventListener("htmx:afterRequest", (e) => {
  if (!e.detail.successful) return;
  document.querySelectorAll("#toasts .toast span").forEach((s) => s.textContent === OFFLINE && s.parentElement.remove());
});

// ---------- dialogs ----------
// data-open="id" opens that <dialog>; data-close closes the one it sits in; a
// click on the backdrop lands on the dialog element itself and closes it too.
// A dialog the server marks data-open-on-load holds a form that came back
// with an error, so it opens with the page.
document.addEventListener("click", (e) => {
  const opener = e.target.closest("[data-open]");
  if (opener) document.getElementById(opener.dataset.open)?.showModal();
  if (e.target.closest("[data-close]") || e.target.tagName === "DIALOG") e.target.closest("dialog")?.close();
});
document.querySelectorAll("dialog[data-open-on-load]").forEach((d) => d.showModal());

// ---------- searchable lists ----------
// data-search on a <select>, or on an <input list="…">, puts a filter box over
// its options. The real field stays in the form and is what gets submitted;
// an input keeps accepting free text (a model name the list does not know).
const SHOWN = 200; // a provider can return hundreds of models; typing narrows them

function searchable(field) {
  if (field.dataset.searchReady) return;
  field.dataset.searchReady = "1";
  const strict = field.tagName === "SELECT";
  const wrap = document.createElement("span");
  wrap.className = "search";
  field.before(wrap);
  const input = strict ? document.createElement("input") : field;
  const listId = field.getAttribute("list");
  if (strict) {
    input.type = "text";
    input.setAttribute("aria-label", field.getAttribute("aria-label") || field.name);
    field.hidden = true;
    wrap.append(input, field);
  } else {
    field.removeAttribute("list"); // the browser's own dropdown would open on top of ours
    wrap.append(field);
  }
  const list = document.createElement("ul");
  list.className = "search-list";
  list.id = `search-${Math.random().toString(36).slice(2, 10)}`;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  wrap.append(list);
  Object.assign(input, { autocomplete: "off" });
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");

  const current = () => field.selectedOptions?.[0]?.textContent.trim() ?? "";
  const options = () =>
    strict
      ? [...field.options].filter((o) => !o.disabled).map((o) => ({ value: o.value, label: o.textContent.trim() }))
      : [...(document.getElementById(listId)?.options ?? [])].map((o) => {
          // A datalist option may carry a name as its text: "Anna · 358401234567@s.whatsapp.net".
          const text = o.textContent.trim();
          return { value: o.value, label: text ? `${text} · ${o.value}` : o.value };
        });
  let shown = [];
  let active = -1;
  if (strict) input.value = current();

  function open(isOpen) {
    list.hidden = !isOpen;
    input.setAttribute("aria-expanded", String(isOpen));
    if (!isOpen) input.removeAttribute("aria-activedescendant");
  }
  function render(query) {
    const q = query.trim().toLowerCase();
    const all = options();
    shown = all.filter((o) => !q || o.label.toLowerCase().includes(q)).slice(0, SHOWN);
    active = -1;
    list.replaceChildren(
      ...shown.map((o, i) => {
        const li = document.createElement("li");
        Object.assign(li, { id: `${list.id}-${i}`, textContent: o.label });
        li.setAttribute("role", "option");
        li.dataset.index = i;
        return li;
      }),
    );
    const hidden = all.filter((o) => !q || o.label.toLowerCase().includes(q)).length - shown.length;
    if (hidden > 0 || !shown.length) {
      const note = document.createElement("li");
      note.className = "search-note";
      note.textContent = hidden > 0 ? `${hidden} more; keep typing` : strict ? "No match" : "Nothing listed; what you type is kept";
      list.append(note);
    }
    open(all.length > 0);
  }
  function move(step) {
    if (!shown.length) return;
    active = (active + step + shown.length) % shown.length;
    list.querySelectorAll("[role=option]").forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
    input.setAttribute("aria-activedescendant", `${list.id}-${active}`);
    document.getElementById(`${list.id}-${active}`).scrollIntoView({ block: "nearest" });
  }
  function pick(i) {
    const o = shown[i];
    if (!o) return;
    if (strict) {
      field.value = o.value;
      input.value = o.label;
      field.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      input.value = o.value;
    }
    open(false);
  }

  input.addEventListener("focus", () => {
    if (strict) input.select();
    render("");
  });
  input.addEventListener("input", () => render(input.value));
  input.addEventListener("blur", () => {
    open(false);
    if (strict) input.value = current();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.hidden) render(strict ? "" : input.value);
      move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" && !list.hidden && active >= 0) {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape" && !list.hidden) {
      // Close the list, not the dialog it may be in.
      e.preventDefault();
      e.stopPropagation();
      open(false);
    }
  });
  // mousedown, not click: the input must not lose focus (and close the list) first.
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("[role=option]");
    e.preventDefault();
    if (li) pick(Number(li.dataset.index));
  });
}

// ---------- list filters ----------
// A long list narrowed in the page: every control carries data-filter="<list
// id>" and data-filter-key, every row the data-* to match it against. The
// rows are all there without this script, which is the honest fallback.
function applyFilter(listId) {
  const list = document.getElementById(listId);
  if (!list) return;
  const rows = [...list.children].filter((row) => !row.dataset.filterEmpty);
  const terms = [...document.querySelectorAll(`[data-filter="${listId}"]`)]
    .map((control) => [control.dataset.filterKey, control.value.trim().toLowerCase()])
    .filter(([, value]) => value);
  let shown = 0;
  for (const row of rows) {
    const against = (key) => (key === "text" ? Object.values(row.dataset).join(" ") : row.dataset[key] || "");
    const match = terms.every(([key, value]) => against(key).toLowerCase().includes(value));
    row.hidden = !match;
    shown += match ? 1 : 0;
  }
  const empty = list.querySelector(`[data-filter-empty="${listId}"]`);
  if (empty) empty.hidden = shown > 0;
  const count = document.querySelector(`[data-filter-count="${listId}"]`);
  if (count) count.textContent = count.dataset.label.replace("{n}", shown).replace("{total}", rows.length);
}

for (const event of ["input", "change"]) {
  document.addEventListener(event, (e) => {
    const listId = e.target.dataset?.filter;
    if (listId) applyFilter(listId);
  });
}
document.querySelectorAll("[data-filter]").forEach((control) => applyFilter(control.dataset.filter));

document.querySelectorAll("[data-search]").forEach(searchable);
document.addEventListener("htmx:load", (e) => {
  const elt = e.detail.elt;
  if (!(elt instanceof Element)) return;
  elt.querySelectorAll("[data-search]").forEach(searchable);
  // A model list just arrived: open it under the field it belongs to.
  if (elt.dataset.openList) document.getElementById(elt.dataset.openList)?.focus();
});
