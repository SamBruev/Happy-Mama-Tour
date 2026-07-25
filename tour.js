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

function getBearing(fromLat, fromLon, toLat, toLon) {
  const φ1 = (fromLat * Math.PI) / 180;
  const φ2 = (toLat * Math.PI) / 180;
  const Δλ = ((toLon - fromLon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Эмодзи смотрят вправо; не даём им оказаться вверх ногами на западных курсах. */
function getVehicleDisplayAngle(bearing) {
  let angle = bearing - 90;
  while (angle <= -180) angle += 360;
  while (angle > 180) angle -= 360;
  if (angle > 90) return { deg: angle - 180, flip: true };
  if (angle < -90) return { deg: angle + 180, flip: true };
  return { deg: angle, flip: false };
}

function vehicleShellStyle(bearing) {
  const b = typeof bearing === "number" ? bearing : 0;
  const { deg, flip } = getVehicleDisplayAngle(b);
  return `--bearing:${deg}deg;--flip:${flip ? -1 : 1}`;
}

function buildVehicleMarkerHtml(transport, bearing) {
  const kind = getVehicleKind(transport);
  const style = vehicleShellStyle(bearing);
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
          <span class="tour-car-dust"></span>
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

function createVehicleIcon(transport, bearing) {
  const size = 56;
  return L.divIcon({
    className: "tour-marker-wrap",
    html: buildVehicleMarkerHtml(transport, bearing),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const TourAnimator = (function () {
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
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
    const bearing = from && to ? getBearing(from.lat, from.lon, to.lat, to.lon) : 0;
    this.currentTransport = transport;
    this.marker.setIcon(createVehicleIcon(transport, bearing));
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

  /** Камера один раз охватывает этап — вместо дёрганого panTo на каждом кадре. */
  TourAnimatorInstance.prototype.frameLeg = function (from, to) {
    const bounds = L.latLngBounds([
      [from.lat, from.lon],
      [to.lat, to.lon],
    ]).pad(0.4);
    const opts = { padding: [34, 34], maxZoom: 10 };
    if (prefersReducedMotion()) {
      this.map.fitBounds(bounds, Object.assign({ animate: false }, opts));
    } else {
      this.map.flyToBounds(bounds, Object.assign({ duration: 0.8 }, opts));
    }
  };

  TourAnimatorInstance.prototype.animateLeg = function (leg, legIdx, startProgress) {
    const from = this.route[leg.from];
    const to = this.route[leg.to];
    const duration = leg.durationMs || 3000;
    const offset = Math.min(0.98, Math.max(0, startProgress || 0));
    const start = performance.now() - offset * duration;
    const reduceMotion = prefersReducedMotion();
    let lastPanAt = 0;

    this.setVehicle(leg.transport, from, to);
    this.frameLeg(from, to);

    this.livePoints = this.traveledPoints.slice();
    this.livePoints.push([from.lat, from.lon]);

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

    return new Promise((resolve) => {
      const tick = (now) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const raw = Math.min(1, (now - start) / duration);
        const t = easeInOut(raw);
        const lat = lerp(from.lat, to.lat, t);
        const lon = lerp(from.lon, to.lon, t);

        this.legProgress = raw;
        this.marker.setLatLng([lat, lon]);

        const head = this.livePoints[this.livePoints.length - 1];
        head[0] = lat;
        head[1] = lon;
        this.traveledLine.setLatLngs(this.livePoints);

        // Догоняем машинку, только если она подошла к краю карты.
        if (!reduceMotion && now - start > 900 && now - lastPanAt > 700) {
          const size = this.map.getSize();
          const pt = this.map.latLngToContainerPoint([lat, lon]);
          const mx = size.x * 0.22;
          const my = size.y * 0.22;
          if (pt.x < mx || pt.x > size.x - mx || pt.y < my || pt.y > size.y - my) {
            this.map.panTo([lat, lon], { animate: true, duration: 0.7 });
            lastPanAt = now;
          }
        }

        this.emitUpdate({
          legIndex: legIdx,
          progress: raw,
          stop: to,
          label: leg.label,
          transport: leg.transport,
          playing: true,
        });

        if (raw < 1) {
          requestAnimationFrame(tick);
        } else {
          this.traveledPoints.push([to.lat, to.lon]);
          this.livePoints = null;
          this.traveledLine.setLatLngs(this.traveledPoints);
          this.marker.setLatLng([to.lat, to.lon]);
          this.legProgress = 1;
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  };

  TourAnimatorInstance.prototype.play = async function () {
    if (this.playing) return;
    this.playing = true;
    this.cancelled = false;

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
      await new Promise((r) => setTimeout(r, 420));
    }

    this.playing = false;

    if (!this.cancelled && this.legIndex >= this.legs.length - 1) {
      this.legIndex = this.legs.length;
      this.map.flyToBounds(this.overviewBounds, {
        padding: [36, 36],
        maxZoom: 7,
        duration: prefersReducedMotion() ? 0 : 1.1,
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
  if (idx === tourStopsScroll.lastIdx && now - tourStopsScroll.lastAt < 400) return;

  const containerRect = container.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const offset = elRect.top - containerRect.top - containerRect.height / 2 + elRect.height / 2;

  if (Math.abs(offset) < 16) return;

  tourStopsScroll.lastIdx = idx;
  tourStopsScroll.lastAt = now;

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
    el.style.setProperty("--leg-progress", isActive ? String(legProgress) : isDone ? "1" : "0");

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
