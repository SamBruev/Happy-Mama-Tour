/** Анимация движения по маршруту на карте Leaflet */
const TRANSPORT_ICON = {
  train: "🚆",
  carshare: "🚗",
  bus: "⛴",
  walk: "🚶",
  metro: "🚇",
  car: "🚗",
};

const reduceMotionQuery =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

function prefersReducedMotion() {
  return !!reduceMotionQuery && reduceMotionQuery.matches;
}

function getVehicleKind(transport) {
  if (transport === "train") return "train";
  if (transport === "carshare" || transport === "car") return "car";
  if (transport === "bus") return "ferry";
  if (transport === "metro") return "metro";
  if (transport === "walk") return "walk";
  return "default";
}

/**
 * Эмодзи НЕ вращаем. Это не спрайты «вид сверху»: у Apple/Noto
 * 🚆 и 🚇 нарисованы анфас, 🚗 ⛴ 🚶 — сбоку и смотрят ВЛЕВО.
 * Любой поворот по курсу укладывает такую картинку на бок.
 * Транспорт всегда стоит вертикально; боковым видам только зеркалим
 * горизонталь, когда едем на восток. Направление движения и так
 * показывают золотая линия и сама карта.
 */
const SIDE_VIEW_KINDS = new Set(["car", "ferry", "walk"]);

function vehicleShellStyle(kind, headingEast) {
  const mirror = SIDE_VIEW_KINDS.has(kind) && headingEast;
  return `--flipx:${mirror ? -1 : 1}`;
}

function buildVehicleMarkerHtml(transport, headingEast) {
  const kind = getVehicleKind(transport);
  const style = vehicleShellStyle(kind, headingEast);
  const icon = TRANSPORT_ICON[transport] || "📍";

  if (kind === "train") {
    return `
      <div class="tour-vehicle-shell" style="${style}">
        <div class="tour-vehicle tour-vehicle--train">
          <span class="tour-smoke tour-smoke-1"></span>
          <span class="tour-smoke tour-smoke-2"></span>
          <span class="tour-smoke tour-smoke-3"></span>
          <span class="tour-vehicle-icon" aria-hidden="true">🚆</span>
        </div>
      </div>`;
  }

  if (kind === "car") {
    return `
      <div class="tour-vehicle-shell" style="${style}">
        <div class="tour-vehicle tour-vehicle--car">
          <span class="tour-car-dust tour-car-dust-1"></span>
          <span class="tour-car-dust tour-car-dust-2"></span>
          <span class="tour-vehicle-icon" aria-hidden="true">🚗</span>
        </div>
      </div>`;
  }

  if (kind === "ferry") {
    return `
      <div class="tour-vehicle-shell" style="${style}">
        <div class="tour-vehicle tour-vehicle--ferry">
          <span class="tour-wave tour-wave-1"></span>
          <span class="tour-wave tour-wave-2"></span>
          <span class="tour-ferry-smoke"></span>
          <span class="tour-vehicle-icon" aria-hidden="true">⛴</span>
        </div>
      </div>`;
  }

  if (kind === "metro") {
    return `
      <div class="tour-vehicle-shell" style="${style}">
        <div class="tour-vehicle tour-vehicle--metro">
          <span class="tour-vehicle-icon" aria-hidden="true">🚇</span>
        </div>
      </div>`;
  }

  if (kind === "walk") {
    return `
      <div class="tour-vehicle-shell" style="${style}">
        <div class="tour-vehicle tour-vehicle--walk">
          <span class="tour-vehicle-icon" aria-hidden="true">🚶</span>
        </div>
      </div>`;
  }

  return `
    <div class="tour-vehicle-shell" style="${style}">
      <div class="tour-vehicle tour-vehicle--default">
        <span class="tour-marker-pulse"></span>
        <span class="tour-vehicle-icon" aria-hidden="true">${icon}</span>
      </div>
    </div>`;
}

