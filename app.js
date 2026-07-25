const TRANSPORT_LABEL = {
  train: "Поезд",
  carshare: "Каршеринг",
  walk: "Пешком",
  metro: "Метро",
  bus: "Автобус",
  car: "Авто",
};

const STORAGE_KEY = "happy-mama-tour-checks-v2";
const PANEL_ORDER = ["plan", "stay", "map", "budget", "todo"];
const PANEL_TITLES = {
  plan: "План",
  stay: "Отель",
  map: "Тур",
  budget: "Бюджет",
  todo: "Дела",
};
const EDGE_SWIPE_ZONE = 36;
const EDGE_SWIPE_MIN = 64;

let mapInstance = null;
let tourAnimator = null;
let activePanel = "plan";
let leafletLoadPromise = null;
let mapInitStarted = false;
let revealObserver = null;
let swipeBusy = false;
let edgeTouch = null;

const ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Данные из data.js пишет человек — экранируем, чтобы кавычка не ломала разметку. */
function esc(value) {
  if (value == null) return "";
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

const LEAFLET_CSS =
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS =
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS_INTEGRITY = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
const LEAFLET_JS_INTEGRITY = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";

function fmtDate(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function fmtDayNum(iso) {
  return new Date(iso + "T12:00:00").getDate();
}

function fmtMonthShort(iso) {
  return new Date(iso + "T12:00:00")
    .toLocaleDateString("ru-RU", { month: "short" })
    .replace(".", "");
}

function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₽";
}

/**
 * Точка на Яндекс.Картах. `text` не добавляем: вместе с `pt` он превращает
 * ссылку в поисковый запрос и уводит с точных координат.
 */
function yandexMap(lat, lon) {
  if (lat == null || lon == null) return "https://yandex.ru/maps/";
  const point = `${lon}%2C${lat}`;
  return `https://yandex.ru/maps/?ll=${point}&z=16&pt=${point}%2Cpm2rdm`;
}

function loadChecks() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveChecks(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function isTicketBought(id) {
  return !!loadChecks()[`ticket-${id}`];
}

function isTodoDone(id) {
  return !!loadChecks()[`todo-${id}`];
}

function isDoItemDone(item) {
  if (item.storage === "ticket") return isTicketBought(item.id);
  return isTodoDone(item.id) || item.done;
}

function isPrepareDone(item) {
  const checks = loadChecks();
  return checks[`pack-${item.id}`] || item.done;
}

function collectDoItems() {
  const items = [];
  const h = TRIP.hotel;

  if (h.name?.includes("←") || h.bookingRef?.includes("←")) {
    items.push({
      id: "hotel-book",
      storage: "todo",
      text: "Забронировать отель",
      detail: `7 ночей · заезд ${fmtDate(h.checkIn)}${h.lateCheckIn ? " · поздний ~00:30" : ""}`,
      urgent: true,
    });
  }

  TRIP.tickets.forEach((t) => {
    items.push({
      id: t.id,
      storage: "ticket",
      text: t.label,
      detail: `${fmtDate(t.date)} · ${t.train} · ${t.depart}`,
      link: t.link,
      linkLabel: "РЖД",
      urgent: true,
    });
  });

  TRIP.days.forEach((day) => {
    day.steps.forEach((step, si) => {
      if (!step.link) return;
      items.push({
        id: step.ticketId || `${day.id}-s${si}`,
        storage: "ticket",
        text: step.ticketNote || step.title,
        detail: `${fmtDayNum(day.date)} ${fmtMonthShort(day.date)} · ${step.time || "—"}`,
        link: step.link,
        linkLabel: "Билеты",
        urgent: true,
      });
    });
  });

  (TRIP.todos || []).forEach((t) => {
    items.push({
      ...t,
      storage: "todo",
      urgent: t.urgent !== false,
    });
  });

  return items;
}

function countPendingDo() {
  return collectDoItems().filter((item) => !isDoItemDone(item)).length;
}

function countPendingPrepare() {
  return TRIP.packing.filter((item) => !isPrepareDone(item)).length;
}

function dismissTaskRow(row) {
  if (!row) return Promise.resolve();
  if (prefersReducedMotion()) {
    row.remove();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      row.remove();
      resolve();
    };
    // Фиксируем текущую высоту, чтобы схлопывание шло от неё, а не от max-height.
    row.style.maxHeight = `${row.scrollHeight}px`;
    requestAnimationFrame(() => {
      row.classList.add("task-item--hide");
      row.style.maxHeight = "0px";
    });
    row.addEventListener("transitionend", (e) => {
      if (e.propertyName === "max-height") finish();
    });
    setTimeout(finish, 600);
  });
}

