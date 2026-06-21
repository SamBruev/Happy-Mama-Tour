/** Анимация движения по маршруту на карте Leaflet */
const TRANSPORT_ICON = {
  train: "🚆",
  carshare: "🚗",
  bus: "⛴",
  walk: "🚶",
  metro: "🚇",
  car: "🚗",
};

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

    const icon = L.divIcon({
      className: "tour-marker-wrap",
      html: '<div class="tour-marker"><span class="tour-marker-pulse"></span></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

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

        this.map.panTo([lat, lon], { animate: true, duration: 0.35, easeLinearity: 0.25 });

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

function renderTourStops(container, route, legs, activeIdx, legProgress) {
  container.innerHTML = route
    .map((stop, i) => {
      const isActive = i === activeIdx;
      const isDone = i < activeIdx || (isActive && legProgress >= 1);
      const leg = legs.find((l) => l.to === i);
      const transport = leg ? leg.transport : null;
      return `
        <li class="tour-stop${isActive && legProgress < 1 ? " tour-stop-active" : ""}${isDone ? " tour-stop-done" : ""}" data-idx="${i}">
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

  container.querySelector(".tour-stop-active")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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

  let currentLeg = -1;
  let activeStopIdx = 0;

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
    const nextStop =
      state.done
        ? TRIP.tourRoute.length - 1
        : state.legIndex >= 0
          ? TRIP.tourLegs[state.legIndex].to
          : 0;
    if (state.legIndex !== currentLeg || nextStop !== activeStopIdx || state.done) {
      currentLeg = state.legIndex;
      activeStopIdx = nextStop;
      renderTourStops(stopsList, TRIP.tourRoute, TRIP.tourLegs, nextStop, state.progress || 0);
    }
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
    renderTourStops(stopsList, TRIP.tourRoute, TRIP.tourLegs, 0, 0);
  });

  animator.reset();
  renderTourStops(stopsList, TRIP.tourRoute, TRIP.tourLegs, 0, 0);
  return animator;
}