function createVehicleIcon(transport, headingEast) {
  const size = 56;
  return L.divIcon({
    className: "tour-marker-wrap",
    html: buildVehicleMarkerHtml(transport, headingEast),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const TourAnimator = (function () {
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Кубический ease-in-out почти останавливал транспорт в начале и в конце
   * каждого этапа — со стороны это читалось как рывки. Здесь плавный разгон
   * и торможение занимают по 20 % пути, остальные 60 % — равномерный ход.
   */
  function easeTravel(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    if (t < 0.2) return 3.125 * t * t;
    if (t > 0.8) {
      const u = 1 - t;
      return 1 - 3.125 * u * u;
    }
    return 1.25 * t - 0.125;
  }

  function linear(t) {
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  function TourAnimatorInstance(map, route, legs) {
    this.map = map;
    this.route = route;
    this.legs = legs;
    this.playing = false;
    this.cancelled = false;
    this.legIndex = 0;
    this.legProgress = 0;
    this.resumeProgress = 0;
    this.marker = null;
    this.plannedLine = null;
    this.traveledLine = null;
    this.traveledPoints = [];
    this.livePoints = null;
    this.onUpdate = null;
    this.currentTransport = null;
    this.followZoom = null;

    /** Состояние копится здесь, поэтому частичные emitUpdate не ломают UI. */
    this.state = {
      legIndex: -1,
      progress: 0,
      stop: route[0],
      label: "Готовы к путешествию",
      transport: null,
      playing: false,
      paused: false,
      done: false,
    };

    const coords = route.map((p) => [p.lat, p.lon]);
    this.plannedLine = L.polyline(coords, {
      color: "rgba(201, 162, 39, 0.35)",
      weight: 3,
      dashArray: "8 10",
      lineCap: "round",
    }).addTo(map);

    this.traveledLine = L.polyline([], {
      color: "#e8c547",
      weight: 4,
      lineCap: "round",
    }).addTo(map);

    const icon = createVehicleIcon(null, 0);

    this.marker = L.marker(coords[0], { icon, zIndexOffset: 1000, keyboard: false }).addTo(map);

    route.forEach((stop, i) => {
      L.circleMarker([stop.lat, stop.lon], {
        radius: i === 0 ? 7 : 5,
        color: "#c9a227",
        fillColor: "#faf8f4",
        fillOpacity: 0.9,
        weight: 2,
      })
        .bindTooltip(stop.name, { direction: "top", offset: [0, -6] })
        .addTo(map);
    });

    this.overviewBounds = this.plannedLine.getBounds();
    map.fitBounds(this.overviewBounds, { padding: [36, 36], maxZoom: 7 });
  }

  TourAnimatorInstance.prototype.setUpdateHandler = function (fn) {
    this.onUpdate = fn;
  };

  /**
   * После invalidateSize (смена вкладки, поворот экрана) зум не пересчитывается
   * сам — маршрут оказывается обрезанным. Возвращаем обзор, если тур не идёт.
   */
  TourAnimatorInstance.prototype.refit = function () {
    if (this.playing || this.legProgress > 0) return;
    this.map.fitBounds(this.overviewBounds, { padding: [36, 36], maxZoom: 7, animate: false });
  };

  TourAnimatorInstance.prototype.setVehicle = function (transport, from, to) {
    const headingEast = !!(from && to && to.lon > from.lon);
    this.currentTransport = transport;
    this.marker.setIcon(createVehicleIcon(transport, headingEast));
  };

  TourAnimatorInstance.prototype.emitUpdate = function (payload) {
    this.state = Object.assign({}, this.state, payload);
    if (this.onUpdate) this.onUpdate(this.state);
  };

  TourAnimatorInstance.prototype.reset = function () {
    this.cancelled = true;
    this.playing = false;
    this.legIndex = 0;
    this.legProgress = 0;
    this.resumeProgress = 0;
    this.followZoom = null;
    this.map.stop();
    this.setTouring(false);
    this.traveledPoints = [[this.route[0].lat, this.route[0].lon]];
    this.livePoints = null;
    this.traveledLine.setLatLngs(this.traveledPoints);
    this.marker.setLatLng(this.traveledPoints[0]);
    this.setVehicle(null, null, null);
    this.map.fitBounds(this.overviewBounds, {
      padding: [36, 36],
      maxZoom: 7,
      animate: !prefersReducedMotion(),
    });
    this.emitUpdate({
      legIndex: -1,
      progress: 0,
      stop: this.route[0],
      label: "Готовы к путешествию",
      transport: null,
      playing: false,
      paused: false,
      done: false,
    });
  };

  /**
   * Камера работает в двух режимах.
   *
   * Короткий этап (< 80 км): показываем целиком, камера стоит на месте.
   * Длинный этап: неторопливый подлёт к точке старта, а во время движения
   * карту везёт цепочка ЛИНЕЙНЫХ панов (runFollowCamera). Один пан — одна
   * композитная CSS-анимация панели: линии маршрута при этом не
   * перепроецируются, поэтому пунктир соседних путей стоит как вкопанный.
   * Прежний вариант — setView на каждом кадре — заставлял Leaflet заново
   * строить все пути 60 раз в секунду с округлением до пикселя:
   * отсюда и «дрожащий пунктир», и ступенчатое движение карты.
   */
  TourAnimatorInstance.prototype.frameLeg = function (from, to) {
    const km = haversineKm(from, to);
    this.followZoom = null;

    if (km > 80 && !prefersReducedMotion()) {
      // Чем длиннее этап, тем дальше камера, но не дальше z7 и не ближе z10.
      this.followZoom = Math.max(7, Math.min(10, Math.round(11 - Math.log2(km / 40))));
      return this.flyAndSettle(() =>
        this.map.flyTo([from.lat, from.lon], this.followZoom, {
          duration: 1.3,
          easeLinearity: 0.18,
        }),
      );
    }

    const bounds = L.latLngBounds([
      [from.lat, from.lon],
      [to.lat, to.lon],
    ]).pad(0.3);
    const opts = { padding: [30, 30], maxZoom: 13 };

    if (prefersReducedMotion()) {
      this.map.fitBounds(bounds, Object.assign({ animate: false }, opts));
      return Promise.resolve();
    }
    return this.flyAndSettle(() =>
      this.map.flyToBounds(
        bounds,
        Object.assign({ duration: 1.15, easeLinearity: 0.18 }, opts),
      ),
    );
  };

  /** Ждём посадки камеры; страховка по таймеру, чтобы тур не завис. */
  TourAnimatorInstance.prototype.flyAndSettle = function (fly) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.map.off("moveend", finish);
        // Короткая пауза после посадки — перелёт не «врезается» в движение.
        setTimeout(resolve, 160);
      };
      this.map.on("moveend", finish);
      fly();
      setTimeout(finish, 2100);
    });
  };

  /**
   * Follow-cam без покадрового setView: карту везём цепочкой равных
   * линейных панов (~0.9 с каждый). Скорость на стыках непрерывна,
   * тайлы догружаются на каждом moveend, а маркер и панель карты
   * анимируются каждый своим слоем — конфликтов нет.
   */
  TourAnimatorInstance.prototype.runFollowCamera = async function (to, endsAt) {
    const map = this.map;
    const zoom = this.followZoom;
    const STEP_MS = 900;

    while (!this.cancelled && this.followZoom != null) {
      const remain = endsAt - performance.now();
      if (remain <= 60) break;

      const step = Math.min(STEP_MS, remain);
      const centerPx = map.project(map.getCenter(), zoom);
      const targetPx = map.project([to.lat, to.lon], zoom);
      const nextPx = centerPx.add(targetPx.subtract(centerPx).multiplyBy(step / remain));
      const next = map.unproject(nextPx, zoom);

      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          map.off("moveend", finish);
          resolve();
        };
        map.on("moveend", finish);
        map.panTo(next, {
          animate: true,
          duration: step / 1000,
          easeLinearity: 1, // строго линейно — стыки панов не видны
          noMoveStart: true,
        });
        setTimeout(finish, step + 300);
      });
    }
  };

  TourAnimatorInstance.prototype.animateLeg = async function (leg, legIdx, startProgress) {
    const from = this.route[leg.from];
    const to = this.route[leg.to];
    const duration = leg.durationMs || 3000;
    const offset = Math.min(0.98, Math.max(0, startProgress || 0));

    this.setVehicle(leg.transport, from, to);

    // Сначала подписи — видно, куда поедем, пока камера подлетает.
    this.emitUpdate({
      legIndex: legIdx,
      progress: offset,
      stop: to,
      label: leg.label,
      transport: leg.transport,
      playing: true,
      paused: false,
      done: false,
    });

    await this.frameLeg(from, to);
    if (this.cancelled) return;

    this.livePoints = this.traveledPoints.slice();
    this.livePoints.push([from.lat, from.lon]);

    const start = performance.now() - offset * duration;
    let lastUiAt = 0;

    // На follow-этапах маркер движется линейно — в темпе камеры,
    // иначе транспорт плавал бы по экрану вперёд-назад.
    const ease = this.followZoom != null ? linear : easeTravel;

    if (this.followZoom != null) {
      this.runFollowCamera(to, start + duration);
    }

    return new Promise((resolve) => {
      const tick = (now) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const raw = Math.min(1, (now - start) / duration);
        const t = ease(raw);
        const lat = lerp(from.lat, to.lat, t);
        const lon = lerp(from.lon, to.lon, t);

        this.legProgress = raw;
        this.marker.setLatLng([lat, lon]);

        const head = this.livePoints[this.livePoints.length - 1];
        head[0] = lat;
        head[1] = lon;
        this.traveledLine.setLatLngs(this.livePoints);

        // Список остановок и прогресс — 10 раз в секунду, а не 60:
        // перебор 14 элементов с getBoundingClientRect каждый кадр давал джанк.
        if (now - lastUiAt > 95 || raw >= 1) {
          lastUiAt = now;
          this.emitUpdate({ legIndex: legIdx, progress: raw, playing: true });
        }

        if (raw < 1) {
          requestAnimationFrame(tick);
        } else {
          this.traveledPoints.push([to.lat, to.lon]);
          this.livePoints = null;
          this.traveledLine.setLatLngs(this.traveledPoints);
          this.marker.setLatLng([to.lat, to.lon]);
          this.legProgress = 1;
          this.followZoom = null; // останавливает цепочку панов
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  };

  /** Транспорт «едет» (качается, дымит) только пока тур реально идёт. */
  TourAnimatorInstance.prototype.setTouring = function (on) {
    this.map.getContainer().classList.toggle("touring", !!on);
  };

  TourAnimatorInstance.prototype.play = async function () {
    if (this.playing) return;
    this.playing = true;
    this.cancelled = false;
    this.setTouring(true);

    if (this.legIndex >= this.legs.length) {
      this.legIndex = 0;
      this.resumeProgress = 0;
      this.traveledPoints = [[this.route[0].lat, this.route[0].lon]];
      this.traveledLine.setLatLngs(this.traveledPoints);
    }

    const startIndex = this.legIndex;
    const startFrom = this.resumeProgress;
    this.resumeProgress = 0;

    for (let i = startIndex; i < this.legs.length; i++) {
      if (this.cancelled) break;
      this.legIndex = i;
      await this.animateLeg(this.legs[i], i, i === startIndex ? startFrom : 0);
      if (this.cancelled) break;
      await new Promise((r) => setTimeout(r, 260));
    }

    this.playing = false;
    this.setTouring(false);

    if (!this.cancelled && this.legIndex >= this.legs.length - 1) {
      this.legIndex = this.legs.length;
      this.map.flyToBounds(this.overviewBounds, {
        padding: [36, 36],
        maxZoom: 7,
        duration: prefersReducedMotion() ? 0 : 1.4,
        easeLinearity: 0.18,
      });
      this.emitUpdate({
        legIndex: this.legs.length - 1,
        progress: 1,
        stop: this.route[this.route.length - 1],
        label: "Путешествие завершено!",
        transport: null,
        playing: false,
        paused: false,
        done: true,
      });
    }
  };

  TourAnimatorInstance.prototype.pause = function () {
    if (!this.playing && !this.cancelled) return;
    const wasPlaying = this.playing;
    this.cancelled = true;
    this.playing = false;
    this.followZoom = null;
    this.map.stop(); // мягко останавливаем текущий пан/перелёт камеры
    this.setTouring(false);
    this.resumeProgress = this.legProgress < 1 ? this.legProgress : 0;
    if (wasPlaying) this.emitUpdate({ playing: false, paused: true });
  };

  return TourAnimatorInstance;
})();

function buildTourStopsList(container, route, legs) {
  container.innerHTML = route
    .map((stop, i) => {
      const leg = legs.find((l) => l.to === i);
      const transport = leg ? leg.transport : null;
      return `
        <li class="tour-stop tour-stop-pending" data-idx="${i}">
          <span class="tour-stop-progress" aria-hidden="true"></span>
          <span class="tour-stop-num">${i + 1}</span>
          <span class="tour-stop-text">
            <strong>${stop.name}</strong>
            <small>${stop.subtitle || ""}</small>
          </span>
          ${transport ? `<span class="tour-stop-transport">${TRANSPORT_ICON[transport] || "→"}</span>` : ""}
        </li>
      `;
    })
    .join("");
}

const tourStopsScroll = { lastIdx: -1, lastAt: 0 };

function scrollTourStopIntoView(container, el, idx) {
  if (!container || !el) return;
  const now = performance.now();
  if (idx === tourStopsScroll.lastIdx && now - tourStopsScroll.lastAt < 500) return;

  // Отметку времени ставим до измерений: иначе при малом смещении функция
  // выходила раньше записи и дёргала getBoundingClientRect на каждом кадре.
  tourStopsScroll.lastIdx = idx;
  tourStopsScroll.lastAt = now;

  const containerRect = container.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const offset = elRect.top - containerRect.top - containerRect.height / 2 + elRect.height / 2;

  if (Math.abs(offset) < 16) return;

  container.scrollTo({
    top: container.scrollTop + offset,
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
}

function updateTourStops(container, legs, activeIdx, legProgress, legIndex, playing) {
  if (!container) return;

  const items = container.querySelectorAll(".tour-stop");
  let scrollTarget = null;
  let scrollIdx = activeIdx;

  items.forEach((el, i) => {
    const isTarget = i === activeIdx;
    const isDone = i < activeIdx || (isTarget && legProgress >= 1);
    const isActive = isTarget && legIndex >= 0 && legProgress < 1;

    el.classList.toggle("tour-stop-active", isActive);
    el.classList.toggle("tour-stop-done", isDone && !isActive);
    el.classList.toggle("tour-stop-pending", !isDone && !isActive);

    // Пишем переменную только когда значение реально изменилось:
    // запись во все 14 элементов подряд заставляла браузер пересчитывать стили.
    const next = isActive ? (Math.round(legProgress * 100) / 100).toFixed(2) : isDone ? "1" : "0";
    if (el.dataset.p !== next) {
      el.dataset.p = next;
      el.style.setProperty("--leg-progress", next);
    }

    if (isActive) {
      scrollTarget = el;
      scrollIdx = i;
    } else if (isTarget && legProgress >= 0.98) {
      scrollTarget = el;
      scrollIdx = i;
    }
  });

  if (scrollTarget && playing) scrollTourStopIntoView(container, scrollTarget, scrollIdx);
}

function renderTourStops(container, route, legs, activeIdx, legProgress, legIndex, playing) {
  buildTourStopsList(container, route, legs);
  tourStopsScroll.lastIdx = -1;
  updateTourStops(container, legs, activeIdx, legProgress, legIndex ?? -1, !!playing);
}

function initTourAnimation(map) {
  if (!TRIP.tourRoute || !TRIP.tourLegs) return null;

  const animator = new TourAnimator(map, TRIP.tourRoute, TRIP.tourLegs);
  const legLabel = document.getElementById("tour-leg-label");
  const legTransport = document.getElementById("tour-leg-transport");
  const progressBar = document.getElementById("tour-progress-bar");
  const progressText = document.getElementById("tour-progress-text");
  const stopsList = document.getElementById("tour-stops");
  const btnPlay = document.getElementById("tour-play");
  const btnReset = document.getElementById("tour-reset");

  let stopsBuilt = false;

  function ensureStopsList() {
    if (!stopsBuilt) {
      buildTourStopsList(stopsList, TRIP.tourRoute, TRIP.tourLegs);
      stopsBuilt = true;
    }
  }

  function syncStops(state) {
    ensureStopsList();
    const nextStop = state.done
      ? TRIP.tourRoute.length - 1
      : state.legIndex >= 0 && TRIP.tourLegs[state.legIndex]
        ? TRIP.tourLegs[state.legIndex].to
        : 0;
    updateTourStops(
      stopsList,
      TRIP.tourLegs,
      nextStop,
      state.progress || 0,
      typeof state.legIndex === "number" ? state.legIndex : -1,
      !!state.playing,
    );
  }

  function overallProgress(legIdx, legProgress) {
    const total = TRIP.tourLegs.length;
    if (!Number.isFinite(legIdx) || legIdx < 0 || !total) return 0;
    const p = Number.isFinite(legProgress) ? legProgress : 0;
    return Math.max(0, Math.min(1, (legIdx + p) / total));
  }

  function syncPlayButton(playing) {
    if (!btnPlay) return;
    btnPlay.textContent = playing ? "⏸" : "▶";
    btnPlay.setAttribute("aria-label", playing ? "Пауза" : "Запустить путешествие по маршруту");
    btnPlay.setAttribute("aria-pressed", playing ? "true" : "false");
  }

  animator.setUpdateHandler((state) => {
    if (legLabel && state.label) legLabel.textContent = state.label;
    if (legTransport) {
      legTransport.textContent = state.transport
        ? (TRANSPORT_ICON[state.transport] || "") +
          " " +
          (TRANSPORT_LABEL[state.transport] || state.transport)
        : "";
    }
    if (progressBar) {
      progressBar.style.setProperty("--tour-progress", String(overallProgress(state.legIndex, state.progress)));
    }
    if (progressText) {
      progressText.textContent = state.done
        ? "Готово"
        : Number.isFinite(state.legIndex) && state.legIndex >= 0
          ? `Этап ${state.legIndex + 1} из ${TRIP.tourLegs.length}`
          : "Нажмите ▶";
    }
    syncStops(state);
    syncPlayButton(state.playing);
  });

  btnPlay?.addEventListener("click", () => {
    if (animator.playing) {
      animator.pause();
    } else {
      animator.cancelled = false;
      animator.play();
    }
  });

  btnReset?.addEventListener("click", () => {
    animator.pause();
    animator.reset();
    stopsBuilt = false;
    tourStopsScroll.lastIdx = -1;
    renderTourStops(stopsList, TRIP.tourRoute, TRIP.tourLegs, 0, 0, -1, false);
    syncPlayButton(false);
  });

  renderTourStops(stopsList, TRIP.tourRoute, TRIP.tourLegs, 0, 0, -1, false);
  animator.reset();
  syncPlayButton(false);
  return animator;
}
