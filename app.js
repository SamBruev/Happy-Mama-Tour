const TRANSPORT_LABEL = {
  train: "Поезд",
  carshare: "Каршеринг",
  walk: "Пешком",
  metro: "Метро",
  bus: "Автобус",
  car: "Авто",
};

const STORAGE_KEY = "happy-mama-tour-checks-v2";
const HIDDEN_KEY = "happy-mama-tour-hidden-v1";
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
let swipeRowTouch = null;
let openSwipeRow = null;

const SWIPE_DELETE_W = 96;
const SWIPE_DELETE_OPEN = 52;

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

function yandexMap(lat, lon, label) {
  const ll = `${lon}%2C${lat}`;
  const text = encodeURIComponent(label || "");
  return `https://yandex.ru/maps/?pt=${lon},${lat}&z=15&text=${text}`;
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

function loadHidden() {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveHidden(set) {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set]));
}

function isHidden(key) {
  return loadHidden().has(key);
}

function hideItem(key) {
  const hidden = loadHidden();
  hidden.add(key);
  saveHidden(hidden);
}

function wrapSwipeRow(key, innerHtml, extraClass = "") {
  return `
    <div class="swipe-row${extraClass ? ` ${extraClass}` : ""}" data-hide-key="${key}">
      <div class="swipe-row__surface">${innerHtml}</div>
      <button type="button" class="swipe-row__delete" aria-label="Удалить пункт">УДАЛИТЬ</button>
    </div>
  `;
}

function closeSwipeRow(row) {
  if (!row) return;
  row.classList.remove("is-open");
  row.querySelector(".swipe-row__surface")?.style.removeProperty("transform");
  if (openSwipeRow === row) openSwipeRow = null;
}

function refreshAfterDelete() {
  renderHero();
  renderHub();
  renderPlan();
  renderTicketsAndHotel();
  renderBudget();
  renderTodoPanel();
  observeReveals();
  updateTodoBadges();
}