function updateTodoBadges() {
  const pending = countPendingDo() + countPendingPrepare();
  document.querySelector('[data-nav="todo"]')?.classList.toggle("nav-btn--alert", pending > 0);
}

function renderDoItem(item) {
  return `
    <div class="task-item task-item--urgent" data-task-wrap="${esc(item.id)}">
      <label class="task-check">
        <input type="checkbox" data-do-id="${esc(item.id)}" data-do-storage="${esc(item.storage)}" aria-label="Готово: ${esc(item.text)}">
      </label>
      <div class="task-body">
        <span class="task-title">${esc(item.text)}</span>
        ${item.detail ? `<span class="task-detail">${esc(item.detail)}</span>` : ""}
      </div>
      ${item.link ? `<a class="btn-link btn-link-urgent task-link" href="${esc(item.link)}" target="_blank" rel="noopener">${esc(item.linkLabel || "Открыть")}</a>` : ""}
    </div>
  `;
}

function renderPrepareItem(item) {
  const done = isPrepareDone(item);
  return `
    <label class="task-item task-item--prepare${done ? " task-item--done" : ""}">
      <input type="checkbox" data-id="pack-${esc(item.id)}" ${done ? "checked" : ""}>
      <div class="task-body">
        <span class="task-title">${esc(item.text)}</span>
      </div>
    </label>
  `;
}

function sumStepCosts() {
  let total = 0;
  TRIP.days.forEach((day) => {
    day.steps.forEach((step) => {
      if (typeof step.cost === "number") total += step.cost;
    });
  });
  return total;
}

function sumBudget() {
  const fixed = TRIP.budgetFixed
    .filter((b) => !["hotel", "train"].includes(b.id))
    .reduce((s, i) => s + (i.amount || 0), 0);
  const daily = sumStepCosts();
  const tickets = TRIP.tickets.reduce((s, t) => s + (t.cost || 0), 0);
  const hotel = (TRIP.hotel.costPerNight || 0) * (TRIP.hotel.nights || 0);
  return fixed + daily + tickets + hotel;
}

/** Реальная сумма плана — то, во что поездка обходится по текущим цифрам. */
function displayBudget() {
  return sumBudget();
}

/** Целевой бюджет из meta.budget — ориентир, а не итог. */
function budgetTarget() {
  return typeof TRIP.meta.budget === "number" ? TRIP.meta.budget : null;
}

