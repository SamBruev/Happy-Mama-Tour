/** Анимация движения по маршруту на карте Leaflet */
const TRANSPORT_ICON = {
  train: "🚆",
  carshare: "🚗",
  bus: "⛴",
  walk: "🚶",
  metro: "🚇",
  car: "🚗",
};

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

function buildVehicleMarkerHtml(transport, bearing) {
  const kind = getVehicleKind(transport);
  const rot = typeof bearing === "number" ? bearing : 0;
  const icon = TRANSPORT_ICON[transport] || "📍";

  if (kind === "train") {
    return `
      <div class="tour-vehicle-shell" style="--bearing:${rot}deg">
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
      <div class="tour-vehicle-shell" style="--bearing:${rot}deg">
        <div class="tour-vehicle tour-vehicle--car">
          <span class="tour-car-dust"></span>
          <span class="tour-vehicle-icon" aria-hidden="true">🚗</span>
        </div>
      </div>`;
  }

  if (kind === "ferry") {
    return `
      <div class="tour-vehicle-shell" style="--bearing:${rot}deg">
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
      <div class="tour-vehicle-shell" style="--bearing:${rot}deg">
        <div class="tour-vehicle tour-vehicle--metro">
          <span class="tour-vehicle-icon" aria-hidden="true">🚇</span>
        </div>
      </div>`;
  }

  if (kind === "walk") {
    return `
      <div class="tour-vehicle-shell" style="--bearing:${rot}deg">
        <div class="tour-vehicle tour-vehicle--walk">
          <span class="tour-vehicle-icon" aria-hidden="true">🚶</span>
        </div>
      </div>`;
  }

  return `
    <div class="tour-vehicle-shell" style="--bearing:${rot}deg">
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
    this.marker = null;
    this.plannedLine = null;
    this.traveledLine = null;
    this.traveledPoints = [];
    this.onUpdate = null;
    this.currentTransport = null;

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

    this.marker = L.marker(coords[0], { icon, zIndexOffset: 1000 }).addTo(map);

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

    map.fitBounds(this.plannedLine.getBounds(), { padding: [36, 36], maxZoom: 7 });
  }

  TourAnimatorInstance.prototype.setUpdateHandler = function (fn) {
    this.onUpdate = fn;
  };

  TourAnimatorInstance.prototype.setVehicle = function (transport, from, to) {
    const bearing = from && to ? getBearing(from.lat, from.lon, to.lat, to.lon) : 0;
    this.currentTransport = transport;
    this.marker.setIcon(createVehicleIcon(transport, bearing));
  };

  TourAnimatorInstance.prototype.emitUpdate = function (payload) {
    if (this.onUpdate) this.onUpdate(payload);
  };

  TourAnimatorInstance.prototype.reset = function () {
    this.cancelled = true;
    this.playing = false;
    this.legIndex = 0;
    this.traveledPoints = [[this.route[0].lat, this.route[0].lon]];
    this.traveledLine.setLatLngs(this.traveledPoints);
    this.marker.setLatLng(this.traveledPoints[0]);
    this.setVehicle(null, null, null);
    this.map.fitBounds(this.plannedLine.getBounds(), { padding: [36, 36], maxZoom: 7 });
    this.emitUpdate({
      legIndex: -1,
      progress: 0,
      stop: this.route[0],
      label: "Готовы к путешествию",
      transport: null,
      playing: false,
    });
  };

  TourAnimatorInstance.prototype.animateLeg = function (leg, legIdx) {
    const from = this.route[leg.from];
    const to = this.route[leg.to];
    const duration = leg.durationMs || 3000;
    const start = performance.now();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let lastPanAt = 0;

    this.setVehicle(leg.transport, from, to);

    this.emitUpdate({
      legIndex: legIdx,
      progress: 0,
      stop: to,
      label: leg.label,
      transport: leg.transport,
      playing: true,
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
        this.marker.setLatLng([lat, lon]);

        const trail = [...this.traveledPoints];
        if (trail.length === 0 || trail[trail.length - 1][0] !== lat || trail[trail.length - 1][1] !== lon) {
          trail.push([lat, lon]);
          this.traveledLine.setLatLngs(trail);
        }

        frame += 1;
        if (reduceMotion) {
          if (raw >= 1) this.map.setView([lat, lon], this.map.getZoom(), { animate: false });
        } else if (frame % 3 === 0 && now - lastPanAt > 180) {
          this.map.panTo([lat, lon], { animate: true, duration: 0.35, easeLinearity: 0.25 });
          lastPanAt = now;
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
          this.traveledLine.setLatLngs(this.traveledPoints);
          this.marker.setLatLng([to.lat, to.lon]);
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
      this.traveledPoints = [[this.route[0].lat, this.route[0].lon]];
      this.traveledLine.setLatLngs(this.traveledPoints);
    }

    for (let i = this.legIndex; i < this.legs.length; i++) {
      if (this.cancelled) break;
      this.legIndex = i;
      await this.animateLeg(this.legs[i], i);
      if (this.cancelled) break;
      await new Promise((r) => setTimeout(r, 420));
    }

    this.playing = false;
    if (!this.cancelled && this.legIndex >= this.legs.length - 1) {
      this.emitUpdate({
        legIndex: this.legs.length - 1,
        progress: 1,
        stop: this.route[this.route.length - 1],
        label: "Путешествие завершено!",
        transport: null,
        playing: false,
        done: true,
      });
    }
  };

  TourAnimatorInstance.prototype.pause = function () {
    this.cancelled = true;
    this.playing = false;
    this.emitUpdate({ playing: false, paused: true });
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
  if (idx === tourStopsScroll.lastIdx && now - tourStopsScroll.lastAt < 280) return;

  const containerRect = container.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const offset = elRect.top - containerRect.top - containerRect.height / 2 + elRect.height / 2;

  if (Math.abs(offset) < 12) return;

  tourStopsScroll.lastIdx = idx;
  tourStopsScroll.lastAt = now;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  container.scrollTo({
    top: container.scrollTop + offset,
    behavior: reduceMotion ? "auto" : "smooth",
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

    if (isActive && playing) scrollTarget = el;
    else if (isTarget && legProgress >= 0.98) scrollTarget = el;
    if (scrollTarget) scrollIdx = i;
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
    const nextStop =
      state.done
        ? TRIP.tourRoute.length - 1
        : state.legIndex >= 0
          ? TRIP.tourLegs[state.legIndex].to
          : 0;
    updateTourStops(
      stopsList,
      TRIP.tourLegs,
      nextStop,
      state.progress || 0,
      state.legIndex,
      state.playing,
    );
  }

  function overallProgress(legIdx, legProgress) {
    const total = TRIP.tourLegs.length;
    if (legIdx < 0) return 0;
    return Math.min(100, ((legIdx + legProgress) / total) * 100);
  }

  animator.setUpdateHandler((state) => {
    if (state.label && legLabel) legLabel.textContent = state.label;
    if (legTransport) {
      legTransport.textContent = state.transport
        ? (TRANSPORT_ICON[state.transport] || "") + " " + (TRANSPORT_LABEL[state.transport] || state.transport)
        : "";
    }
    if (progressBar) progressBar.style.width = overallProgress(state.legIndex, state.progress || 0) + "%";
    if (progressText) {
      progressText.textContent =
        state.done
          ? "Готово"
          : state.legIndex >= 0
            ? `Этап ${state.legIndex + 1} из ${TRIP.tourLegs.length}`
            : "Нажмите ▶";
    }
    syncStops(state);
    if (btnPlay) btnPlay.textContent = state.playing ? "⏸" : "▶";
  });

  btnPlay?.addEventListener("click", () => {
    if (animator.playing) animator.pause();
    else {
      animator.cancelled = false;
      animator.play();
    }
  });

  btnReset?.addEventListener("click", () => {
    animator.pause();
    animator.legIndex = 0;
    animator.reset();
    stopsBuilt = false;
    tourStopsScroll.lastIdx = -1;
    renderTourStops(stopsList, TRIP.tourRoute, TRIP.tourLegs, 0, 0, -1, false);
  });

  renderTourStops(stopsList, TRIP.tourRoute, TRIP.tourLegs, 0, 0, -1, false);
  animator.reset();
  return animator;
}