function removeSwipeRow(row, key) {
  hideItem(key);
  closeSwipeRow(row);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    refreshAfterDelete();
    return;
  }
  row.classList.add("swipe-row--hide");
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    refreshAfterDelete();
  };
  row.addEventListener("transitionend", finish, { once: true });
  window.setTimeout(finish, 520);
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
    if (!isHidden("todo:hotel-book")) {
      items.push({
        id: "hotel-book",
        storage: "todo",
        text: "Забронировать отель",
        detail: `7 ночей · заезд ${fmtDate(h.checkIn)}${h.lateCheckIn ? " · поздний ~00:30" : ""}`,
        urgent: true,
      });
    }
  }

  TRIP.tickets.forEach((t) => {
    if (isHidden(`ticket:${t.id}`)) return;
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
    if (isHidden(`day:${day.id}`)) return;
    day.steps.forEach((step, si) => {
      if (isHidden(`step:${day.id}:${si}`)) return;
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
    if (isHidden(`todo:${t.id}`)) return;
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
  return TRIP.packing.filter((item) => !isHidden(`pack:${item.id}`) && !isPrepareDone(item)).length;
}

function dismissTaskRow(row) {
  if (!row) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    row.remove();
    return;
  }
  row.classList.add("task-item--hide");
  row.addEventListener("transitionend", () => row.remove(), { once: true });
}

function updateTodoBadges() {
  const pending = countPendingDo() + countPendingPrepare();
  document.querySelector('[data-nav="todo"]')?.classList.toggle("nav-btn--alert", pending > 0);
}

function renderDoItem(item) {
  const done = isDoItemDone(item);
  if (done) return "";
  const key = item.storage === "ticket" ? `ticket:${item.id}` : `todo:${item.id}`;
  if (isHidden(key)) return "";
  return wrapSwipeRow(
    key,
    `
    <div class="task-item task-item--urgent" data-task-wrap="${item.id}">
      <label class="task-check">
        <input type="checkbox" data-do-id="${item.id}" data-do-storage="${item.storage}" aria-label="Готово: ${item.text}">
      </label>
      <div class="task-body">
        <span class="task-title">${item.text}</span>
        ${item.detail ? `<span class="task-detail">${item.detail}</span>` : ""}
      </div>
      ${item.link ? `<a class="btn-link btn-link-urgent task-link" href="${item.link}" target="_blank" rel="noopener">${item.linkLabel || "Открыть"}</a>` : ""}
    </div>
  `,
    "swipe-row--task",
  );
}

function renderPrepareItem(item) {
  if (isHidden(`pack:${item.id}`)) return "";
  const done = isPrepareDone(item);
  return wrapSwipeRow(
    `pack:${item.id}`,
    `
    <label class="task-item task-item--prepare${done ? " task-item--done" : ""}">
      <input type="checkbox" data-id="pack-${item.id}" ${done ? "checked" : ""} aria-label="${item.text}">
      <div class="task-body">
        <span class="task-title">${item.text}</span>
      </div>
    </label>
  `,
    "swipe-row--task",
  );
}

function sumStepCosts() {
  let total = 0;
  TRIP.days.forEach((day) => {
    if (isHidden(`day:${day.id}`)) return;
    day.steps.forEach((step, si) => {
      if (isHidden(`step:${day.id}:${si}`)) return;
      if (typeof step.cost === "number") total += step.cost;
    });
  });
  return total;
}

function sumBudget() {
  const fixed = TRIP.budgetFixed
    .filter((b) => !["hotel", "train"].includes(b.id) && !isHidden(`budget:${b.id}`))
    .reduce((s, i) => s + (i.amount || 0), 0);
  const daily = isHidden("budget:rollup:daily") ? 0 : sumStepCosts();
  const tickets = isHidden("budget:rollup:trains")
    ? 0
    : TRIP.tickets.filter((t) => !isHidden(`ticket:${t.id}`)).reduce((s, t) => s + (t.cost || 0), 0);
  const hotel = isHidden("budget:rollup:hotel") || isHidden("hotel:main")
    ? 0
    : (TRIP.hotel.costPerNight || 0) * (TRIP.hotel.nights || 0);
  return fixed + daily + tickets + hotel;
}

function displayBudget() {
  return typeof TRIP.meta.budget === "number" ? TRIP.meta.budget : sumBudget();
}

function renderHero() {
  const el = document.getElementById("hero");
  el.innerHTML = `
    <div class="hero-ornament"><span>СПБ</span></div>
    <div class="hero-script">${TRIP.meta.title}</div>
    <div class="hero-city">Санкт-Петербург</div>
    <div class="hero-dates">${fmtDate(TRIP.meta.start)} — ${fmtDate(TRIP.meta.end)}</div>
    <div class="hero-sub">${TRIP.meta.subtitle}</div>
  `;
}

function renderHub() {
  const total = displayBudget();
  const doLeft = countPendingDo();
  const prepLeft = countPendingPrepare();
  const todoBanner =
    doLeft + prepLeft > 0
      ? `
    <button type="button" class="todo-hub card card-glass reveal" id="todo-hub-btn">
      <div class="todo-hub-grid">
        <div class="todo-hub-cell${doLeft ? " todo-hub-cell--urgent" : ""}">
          <span class="todo-hub-num">${doLeft}</span>
          <span class="todo-hub-lbl">сделать</span>
        </div>
        <div class="todo-hub-cell">
          <span class="todo-hub-num">${prepLeft}</span>
          <span class="todo-hub-lbl">подготовить</span>
        </div>
      </div>
      <span class="todo-hub-cta">Открыть список дел →</span>
    </button>`
      : `
    <div class="todo-hub card card-glass reveal todo-hub--done">
      <span class="todo-hub-done">✓ Всё готово к поездке</span>
    </div>`;

  document.getElementById("hub").innerHTML = `
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
          <span class="stat-lbl">бюджет ₽</span>
        </div>
      </div>
    </div>
  `;

  document.getElementById("todo-hub-btn")?.addEventListener("click", () => {
    document.querySelector('[data-nav="todo"]')?.click();
  });
  updateTodoBadges();
}

function renderPlanStep(day, step, si) {
  const ticketId = step.link ? step.ticketId || `${day.id}-s${si}` : null;
  const needsTicket = ticketId && !isTicketBought(ticketId);
  return wrapSwipeRow(
    `step:${day.id}:${si}`,
    `
      <div class="step${needsTicket ? " step--needs-ticket" : ""}" style="animation-delay:${si * 0.05}s">
        <div class="step-head">
          <span class="step-time">${step.time || "—"}</span>
          <span class="step-title">${step.title}</span>
          ${step.transport ? `<span class="step-transport" data-t="${step.transport}">${TRANSPORT_LABEL[step.transport] || step.transport}</span>` : ""}
        </div>
        ${step.detail ? `<p class="step-detail">${step.detail}</p>` : ""}
        ${step.address ? `<p class="step-address">${step.address}</p>` : ""}
        ${step.cost != null ? `<p class="step-cost">${fmtMoney(step.cost)}${step.costNote ? ` · ${step.costNote}` : ""}</p>` : ""}
        ${
          step.tips?.length
            ? `<ul class="step-tips">${step.tips.map((t) => `<li>${t}</li>`).join("")}</ul>`
            : ""
        }
        <div class="step-actions">
          ${
            step.lat != null
              ? `<a class="btn-link" href="${yandexMap(step.lat, step.lon, step.title)}" target="_blank" rel="noopener">Карта</a>`
              : ""
          }
          ${
            step.link
              ? `<a class="btn-link${needsTicket ? " btn-link-urgent" : ""}" href="${step.link}" target="_blank" rel="noopener">Билеты</a>`
              : ""
          }
        </div>
      </div>
    `,
    "swipe-row--step",
  );
}

function renderPlan() {
  const container = document.getElementById("plan-days");
  const today = new Date().toISOString().slice(0, 10);

  container.innerHTML = TRIP.days
    .map((day, idx) => {
      if (isHidden(`day:${day.id}`)) return "";
      const visibleSteps = day.steps
        .map((step, si) => ({ step, si }))
        .filter(({ si }) => !isHidden(`step:${day.id}:${si}`));
      if (!visibleSteps.length) return "";

      const open = day.date === today || idx === 0 ? " open" : "";
      const steps = visibleSteps.map(({ step, si }) => renderPlanStep(day, step, si)).join("");

      return wrapSwipeRow(
        `day:${day.id}`,
        `
        <details class="card day-card reveal"${open}>
          <summary>
            <div class="day-date-badge" aria-hidden="true">
              <span class="day-date-num">${fmtDayNum(day.date)}</span>
              <span class="day-date-mon">${fmtMonthShort(day.date)}</span>
            </div>
            <div class="day-meta">
              <span class="day-label">${day.label}</span>
              <span class="day-summary">${day.weekday} · ${day.summary}</span>
            </div>
          </summary>
          <div class="day-body">
            <div class="timeline">${steps}</div>
          </div>
        </details>
      `,
        "swipe-row--day",
      );
    })
    .join("");
}

function renderTicketsAndHotel() {
  const ticketsEl = document.getElementById("tickets-block");
  ticketsEl.innerHTML = TRIP.tickets
    .filter((t) => !isHidden(`ticket:${t.id}`))
    .map((t) => {
      const bought = isTicketBought(t.id);
      return wrapSwipeRow(
        `ticket:${t.id}`,
        `
    <div class="ticket-card${bought ? " ticket-card--bought" : " ticket-card--pending"}">
      <div class="ticket-route">${t.label}</div>
      <div class="ticket-meta">${t.weekday ? t.weekday + " · " : ""}${fmtDate(t.date)} · ${t.train}</div>
      <div class="ticket-meta">${t.from} → ${t.to}</div>
      <div class="ticket-meta">Отправление ${t.depart} · прибытие ${t.arrive}</div>
      <div class="ticket-meta">${t.seats}</div>
      <div class="ticket-meta" style="color:var(--accent);font-weight:700;margin-top:8px">${fmtMoney(t.cost)} ${t.costNote || ""}</div>
      <div class="step-actions" style="margin-top:10px">
        ${
          bought
            ? `<span class="ticket-done-tag">✓ Куплено</span>`
            : `<a class="btn-link btn-link-urgent" href="${t.link}" target="_blank" rel="noopener">Купить на РЖД</a>`
        }
      </div>
    </div>
  `,
        "swipe-row--ticket",
      );
    })
    .join("");

  const h = TRIP.hotel;
  if (isHidden("hotel:main")) {
    document.getElementById("hotel-block").innerHTML = "";
    return;
  }

  document.getElementById("hotel-block").innerHTML = wrapSwipeRow(
    "hotel:main",
    `
    <div class="hotel-block">
      <div class="hotel-name">${h.name}</div>
      <div class="hotel-row"><b>Адрес:</b> ${h.address}</div>
      <div class="hotel-row"><b>Заезд:</b> ${fmtDate(h.checkIn)} с ${h.checkInFrom}${h.lateCheckIn ? " (ночной заезд)" : ""}</div>
      <div class="hotel-row"><b>Выезд:</b> ${fmtDate(h.checkOut)}</div>
      <div class="hotel-row"><b>Бронь:</b> ${h.bookingRef}</div>
      <div class="hotel-row"><b>Телефон:</b> <a href="tel:${h.phone.replace(/\s/g, "")}">${h.phone}</a></div>
      <div class="hotel-row"><b>Стоимость:</b> ${fmtMoney(h.costPerNight)} × ${h.nights} = ${fmtMoney(h.costPerNight * h.nights)}</div>
      <div class="hotel-row">${h.notes}</div>
      <div class="step-actions" style="margin-top:12px">
        <a class="btn-link" href="${yandexMap(h.lat, h.lon, h.name)}" target="_blank" rel="noopener">Яндекс.Карты</a>
      </div>
    </div>
  `,
    "swipe-row--hotel",
  );
}

function renderBudget() {
  const rows = document.getElementById("budget-rows");
  const hotelTotal = isHidden("hotel:main") ? 0 : TRIP.hotel.costPerNight * TRIP.hotel.nights;
  const ticketTotal = TRIP.tickets
    .filter((t) => !isHidden(`ticket:${t.id}`))
    .reduce((s, t) => s + (t.cost || 0), 0);
  const dailyTotal = sumStepCosts();

  const items = [
    { key: "budget:rollup:hotel", label: "Отель", amount: hotelTotal, note: `${TRIP.hotel.nights} ночей` },
    { key: "budget:rollup:trains", label: "Ж/д билеты", amount: ticketTotal, note: "туда + обратно" },
    ...TRIP.budgetFixed
      .filter((b) => !["hotel", "train"].includes(b.id))
      .map((b) => ({ key: `budget:${b.id}`, ...b })),
    {
      key: "budget:rollup:daily",
      label: "По дням (транспорт, еда, входы)",
      amount: dailyTotal,
      note: "из расписания",
    },
  ].filter((i) => !isHidden(i.key));

  rows.innerHTML = items
    .map(
      (i) => wrapSwipeRow(
        i.key,
        `
    <div class="budget-row">
      <span>${i.label}</span>
      <span class="budget-amt">${fmtMoney(i.amount)}</span>
      ${i.note ? `<span class="budget-note">${i.note}</span>` : ""}
    </div>
  `,
        "swipe-row--budget",
      ),
    )
    .join("");

  document.getElementById("budget-total-val").textContent = fmtMoney(displayBudget());
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
    <p class="todo-summary-hint">Галочка — готово · свайп влево — <span class="todo-summary-delete">удалить</span></p>
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
            `<a class="btn-link btn-link-site" href="${l.href}" target="_blank" rel="noopener">${l.label}</a>`,
        )
        .join("")}
    </div>`;
}

function renderMustSee() {
  const checks = loadChecks();
  document.getElementById("must-see").innerHTML = TRIP.mustSee
    .filter((item) => !isHidden(`must:${item.id}`))
    .map((item) => {
      const done = checks["must-" + item.id] || item.done;
      const links = renderOfficialLinks(item);
      return wrapSwipeRow(
        `must:${item.id}`,
        `
      <div class="visit-item${links ? " visit-item--has-links" : ""}">
        <label class="check-item${done ? " done" : ""}">
          <input type="checkbox" data-id="must-${item.id}" ${done ? "checked" : ""}>
          <span class="check-text">${item.name}</span>
          <span class="check-tag">${item.day}</span>
        </label>
        ${links}
      </div>
    `,
        "swipe-row--visit",
      );
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
  if (mapInitStarted && mapInstance) {
    setTimeout(() => mapInstance.invalidateSize(), 120);
    return;
  }

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

      setTimeout(() => mapInstance.invalidateSize(), 200);
    })
    .catch(() => {
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
        dismissTaskRow(doInput.closest("[data-task-wrap]"));
        setTimeout(() => {
          renderTodoDo();
          refreshAfterTodoChange();
        }, 460);
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
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyPanelSwitch(btn.dataset.nav, { scroll: "smooth" });
    });
  });
}

function getNextPanel(current) {
  const idx = PANEL_ORDER.indexOf(current);
  return PANEL_ORDER[(idx + 1) % PANEL_ORDER.length];
}

function refreshPanelsContent() {
  renderHero();
  renderHub();
  renderPlan();
  renderTicketsAndHotel();
  renderBudget();
  renderTodoPanel();
  observeReveals();
}

function applyPanelSwitch(panelId, { scroll = "auto" } = {}) {
  if (panelId === activePanel) return;
  activePanel = panelId;
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.nav === activePanel);
  });
  document.querySelectorAll(".panel").forEach((p) => {
    p.classList.toggle("active", p.dataset.panel === activePanel);
  });
  if (activePanel === "map") {
    initMap();
    setTimeout(() => mapInstance?.invalidateSize(), 120);
  } else {
    tourAnimator?.pause?.();
  }
  window.scrollTo({ top: 0, behavior: scroll });
}

function playSpbSwipeTransition(nextPanel) {
  if (swipeBusy) return;
  swipeBusy = true;

  const overlay = document.getElementById("spb-swipe-overlay");
  const label = overlay?.querySelector(".spb-swipe-label");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (label) label.textContent = PANEL_TITLES[nextPanel] || nextPanel;

  if (reduced || !overlay) {
    refreshPanelsContent();
    applyPanelSwitch(nextPanel);
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
    refreshPanelsContent();
    if (leavingPanel) {
      leavingPanel.classList.remove("active", "spb-enter");
      leavingPanel.classList.add("spb-exit");
    }

    window.setTimeout(() => {
      applyPanelSwitch(nextPanel);
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
      if (e.target.closest(".swipe-row")) return;
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

function bindSwipeDelete() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".swipe-row__delete");
    if (btn) {
      e.preventDefault();
      const row = btn.closest(".swipe-row");
      const key = row?.dataset.hideKey;
      if (row && key) removeSwipeRow(row, key);
      return;
    }
    if (!e.target.closest(".swipe-row") && openSwipeRow) closeSwipeRow(openSwipeRow);
  });

  document.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      const surface = e.target.closest(".swipe-row__surface");
      if (!surface) return;
      if (e.target.closest("a, button, input, .swipe-row__delete")) return;

      const t = e.touches[0];
      if (t.clientX > window.innerWidth - EDGE_SWIPE_ZONE) return;

      const row = surface.closest(".swipe-row");
      if (!row) return;

      if (openSwipeRow && openSwipeRow !== row) closeSwipeRow(openSwipeRow);

      swipeRowTouch = {
        row,
        surface,
        startX: t.clientX,
        startY: t.clientY,
        baseX: row.classList.contains("is-open") ? -SWIPE_DELETE_W : 0,
        moved: false,
      };
    },
    { passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!swipeRowTouch) return;
      const t = e.touches[0];
      const dx = t.clientX - swipeRowTouch.startX;
      const dy = t.clientY - swipeRowTouch.startY;

      if (!swipeRowTouch.moved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
        swipeRowTouch = null;
        return;
      }
      if (Math.abs(dx) < 4) return;

      swipeRowTouch.moved = true;
      const x = Math.max(-SWIPE_DELETE_W, Math.min(0, swipeRowTouch.baseX + dx));
      swipeRowTouch.surface.style.transform = `translateX(${x}px)`;
      e.preventDefault();
    },
    { passive: false },
  );

  document.addEventListener(
    "touchend",
    (e) => {
      if (!swipeRowTouch) return;
      const { row, surface, startX, baseX, moved } = swipeRowTouch;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      swipeRowTouch = null;

      if (!moved) return;

      surface.style.removeProperty("transform");
      const finalX = baseX + dx;

      if (finalX <= -SWIPE_DELETE_OPEN) {
        row.classList.add("is-open");
        openSwipeRow = row;
      } else {
        closeSwipeRow(row);
      }

      const summary = surface.querySelector("summary");
      if (summary) {
        summary.addEventListener(
          "click",
          (ev) => {
            ev.preventDefault();
            ev.stopImmediatePropagation();
          },
          { capture: true, once: true },
        );
      }
    },
    { passive: true },
  );

  document.addEventListener(
    "touchcancel",
    () => {
      if (!swipeRowTouch) return;
      swipeRowTouch.surface.style.removeProperty("transform");
      swipeRowTouch = null;
    },
    { passive: true },
  );
}

function bindScrollGlass() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
        document.documentElement.style.setProperty("--app-bg-scroll", String(p * 0.82));
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
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
  }
  document.querySelectorAll(".reveal:not(.visible)").forEach((el) => revealObserver.observe(el));
}

function bindReveal() {
  observeReveals();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

function init() {
  renderHero();
  renderHub();
  renderPlan();
  renderTicketsAndHotel();
  renderBudget();
  renderTodoPanel();
  bindNav();
  bindEdgeSwipeNav();
  bindSwipeDelete();
  bindTodoPanel();
  bindScrollGlass();
  bindReveal();
  registerServiceWorker();
  requestAnimationFrame(() => document.querySelectorAll(".reveal:not(.visible)").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight) el.classList.add("visible");
  }));
}

document.addEventListener("DOMContentLoaded", init);