function pluralRu(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function renderHero() {
  const el = document.getElementById("hero");
  el.innerHTML = `
    <div class="hero-ornament"><span>СПБ</span></div>
    <h1 class="hero-script">${esc(TRIP.meta.title)}</h1>
    <div class="hero-city">Санкт-Петербург</div>
    <div class="hero-dates">${fmtDate(TRIP.meta.start)} — ${fmtDate(TRIP.meta.end)}</div>
    <div class="hero-sub">${esc(TRIP.meta.subtitle)}</div>
  `;
}

let hubRendered = false;

/** Повторный рендер не должен заново проигрывать появление карточек. */
function keepRevealed(root, alreadyRendered) {
  if (!alreadyRendered || !root) return;
  root.querySelectorAll(".reveal").forEach((el) => el.classList.add("visible"));
}

function renderHub() {
  const total = displayBudget();
  const doLeft = countPendingDo();
  const prepLeft = countPendingPrepare();
  const totalLeft = doLeft + prepLeft;
  const subParts = [];
  if (doLeft) subParts.push(`${doLeft} надо сделать`);
  if (prepLeft) subParts.push(`${prepLeft} надо собрать`);
  const todoBanner =
    totalLeft > 0
      ? `
    <button type="button" class="todo-hub todo-hub--alert card card-glass reveal" id="todo-hub-btn" aria-label="Открыть список дел: осталось ${totalLeft}">
      <div class="todo-hub-head">
        <span class="todo-hub-badge" aria-hidden="true">${totalLeft}</span>
        <div class="todo-hub-copy">
          <span class="todo-hub-title">Осталось ${totalLeft} ${pluralRu(totalLeft, "дело", "дела", "дел")}</span>
          <span class="todo-hub-sub">${subParts.join(" · ")}</span>
        </div>
        <span class="todo-hub-go" aria-hidden="true">!</span>
      </div>
      <span class="todo-hub-cta">Нажмите — список дел</span>
    </button>`
      : `
    <div class="todo-hub card card-glass reveal todo-hub--done">
      <span class="todo-hub-done">✓ Всё готово к поездке</span>
    </div>`;

  const hub = document.getElementById("hub");
  hub.innerHTML = `
    ${todoBanner}
    <div class="card card-glass reveal">
      <div class="hub-stats">
        <div class="stat">
          <span class="stat-val">${TRIP.meta.nights}</span>
          <span class="stat-lbl">ночей</span>
        </div>
        <div class="stat">
          <span class="stat-val">${TRIP.days.length}</span>
          <span class="stat-lbl">дней</span>
        </div>
        <div class="stat">
          <span class="stat-val">${Math.round(total / 1000)}k</span>
          <span class="stat-lbl">по плану ₽</span>
        </div>
      </div>
    </div>
  `;

  keepRevealed(hub, hubRendered);
  hubRendered = true;

  document.getElementById("todo-hub-btn")?.addEventListener("click", () => {
    document.querySelector('[data-nav="todo"]')?.click();
  });
  updateTodoBadges();
}

let planRendered = false;

function renderPlan() {
  const container = document.getElementById("plan-days");
  const today = new Date().toISOString().slice(0, 10);

  // Сохраняем, какие дни были раскрыты — иначе любой чекбокс схлопывает план.
  const openIds = new Set(
    Array.from(container.querySelectorAll(".day-card[open]")).map((el) => el.dataset.dayId),
  );

  container.innerHTML = TRIP.days
    .map((day, idx) => {
      const wasOpen = planRendered
        ? openIds.has(day.id)
        : day.date === today || idx === 0;
      const steps = day.steps
        .map((step, si) => {
          const ticketId = step.link ? step.ticketId || `${day.id}-s${si}` : null;
          const needsTicket = ticketId && !isTicketBought(ticketId);
          return `
        <div class="step${needsTicket ? " step--needs-ticket" : ""}">
          <div class="step-head">
            <span class="step-time">${esc(step.time || "—")}</span>
            <span class="step-title">${esc(step.title)}</span>
            ${step.transport ? `<span class="step-transport" data-t="${esc(step.transport)}">${esc(TRANSPORT_LABEL[step.transport] || step.transport)}</span>` : ""}
          </div>
          ${step.detail ? `<p class="step-detail">${esc(step.detail)}</p>` : ""}
          ${step.address ? `<p class="step-address">${esc(step.address)}</p>` : ""}
          ${step.cost != null ? `<p class="step-cost">${fmtMoney(step.cost)}${step.costNote ? ` · ${esc(step.costNote)}` : ""}</p>` : ""}
          ${
            step.tips?.length
              ? `<ul class="step-tips">${step.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`
              : ""
          }
          <div class="step-actions">
            ${
              step.lat != null
                ? `<a class="btn-link" href="${yandexMap(step.lat, step.lon)}" target="_blank" rel="noopener">Карта</a>`
                : ""
            }
            ${
              step.link
                ? `<a class="btn-link${needsTicket ? " btn-link-urgent" : ""}" href="${esc(step.link)}" target="_blank" rel="noopener">Билеты</a>`
                : ""
            }
          </div>
        </div>
      `;
        })
        .join("");

      return `
        <details class="card day-card reveal" data-day-id="${esc(day.id)}"${wasOpen ? " open" : ""}>
          <summary>
            <div class="day-date-badge" aria-hidden="true">
              <span class="day-date-num">${fmtDayNum(day.date)}</span>
              <span class="day-date-mon">${fmtMonthShort(day.date)}</span>
            </div>
            <div class="day-meta">
              <span class="day-label">${esc(day.label)}</span>
              <span class="day-summary">${esc(day.weekday)} · ${esc(day.summary)}</span>
            </div>
          </summary>
          <div class="day-body">
            <div class="timeline">${steps}</div>
          </div>
        </details>
      `;
    })
    .join("");

  keepRevealed(container, planRendered);
  planRendered = true;
}

function renderTicketsAndHotel() {
  const ticketsEl = document.getElementById("tickets-block");
  ticketsEl.innerHTML = TRIP.tickets
    .map((t) => {
      const bought = isTicketBought(t.id);
      return `
    <div class="ticket-card${bought ? " ticket-card--bought" : " ticket-card--pending"}">
      <div class="ticket-route">${esc(t.label)}</div>
      <div class="ticket-meta">${t.weekday ? esc(t.weekday) + " · " : ""}${fmtDate(t.date)} · ${esc(t.train)}</div>
      <div class="ticket-meta">${esc(t.from)} → ${esc(t.to)}</div>
      <div class="ticket-meta">Отправление ${esc(t.depart)} · прибытие ${esc(t.arrive)}</div>
      <div class="ticket-meta">${esc(t.seats)}</div>
      <div class="ticket-meta ticket-price">${fmtMoney(t.cost)} ${esc(t.costNote || "")}</div>
      <div class="step-actions">
        ${
          bought
            ? `<span class="ticket-done-tag">✓ Куплено</span>`
            : `<a class="btn-link btn-link-urgent" href="${esc(t.link)}" target="_blank" rel="noopener">Купить на РЖД</a>`
        }
      </div>
    </div>
  `;
    })
    .join("");

  const h = TRIP.hotel;
  const phoneDigits = String(h.phone || "").replace(/[^\d+]/g, "");
  document.getElementById("hotel-block").innerHTML = `
    <div class="hotel-block">
      <div class="hotel-name">${esc(h.name)}</div>
      <div class="hotel-row"><b>Адрес:</b> ${esc(h.address)}</div>
      <div class="hotel-row"><b>Заезд:</b> ${fmtDate(h.checkIn)} с ${esc(h.checkInFrom)}${h.lateCheckIn ? " (ночной заезд)" : ""}</div>
      <div class="hotel-row"><b>Выезд:</b> ${fmtDate(h.checkOut)}</div>
      <div class="hotel-row"><b>Бронь:</b> ${esc(h.bookingRef)}</div>
      <div class="hotel-row"><b>Телефон:</b> ${
        phoneDigits.length > 4
          ? `<a href="tel:${esc(phoneDigits)}">${esc(h.phone)}</a>`
          : esc(h.phone)
      }</div>
      <div class="hotel-row"><b>Стоимость:</b> ${fmtMoney(h.costPerNight)} × ${h.nights} = ${fmtMoney(h.costPerNight * h.nights)}</div>
      <div class="hotel-row">${esc(h.notes)}</div>
      <div class="step-actions">
        <a class="btn-link" href="${yandexMap(h.lat, h.lon)}" target="_blank" rel="noopener">Яндекс.Карты</a>
      </div>
    </div>
  `;
}

function renderBudget() {
  const rows = document.getElementById("budget-rows");
  const hotelTotal = TRIP.hotel.costPerNight * TRIP.hotel.nights;
  const ticketTotal = TRIP.tickets.reduce((s, t) => s + (t.cost || 0), 0);
  const dailyTotal = sumStepCosts();

  const items = [
    { label: "Отель", amount: hotelTotal, note: `${TRIP.hotel.nights} ночей` },
    { label: "Ж/д билеты", amount: ticketTotal, note: "туда + обратно" },
    ...TRIP.budgetFixed.filter((b) => !["hotel", "train"].includes(b.id)),
    { label: "По дням (транспорт, еда, входы)", amount: dailyTotal, note: "из расписания" },
  ];

  rows.innerHTML = items
    .map(
      (i) => `
    <div class="budget-row">
      <span>${esc(i.label)}</span>
      <span class="budget-amt">${fmtMoney(i.amount)}</span>
      ${i.note ? `<span class="budget-note">${esc(i.note)}</span>` : ""}
    </div>
  `,
    )
    .join("");

  const planned = displayBudget();
  const target = budgetTarget();
  document.getElementById("budget-total-val").textContent = fmtMoney(planned);

  const compareEl = document.getElementById("budget-compare");
  if (!compareEl) return;

  if (target == null) {
    compareEl.innerHTML = "";
    return;
  }

  const diff = planned - target;
  if (diff > 0) {
    compareEl.innerHTML = `
      <span class="budget-compare-lbl">Цель ${fmtMoney(target)}</span>
      <span class="budget-compare-val budget-compare-val--over">Сверх цели ${fmtMoney(diff)}</span>`;
  } else if (diff < 0) {
    compareEl.innerHTML = `
      <span class="budget-compare-lbl">Цель ${fmtMoney(target)}</span>
      <span class="budget-compare-val budget-compare-val--under">Запас ${fmtMoney(-diff)}</span>`;
  } else {
    compareEl.innerHTML = `
      <span class="budget-compare-lbl">Цель ${fmtMoney(target)}</span>
      <span class="budget-compare-val">Ровно в цель</span>`;
  }
}

function renderTodoSummary() {
  const doLeft = countPendingDo();
  const prepLeft = countPendingPrepare();
  const el = document.getElementById("todo-summary");

  if (doLeft + prepLeft === 0) {
    el.innerHTML = `<p class="todo-summary-done">✓ Всё сделано и собрано — можно ехать!</p>`;
    return;
  }

  el.innerHTML = `
    <div class="todo-summary-grid">
      <div class="todo-summary-item${doLeft ? " todo-summary-item--urgent" : ""}">
        <span class="todo-summary-num">${doLeft}</span>
        <span class="todo-summary-lbl">надо сделать</span>
      </div>
      <div class="todo-summary-item">
        <span class="todo-summary-num">${prepLeft}</span>
        <span class="todo-summary-lbl">подготовить</span>
      </div>
    </div>
    <p class="todo-summary-hint">Отметьте галочкой — пункт исчезнет с анимацией</p>
  `;
}

function renderTodoDo() {
  const items = collectDoItems().filter((item) => !isDoItemDone(item));
  const el = document.getElementById("todo-do");

  if (!items.length) {
    el.innerHTML = `<p class="task-empty">✓ Все задачи выполнены</p>`;
    return;
  }

  el.innerHTML = items.map((item) => renderDoItem(item)).join("");
}

function renderTodoPrepare() {
  document.getElementById("todo-prepare").innerHTML = TRIP.packing.map((item) => renderPrepareItem(item)).join("");
}

function renderOfficialLinks(item) {
  const links =
    item.officialLinks ||
    (item.officialLink ? [{ href: item.officialLink, label: item.officialLabel || "Сайт" }] : []);
  if (!links.length) return "";
  return `
    <div class="visit-item-links">
      ${links
        .map(
          (l) =>
            `<a class="btn-link btn-link-site" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`,
        )
        .join("")}
    </div>`;
}

function renderMustSee() {
  const checks = loadChecks();
  document.getElementById("must-see").innerHTML = TRIP.mustSee
    .map((item) => {
      const done = checks["must-" + item.id] || item.done;
      const links = renderOfficialLinks(item);
      return `
      <div class="visit-item${links ? " visit-item--has-links" : ""}">
        <label class="check-item${done ? " done" : ""}">
          <input type="checkbox" data-id="must-${esc(item.id)}" ${done ? "checked" : ""}>
          <span class="check-text">${esc(item.name)}</span>
          <span class="check-tag">${esc(item.day)}</span>
        </label>
        ${links}
      </div>
    `;
    })
    .join("");
}

function renderTodoPanel() {
  renderTodoSummary();
  renderTodoDo();
  renderTodoPrepare();
  renderMustSee();
  updateTodoBadges();
}

function refreshAfterTodoChange() {
  renderHub();
  renderTodoSummary();
  renderPlan();
  renderTicketsAndHotel();
  updateTodoBadges();
}

function showMapStatus(mapEl, message, isError) {
  mapEl.innerHTML = `<p class="map-status${isError ? " map-status--error" : ""}">${message}</p>`;
}

function loadStylesheet(href, integrity) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`link[href="${href}"]`)) {
      resolve();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    if (integrity) {
      link.integrity = integrity;
      link.crossOrigin = "";
    }
    link.onload = () => resolve();
    link.onerror = () => reject(new Error("stylesheet"));
    document.head.appendChild(link);
  });
}

