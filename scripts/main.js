// GMentor Link: лист персонажа GMentor в окне внутри Foundry.
// Ссылка хранится у актёра во флаге gmentor-link.url.
// Открыть: правый клик по актёру в списке «Актёры» или кнопка GMentor в заголовке листа.

const MODULE_ID = "gmentor-link";
const HOST = "gmentor.ru";

const windows = new Map(); // открытые окна: id актёра → окно
const busy = new Set();    // защита от двойного срабатывания кнопки

function escapeHTML(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(text ?? "").replace(/[&<>"']/g, c => map[c]);
}

// Принимает полную ссылку на gmentor.ru или просто 32-символьный код персонажа
function normalizeUrl(input) {
  const text = String(input ?? "").trim();
  if (!text) return null;
  if (/^[0-9a-f]{32}$/i.test(text)) return `https://${HOST}/${text.toLowerCase()}`;
  try {
    const url = new URL(text);
    const hostOk = url.hostname === HOST || url.hostname.endsWith(`.${HOST}`);
    if (url.protocol !== "https:" || !hostOk) return null;
    return url.href;
  } catch {
    return null;
  }
}

const getUrl = actor => normalizeUrl(actor?.getFlag(MODULE_ID, "url"));
const canEdit = actor => !!actor?.isOwner;
const canView = actor => !!actor?.testUserPermission(game.user, "OBSERVER");
const showButton = actor => canView(actor) && (!!getUrl(actor) || canEdit(actor));

class GMentorWindow extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["gmentor-window"],
    window: { icon: "fa-solid fa-globe", resizable: true },
    position: { width: 1100, height: 800 }
  };

  constructor(actor, url) {
    super({ id: `gmentor-${actor.id}`, window: { title: `GMentor — ${actor.name}` } });
    this.actorId = actor.id;
    this.url = url;
  }

  async _renderHTML() {
    const frame = document.createElement("iframe");
    frame.src = this.url;
    frame.allow = "clipboard-read; clipboard-write";
    return frame;
  }

  // Вставляем iframe только один раз, чтобы повторная отрисовка не перезагружала лист
  _replaceHTML(frame, content) {
    if (!content.querySelector("iframe")) content.replaceChildren(frame);
  }

  // Пока двигаешь или растягиваешь окно, iframe не перехватывает мышь
  _onRender(context, options) {
    super._onRender?.(context, options);
    if (this._dragGuard) return;
    this._dragGuard = true;
    const frame = () => this.element?.querySelector("iframe");
    this.element.addEventListener("pointerdown", event => {
      if (event.target.closest("iframe")) return;
      const f = frame();
      if (f) f.style.pointerEvents = "none";
    });
    window.addEventListener("pointerup", () => {
      const f = frame();
      if (f) f.style.pointerEvents = "";
    });
  }

  _onClose(options) {
    super._onClose?.(options);
    windows.delete(this.actorId);
  }
}

function closeWindow(actor) {
  const win = windows.get(actor.id);
  windows.delete(actor.id);
  win?.close();
}

// Окно для ввода или смены ссылки
async function promptUrl(actor) {
  if (!actor || !canEdit(actor)) return null;
  const current = actor.getFlag(MODULE_ID, "url") ?? "";

  const value = await foundry.applications.api.DialogV2.prompt({
    window: { title: `Ссылка GMentor — ${actor.name}` },
    content: `
      <p>Вставь ссылку на лист персонажа в GMentor. Оставь поле пустым, чтобы удалить ссылку.</p>
      <input name="url" type="text" value="${escapeHTML(current)}" placeholder="https://gmentor.ru/…" autofocus>`,
    ok: {
      label: "Сохранить",
      icon: "fa-solid fa-floppy-disk",
      callback: (event, button) => button.form.elements.url.value
    },
    rejectClose: false
  });
  if (value === null || value === undefined) return null; // окно закрыли

  if (!value.trim()) {
    await actor.unsetFlag(MODULE_ID, "url");
    closeWindow(actor);
    ui.notifications.info(`Ссылка GMentor у «${actor.name}» удалена.`);
    return null;
  }

  const url = normalizeUrl(value);
  if (!url) {
    ui.notifications.error("Это не ссылка на gmentor.ru.");
    return null;
  }
  await actor.setFlag(MODULE_ID, "url", url);
  closeWindow(actor);
  ui.notifications.info(`Ссылка GMentor у «${actor.name}» сохранена.`);
  return url;
}

async function openGMentor(actor) {
  if (!actor || busy.has(actor.id)) return;
  busy.add(actor.id);
  try {
    const existing = windows.get(actor.id);
    if (existing) {
      existing.bringToFront?.();
      return;
    }

    let url = getUrl(actor);
    if (!url) {
      if (!canEdit(actor)) {
        ui.notifications.warn(`У «${actor.name}» нет ссылки на GMentor.`);
        return;
      }
      url = await promptUrl(actor);
      if (!url) return;
    }

    const win = new GMentorWindow(actor, url);
    windows.set(actor.id, win);
    await win.render({ force: true });
  } finally {
    busy.delete(actor.id);
  }
}

// Находит актёра по строке списка «Актёры», на которой открыли меню
function actorFromArgs(...args) {
  const el = args.find(a => a instanceof HTMLElement)
    ?? args.find(a => a?.currentTarget instanceof HTMLElement)?.currentTarget;
  const li = el?.closest?.("[data-entry-id], [data-document-id]");
  const id = li?.dataset.entryId ?? li?.dataset.documentId;
  return id ? game.actors.get(id) : null;
}

// Пункты в меню правой кнопки по актёру
Hooks.on("getActorContextOptions", (app, items) => {
  items.push(
    {
      label: "Открыть в GMentor",
      icon: '<i class="fa-solid fa-globe"></i>',
      visible: (...args) => showButton(actorFromArgs(...args)),
      onClick: (...args) => openGMentor(actorFromArgs(...args))
    },
    {
      label: "Ссылка GMentor…",
      icon: '<i class="fa-solid fa-link"></i>',
      visible: (...args) => canEdit(actorFromArgs(...args)),
      onClick: (...args) => promptUrl(actorFromArgs(...args))
    }
  );
});

// Кнопка в заголовке листа персонажа (старый тип листов)
Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
  const actor = sheet.actor ?? sheet.document;
  if (!showButton(actor)) return;
  buttons.unshift({
    label: "GMentor",
    class: "gmentor-open",
    icon: "fa-solid fa-globe",
    onclick: () => openGMentor(actor)
  });
});

// Кнопка в меню заголовка листа персонажа (новый тип листов)
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  const actor = app.document;
  if (!(actor instanceof Actor) || !showButton(actor)) return;
  try {
    app.options.actions.gmentorOpen ??= () => openGMentor(actor);
  } catch { /* если действия заблокированы, сработает onClick */ }
  controls.push({
    icon: "fa-solid fa-globe",
    label: "GMentor",
    action: "gmentorOpen",
    onClick: () => openGMentor(actor)
  });
});
