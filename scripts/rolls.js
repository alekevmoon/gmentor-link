// GMentor Link — броски из GMentor в чат Foundry.
// GMentor отправляет броски по ссылке вебхука (в формате Discord) прямо из браузера игрока.
// Вместо Discord указываем канал ntfy: он принимает запросы с любого сайта по https.
// Клиент активного мастера слушает этот канал и выкладывает броски в чат Foundry.

const MODULE_ID = "gmentor-link";
const log = (...args) => console.log("GMentor Link |", ...args);

let source = null;     // подключение к каналу
let lastId = null;     // последний полученный бросок: чтобы после обрыва ничего не потерять
let retryTimer = null;
let failures = 0;
const seen = new Set(); // защита от повторов

// ---------- Настройки ----------

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "rollsEnabled", {
    name: "Броски из GMentor в чат",
    hint: "Выкладывать в чат Foundry броски, которые игроки делают в листах GMentor.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => connect()
  });

  game.settings.register(MODULE_ID, "rollsUrl", {
    name: "Ссылка для бросков",
    hint: "Её вставляют в лист GMentor: «Броски в Mentor или Discord» → «Добавить канал». Создаётся автоматически.",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: () => { lastId = null; connect(); }
  });
});

Hooks.once("ready", async () => {
  if (isListener() && !game.settings.get(MODULE_ID, "rollsUrl")) {
    const url = `https://ntfy.sh/gmentor-${foundry.utils.randomID(24)}`;
    await game.settings.set(MODULE_ID, "rollsUrl", url);
    await ChatMessage.create({
      content: `<p><strong>GMentor Link:</strong> ссылка для бросков создана.</p>
        <p>Вставьте её в лист GMentor («Броски в Mentor или Discord» → «Добавить канал»):</p>
        <p><code>${escapeHTML(url)}</code></p>`,
      whisper: [game.user.id]
    });
  }
  connect();
});

// Если мастер вышел или зашёл, слушать должен ровно один клиент
Hooks.on("userConnected", () => setTimeout(connect, 500));

function isListener() {
  return !!game.user.isGM && game.users.activeGM?.id === game.user.id;
}

// ---------- Подключение к каналу ----------

function disconnect() {
  clearTimeout(retryTimer);
  source?.close();
  source = null;
}

function connect() {
  disconnect();
  if (!isListener() || !game.settings.get(MODULE_ID, "rollsEnabled")) return;

  const base = String(game.settings.get(MODULE_ID, "rollsUrl") ?? "").trim().replace(/\/+$/, "");
  if (!base) return;

  let url;
  try {
    url = new URL(`${base}/sse`);
  } catch {
    ui.notifications.error("GMentor Link: ссылка для бросков неправильная.");
    return;
  }
  if (lastId) url.searchParams.set("since", lastId);

  source = new EventSource(url);
  source.onopen = () => {
    if (failures) log("канал бросков снова на связи");
    failures = 0;
  };
  source.onmessage = event => handleEvent(event.data);
  source.onerror = () => {
    disconnect();
    failures++;
    if (failures === 3) ui.notifications.warn("GMentor Link: не удаётся подключиться к каналу бросков, пробую снова…");
    retryTimer = setTimeout(connect, Math.min(30000, 2000 * failures));
  };
  log("слушаю канал бросков", base);
}

async function handleEvent(data) {
  let msg;
  try {
    msg = JSON.parse(data);
  } catch {
    return;
  }
  if (msg.event !== "message" || !msg.id || seen.has(msg.id)) return;
  seen.add(msg.id);
  lastId = msg.id;

  try {
    let body = msg.message ?? "";
    // Большие сообщения ntfy превращает во вложенный файл — скачиваем его
    if (msg.attachment?.url && (!body || /file|attachment|файл/i.test(body))) {
      const res = await fetch(msg.attachment.url);
      if (res.ok) body = await res.text();
    }
    log("получен бросок", body);
    await postRoll(body);
  } catch (err) {
    console.error("GMentor Link | не удалось обработать бросок", err, msg);
  }
}