function loadScript(src, integrity) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    if (integrity) {
      script.integrity = integrity;
      script.crossOrigin = "";
    }
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("script"));
    document.body.appendChild(script);
  });
}

function loadLeaflet() {
  if (typeof L !== "undefined") return Promise.resolve();
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = loadStylesheet(LEAFLET_CSS, LEAFLET_CSS_INTEGRITY)
    .then(() => loadScript(LEAFLET_JS, LEAFLET_JS_INTEGRITY))
    .catch(() => {
      leafletLoadPromise = null;
      throw new Error("leaflet");
    });
  return leafletLoadPromise;
}

function initMap() {
  const mapEl = document.getElementById("map");
  if (!mapEl || mapEl.dataset.state === "error") return;

  if (mapInstance) {
    requestAnimationFrame(() => {
      mapInstance.invalidateSize();
      tourAnimator?.refit?.();
    });
    return;
  }
  // Загрузка уже идёт — не затираем контейнер повторным статусом.
  if (mapInitStarted) return;

  mapInitStarted = true;
  showMapStatus(mapEl, "Загрузка карты…");

  loadLeaflet()
    .then(() => {
      if (typeof L === "undefined") throw new Error("leaflet");
      mapEl.innerHTML = "";
      mapEl.dataset.state = "ready";

      if (!mapInstance) {
        mapInstance = L.map("map", { zoomControl: false }).setView([59.5, 32], 6);

        L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
          attribution: "&copy; OSM &copy; CARTO",
          subdomains: "abcd",
          maxZoom: 19,
        }).addTo(mapInstance);

        L.control.zoom({ position: "bottomright" }).addTo(mapInstance);
      }

      if (!tourAnimator && typeof initTourAnimation === "function") {
        tourAnimator = initTourAnimation(mapInstance);
      }

      setTimeout(() => {
        mapInstance.invalidateSize();
        tourAnimator?.refit?.();
      }, 220);
    })
    .catch(() => {
      mapInitStarted = false;
      mapEl.dataset.state = "error";
      showMapStatus(
        mapEl,
        "Карта не загрузилась. Проверьте интернет и обновите страницу.",
        true,
      );
    });
}

