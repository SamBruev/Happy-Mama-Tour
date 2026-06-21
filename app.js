const TRANSPORT_LABEL = {
  train: "Поезд",
  carshare: "Каршеринг",
  walk: "Пешком",
  metro: "Метро",
  bus: "Автобус",
  car: "Авто",
};

const STORAGE_KEY = "happy-mama-tour-checks-v2";
let mapInstance = null;
let tourAnimator = null;
let activePanel = "plan";
let leafletLoadPromise = null;
let mapInitStarted = false;

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
  document.getElementById("hub").innerHTML = `
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
}

function renderPlan() {
  const container = document.getElementById("plan-days");
  const today = new Date().toISOString().slice(0, 10);

  container.innerHTML = TRIP.days
    .map((day, idx) => {
      const open = day.date === today || idx === 0 ? " open" : "";
      const steps = day.steps
        .map(
          (step, si) => `
        <div class="step" style="animation-delay:${si * 0.05}s">
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
            ${step.link ? `<a class="btn-link" href="${step.link}" target="_blank" rel="noopener">Билеты</a>` : ""}
          </div>
        </div>
      `,
        )
        .join("");

      return `
        <details class="card day-card reveal"${open}>
          <summary>
            <div class="day-meta">
              <span class="day-label">${day.label}</span>
              <span class="day-summary">${day.weekday} · ${day.summary}</span>
            </div>
          </summary>
          <div class="day-body">
            <div class="timeline">${steps}</div>
          </div>
        </details>
      `;
    })
    .join("");
}

function renderTicketsAndHotel() {
  const ticketsEl = document.getElementById("tickets-block");
  ticketsEl.innerHTML = TRIP.tickets
    .map(
      (t) => `
    <div class="ticket-card">
      <div class="ticket-route">${t.label}</div>
      <div class="ticket-meta">${t.weekday ? t.weekday + " · " : ""}${fmtDate(t.date)} · ${t.train}</div>
      <div class="ticket-meta">${t.from} → ${t.to}</div>
      <div class="ticket-meta">Отправление ${t.depart} · прибытие ${t.arrive}</div>
      <div class="ticket-meta">${t.seats}</div>
      <div class="ticket-meta" style="color:var(--accent);font-weight:700;margin-top:8px">${fmtMoney(t.cost)} ${t.costNote || ""}</div>
      <div class="step-actions" style="margin-top:10px">
        <a class="btn-link" href="${t.link}" target="_blank" rel="noopener">РЖД</a>
      </div>
    </div>
  `,
    )
    .join("");

  const h = TRIP.hotel;
  document.getElementById("hotel-block").innerHTML = `
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
      <span>${i.label}</span>
      <span class="budget-amt">${fmtMoney(i.amount)}</span>
      ${i.note ? `<span class="budget-note">${i.note}</span>` : ""}
    </div>
  `,
    )
    .join("");

  document.getElementById("budget-total-val").textContent = fmtMoney(displayBudget());
}

function renderChecks() {
  const checks = loadChecks();
  const mustEl = document.getElementById("must-see");
  mustEl.innerHTML = TRIP.mustSee
    .map((item) => {
      const done = checks["must-" + item.id] || item.done;
      return `
      <label class="check-item${done ? " done" : ""}">
        <input type="checkbox" data-id="must-${item.id}" ${done ? "checked" : ""}>
        <span class="check-text">${item.name}</span>
        <span class="check-tag">${item.day}</span>
      </label>
    `;
    })
    .join("");

  document.getElementById("packing").innerHTML = TRIP.packing
    .map((item) => {
      const done = checks["pack-" + item.id] || item.done;
      return `
      <label class="check-item${done ? " done" : ""}">
        <input type="checkbox" data-id="pack-${item.id}" ${done ? "checked" : ""}>
        <span class="check-text">${item.text}</span>
      </label>
    `;
    })
    .join("");
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

function bindChecks() {
  document.getElementById("checks-panel").addEventListener("change", (e) => {
    const input = e.target.closest("[data-id]");
    if (!input) return;
    const checks = loadChecks();
    checks[input.dataset.id] = input.checked;
    saveChecks(checks);
    input.closest(".check-item").classList.toggle("done", input.checked);
  });
}

function bindNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activePanel = btn.dataset.nav;
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === activePanel));
      if (activePanel === "map") {
        initMap();
        setTimeout(() => mapInstance?.invalidateSize(), 120);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
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

function bindReveal() {
  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("visible");
          obs.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
  );
  document.querySelectorAll(".reveal").forEach((el) => obs.observe(el));
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
  renderChecks();
  bindNav();
  bindChecks();
  bindScrollGlass();
  bindReveal();
  registerServiceWorker();
  requestAnimationFrame(() => document.querySelectorAll(".reveal:not(.visible)").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight) el.classList.add("visible");
  }));
}

document.addEventListener("DOMContentLoaded", init);