// ---------- Разбор и вывод в чат ----------

function escapeHTML(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(text ?? "").replace(/[&<>"']/g, c => map[c]);
}

// Разметка Discord → HTML (текст сначала экранируется)
function markdown(text) {
  const blocks = [];
  let s = escapeHTML(text);
  s = s.replace(/```(?:\w*\n)?([\s\S]*?)```/g, (m, code) => {
    blocks.push(`<pre>${code.replace(/\n$/, "")}</pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = s
    .replace(/&lt;a?:(\w+):\d+&gt;/g, ":$1:")                 // эмодзи сервера
    .replace(/&lt;t:(\d+)(?::\w)?&gt;/g, (m, t) => new Date(t * 1000).toLocaleString())
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*\*(.+?)\*\*\*/gs, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>")
    .replace(/__(.+?)__/gs, "<u>$1</u>")
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/gs, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/gs, "$1<em>$2</em>")
    .replace(/~~(.+?)~~/gs, "<s>$1</s>")
    .replace(/\|\|(.+?)\|\|/gs, '<span class="gmr-spoiler">$1</span>')
    .replace(/^&gt; ?(.*)$/gm, '<span class="gmr-quote">$1</span>')
    .replace(/\n/g, "<br>");
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[Number(i)]);
}

function colorOf(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `#${(n >>> 0).toString(16).padStart(6, "0").slice(-6)}` : null;
}

function renderEmbed(e) {
  const color = colorOf(e.color);
  let html = `<div class="gmr-embed"${color ? ` style="border-left-color:${color}"` : ""}>`;
  if (e.author?.name) html += `<div class="gmr-author">${markdown(e.author.name)}</div>`;
  if (e.title) html += `<div class="gmr-title">${markdown(e.title)}</div>`;
  if (e.description) html += `<div class="gmr-desc">${markdown(e.description)}</div>`;
  if (Array.isArray(e.fields) && e.fields.length) {
    html += `<div class="gmr-fields">`;
    for (const f of e.fields) {
      html += `<div class="gmr-field${f.inline ? " inline" : ""}">`
        + (f.name ? `<div class="gmr-fname">${markdown(f.name)}</div>` : "")
        + (f.value ? `<div class="gmr-fvalue">${markdown(f.value)}</div>` : "")
        + `</div>`;
    }
    html += `</div>`;
  }
  if (e.footer?.text) html += `<div class="gmr-footer">${markdown(e.footer.text)}</div>`;
  return html + `</div>`;
}

function parsePayload(body) {
  const text = String(body ?? "").trim();
  if (text.startsWith("{")) {
    try {
      const data = JSON.parse(text);
      if (data && typeof data === "object") return data;
    } catch { /* не JSON — покажем как текст */ }
  }
  return { content: text };
}

async function postRoll(body) {
  const payload = parsePayload(body);
  const embeds = Array.isArray(payload.embeds) ? payload.embeds : [];

  let html = "";
  if (payload.content) html += `<div class="gmr-content">${markdown(payload.content)}</div>`;
  for (const e of embeds) html += renderEmbed(e);
  if (!html) return;

  // Говорящий: имя отправителя из GMentor; если есть актёр с таким именем — от его лица
  const name = String(payload.username || embeds[0]?.author?.name || "GMentor").trim();
  const actor = game.actors.find(a => a.name.trim().toLowerCase() === name.toLowerCase());
  const speaker = actor ? ChatMessage.getSpeaker({ actor, alias: name }) : { alias: name };

  await ChatMessage.create({
    speaker,
    content: `<div class="gmentor-roll"><div class="gmr-source"><i class="fa-solid fa-dice"></i> GMentor</div>${html}</div>`,
    flags: { [MODULE_ID]: { gmentorRoll: true } }
  });
}