function bindTodoPanel() {
  document.getElementById("todo-panel").addEventListener("change", (e) => {
    const doInput = e.target.closest("input[data-do-id]");
    if (doInput) {
      const { doId, doStorage } = doInput.dataset;
      const checks = loadChecks();
      if (doStorage === "ticket") checks[`ticket-${doId}`] = doInput.checked;
      else checks[`todo-${doId}`] = doInput.checked;
      saveChecks(checks);

      if (doInput.checked) {
        dismissTaskRow(doInput.closest("[data-task-wrap]")).then(() => {
          renderTodoDo();
          refreshAfterTodoChange();
        });
      } else {
        renderTodoPanel();
        refreshAfterTodoChange();
      }
      return;
    }

    const input = e.target.closest("input[data-id]");
    if (!input) return;
    const checks = loadChecks();
    checks[input.dataset.id] = input.checked;
    saveChecks(checks);
    input.closest(".check-item, .task-item")?.classList.toggle("done", input.checked);
    input.closest(".task-item")?.classList.toggle("task-item--done", input.checked);
    renderTodoSummary();
    renderHub();
    updateTodoBadges();
  });
}

function bindNav() {
  const buttons = Array.from(document.querySelectorAll(".nav-btn"));

  buttons.forEach((btn, i) => {
    btn.addEventListener("click", () => {
      applyPanelSwitch(btn.dataset.nav, { scroll: "smooth" });
    });
    btn.addEventListener("keydown", (e) => {
      let next = null;
      if (e.key === "ArrowRight") next = buttons[(i + 1) % buttons.length];
      else if (e.key === "ArrowLeft") next = buttons[(i - 1 + buttons.length) % buttons.length];
      else if (e.key === "Home") next = buttons[0];
      else if (e.key === "End") next = buttons[buttons.length - 1];
      if (!next) return;
      e.preventDefault();
      next.focus();
      applyPanelSwitch(next.dataset.nav, { scroll: "smooth" });
    });
  });

  syncNavIndicator();
  window.addEventListener("resize", syncNavIndicator, { passive: true });
}

/** Золотая «пилюля» под активной вкладкой едет плавно, а не перескакивает. */
function syncNavIndicator() {
  const nav = document.querySelector(".bottom-nav");
  if (!nav) return;
  const idx = Math.max(0, PANEL_ORDER.indexOf(activePanel));
  nav.style.setProperty("--nav-index", String(idx));
  nav.style.setProperty("--nav-count", String(PANEL_ORDER.length));
}

function getNextPanel(current) {
  const idx = PANEL_ORDER.indexOf(current);
  return PANEL_ORDER[(idx + 1) % PANEL_ORDER.length];
}

/** Показ появляющихся блоков: короткий каскад сверху вниз. */
function staggerReveals(panel) {
  if (!panel) return;
  const items = panel.querySelectorAll(".reveal");
  items.forEach((el, i) => el.style.setProperty("--reveal-i", String(Math.min(i, 6))));
}

function applyPanelSwitch(panelId, { scroll = "auto", animate = true } = {}) {
  if (panelId === activePanel) return;

  const prevIdx = PANEL_ORDER.indexOf(activePanel);
  const nextIdx = PANEL_ORDER.indexOf(panelId);
  const dir = nextIdx > prevIdx ? "forward" : "back";

  activePanel = panelId;
  document.body.dataset.panel = panelId;

  document.querySelectorAll(".nav-btn").forEach((b) => {
    const isActive = b.dataset.nav === activePanel;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-selected", isActive ? "true" : "false");
    b.tabIndex = isActive ? 0 : -1;
  });

  const nextPanel = document.querySelector(`.panel[data-panel="${panelId}"]`);

  document.querySelectorAll(".panel").forEach((p) => {
    p.classList.remove("panel--forward", "panel--back");
    p.classList.toggle("active", p.dataset.panel === activePanel);
    p.hidden = p.dataset.panel !== activePanel;
  });

  if (nextPanel && animate && !prefersReducedMotion()) {
    staggerReveals(nextPanel);
    nextPanel.classList.add(dir === "forward" ? "panel--forward" : "panel--back");
    nextPanel.addEventListener(
      "animationend",
      () => nextPanel.classList.remove("panel--forward", "panel--back"),
      { once: true },
    );
  }

  syncNavIndicator();
  observeReveals();

  if (activePanel === "map") {
    initMap();
    setTimeout(() => {
      mapInstance?.invalidateSize();
      tourAnimator?.refit?.();
    }, 180);
  } else {
    tourAnimator?.pause?.();
  }
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : scroll });
}

function playSpbSwipeTransition(nextPanel) {
  if (swipeBusy) return;
  swipeBusy = true;

  const overlay = document.getElementById("spb-swipe-overlay");
  const label = overlay?.querySelector(".spb-swipe-label");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (label) label.textContent = PANEL_TITLES[nextPanel] || nextPanel;

  if (reduced || !overlay) {
    applyPanelSwitch(nextPanel, { animate: false });
    swipeBusy = false;
    return;
  }

  const leavingPanel = document.querySelector(`.panel[data-panel="${activePanel}"]`);

  overlay.classList.remove("is-leaving", "is-tracking");
  overlay.style.removeProperty("--swipe-progress");
  overlay.classList.add("is-active");
  overlay.setAttribute("aria-hidden", "false");

  if (navigator.vibrate) navigator.vibrate(10);

  window.setTimeout(() => {
    if (leavingPanel) {
      leavingPanel.classList.remove("active", "spb-enter");
      leavingPanel.classList.add("spb-exit");
    }

    window.setTimeout(() => {
      applyPanelSwitch(nextPanel, { animate: false });
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("spb-exit"));
      const enteringPanel = document.querySelector(`.panel[data-panel="${nextPanel}"]`);
      if (enteringPanel) enteringPanel.classList.add("spb-enter");

      overlay.classList.add("is-leaving");

      window.setTimeout(() => {
        overlay.classList.remove("is-active", "is-leaving");
        overlay.setAttribute("aria-hidden", "true");
        if (enteringPanel) enteringPanel.classList.remove("spb-enter");
        swipeBusy = false;
      }, 480);
    }, 260);
  }, 300);
}

function bindEdgeSwipeNav() {
  const overlay = document.getElementById("spb-swipe-overlay");

  document.addEventListener(
    "touchstart",
    (e) => {
      if (swipeBusy || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.clientX < window.innerWidth - EDGE_SWIPE_ZONE) return;
      if (e.target.closest("input, textarea, select, button, a, .leaflet-control")) return;
      edgeTouch = { x: t.clientX, y: t.clientY, time: Date.now() };
    },
    { passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!edgeTouch || swipeBusy || !overlay) return;
      const t = e.touches[0];
      const dx = t.clientX - edgeTouch.x;
      if (dx > 8) {
        edgeTouch = null;
        overlay.classList.remove("is-tracking");
        overlay.style.removeProperty("--swipe-progress");
        return;
      }
      const progress = Math.min(1, Math.abs(dx) / EDGE_SWIPE_MIN);
      if (progress < 0.06) return;
      overlay.style.setProperty("--swipe-progress", String(progress));
      if (!overlay.classList.contains("is-tracking")) {
        overlay.classList.add("is-tracking");
        const label = overlay.querySelector(".spb-swipe-label");
        if (label) label.textContent = PANEL_TITLES[getNextPanel(activePanel)];
      }
    },
    { passive: true },
  );

  const resetEdgeTouch = () => {
    edgeTouch = null;
    overlay?.classList.remove("is-tracking");
    overlay?.style.removeProperty("--swipe-progress");
  };

  document.addEventListener(
    "touchend",
    (e) => {
      if (!edgeTouch) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - edgeTouch.x;
      const dy = t.clientY - edgeTouch.y;
      const started = edgeTouch;
      resetEdgeTouch();

      if (dx > -EDGE_SWIPE_MIN) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.25) return;
      if (Date.now() - started.time > 700) return;

      playSpbSwipeTransition(getNextPanel(activePanel));
    },
    { passive: true },
  );

  document.addEventListener("touchcancel", resetEdgeTouch, { passive: true });
}

/**
 * Затемнение фона по мере прокрутки. Меняем только opacity —
 * transform на fixed-фоне вызывает дорогую перерисовку на iOS.
 */
function bindScrollGlass() {
  if (prefersReducedMotion()) return;
  let ticking = false;
  let last = -1;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
        const value = Math.round(p * 0.82 * 50) / 50;
        if (value !== last) {
          last = value;
          document.documentElement.style.setProperty("--app-bg-scroll", String(value));
        }
        ticking = false;
      });
    },
    { passive: true },
  );
}

function observeReveals() {
  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            revealObserver.unobserve(e.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -32px 0px" },
    );
  }
  document.querySelectorAll(".reveal:not(.visible)").forEach((el) => revealObserver.observe(el));
}

/**
 * Плавное раскрытие дня. <details> сам по себе открывается рывком,
 * поэтому высоту анимируем вручную и придерживаем закрытие до конца анимации.
 */
function bindDayAccordion() {
  const container = document.getElementById("plan-days");
  if (!container) return;

  container.addEventListener("click", (e) => {
    const summary = e.target.closest("summary");
    if (!summary || !container.contains(summary)) return;

    const details = summary.parentElement;
    const body = details.querySelector(".day-body");
    if (!body) return;

    if (prefersReducedMotion()) return;
    if (details.dataset.animating === "1") {
      e.preventDefault();
      return;
    }

    e.preventDefault();
    details.dataset.animating = "1";

    const styles = getComputedStyle(body);
    const padTop = styles.paddingTop;
    const padBottom = styles.paddingBottom;
    const open = details.open;

    if (!open) details.open = true;

    const full = body.scrollHeight;
    const collapsed = [{ height: "0px", paddingTop: "0px", paddingBottom: "0px", opacity: 0 }];
    const expanded = [{ height: `${full}px`, paddingTop: padTop, paddingBottom: padBottom, opacity: 1 }];

    const anim = body.animate(open ? expanded.concat(collapsed) : collapsed.concat(expanded), {
      duration: open ? 240 : 320,
      easing: open ? "cubic-bezier(0.4, 0, 1, 1)" : "cubic-bezier(0.22, 1, 0.36, 1)",
    });

    if (!open) animateStepsIn(body);

    anim.onfinish = () => {
      if (open) details.open = false;
      details.dataset.animating = "0";
    };
    anim.oncancel = () => {
      details.dataset.animating = "0";
    };
  });
}

function animateStepsIn(body) {
  const steps = body.querySelectorAll(".step");
  steps.forEach((step, i) => {
    step.animate(
      [
        { opacity: 0, transform: "translateX(-10px)" },
        { opacity: 1, transform: "translateX(0)" },
      ],
      {
        duration: 340,
        delay: Math.min(i, 8) * 45,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "backwards",
      },
    );
  });
}

function showUpdateToast(worker) {
  if (document.getElementById("update-toast")) return;
  const toast = document.createElement("div");
  toast.id = "update-toast";
  toast.className = "update-toast";
  toast.setAttribute("role", "status");
  toast.innerHTML = `
    <span class="update-toast-text">План обновился</span>
    <button type="button" class="update-toast-btn">Обновить</button>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  toast.querySelector(".update-toast-btn").addEventListener("click", () => {
    worker.postMessage({ type: "SKIP_WAITING" });
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          if (!next) return;
          next.addEventListener("statechange", () => {
            if (next.state === "installed" && navigator.serviceWorker.controller) {
              showUpdateToast(next);
            }
          });
        });
      })
      .catch(() => {});

    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  });
}

/** Показываем сразу то, что уже в кадре на активной вкладке — без мигания. */
function revealInitialViewport() {
  const panel = document.querySelector(".panel.active");
  const scope = [document.getElementById("hub"), panel].filter(Boolean);
  scope.forEach((root) => {
    root.querySelectorAll(".reveal:not(.visible)").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.top < window.innerHeight * 0.9) el.classList.add("visible");
    });
  });
}

function init() {
  document.body.dataset.panel = activePanel;
  renderHero();
  renderHub();
  renderPlan();
  renderTicketsAndHotel();
  renderBudget();
  renderTodoPanel();
  bindNav();
  bindEdgeSwipeNav();
  bindTodoPanel();
  bindDayAccordion();
  bindScrollGlass();
  observeReveals();
  registerServiceWorker();
  requestAnimationFrame(revealInitialViewport);
}

document.addEventListener("DOMContentLoaded", init);
