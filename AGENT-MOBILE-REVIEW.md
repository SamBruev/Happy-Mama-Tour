# Промпт для агента · мобильная оптимизация Happy Mama Tour

Скопируй **весь блок внутри тройных кавычек** в новый чат Cursor (Agent mode).  
Агент работает как **frontend-разработчик под мобильные** (iOS Safari + Android Chrome), а не как абстрактный «ревьюер UX».

Файл: `Happy Mama Tour/AGENT-MOBILE-REVIEW.md`

---

## Промпт (копировать отсюда)

```
Ты — senior frontend-разработчик, специализация: мобильные веб-приложения (PWA-lite) для iOS Safari и Android Chrome. Проведи аудит проекта «Happy Mama Tour» и исправь проблемы, которые мешают сайту работать **шустро и ясно** на телефоне в поездке (в т.ч. слабый LTE, старый iPhone, Samsung среднего сегмента).

## Контекст продукта

- **Что это:** мобильный гид по поездке (статический сайт, GitHub Pages), без бэкенда.
- **Аудитория:** Сам + мама **75 лет** — крупный текст, понятные кнопки, минимум жестов «наугад», без лагов и «прыгающей» вёрстки.
- **Сценарии использования:** в поезде, в отеле, на улице; переключение вкладок, раскрытие дней, карта Leaflet с анимацией тура, чеклисты, ссылки «Карта» / «Билеты».
- **Стек:** HTML + CSS + vanilla JS, `data.js`, Leaflet (CDN), Google Fonts (CDN), фон `media/karelia-bg.jpg`, `manifest.json` (PWA без service worker).

## Файлы — прочитать обязательно

1. `index.html` — meta, viewport, порядок скриптов
2. `styles.css` — glass, safe-area, bottom-nav, карта, tour UI, media queries
3. `app.js` — рендер, навигация, карта, scroll
4. `tour.js` — анимация (requestAnimationFrame, panTo)
5. `manifest.json` — PWA
6. `media/karelia-bg.jpg` — размер/вес фона

## Целевые устройства (проверять мысленно и по коду)

| Платформа | Минимум | Особенности |
|-----------|---------|-------------|
| **iOS** | Safari 15+, iPhone SE / 12 | safe-area, `100dvh`, `-webkit-backdrop-filter`, fixed background, bounce scroll, PWA «На экран Домой» |
| **Android** | Chrome 100+ | address bar resize, tap highlight, шрифты, Leaflet tiles |

## Чеклист аудита

### 1. Производительность (шустро)
- **First load:** вес страницы, блокирующие ресурсы (Google Fonts, Leaflet CSS/JS с unpkg).
- **Фон:** `karelia-bg.jpg` — сжатие, `webp`/`avif`, lazy не нужен для fixed bg, но размер критичен на LTE.
- **Шрифты:** subset, `font-display: swap`, можно ли системный stack / self-host / меньше начертаний?
- **Leaflet:** загрузка только при открытии вкладки «Тур»? `invalidateSize` при смене вкладки.
- **Анимация тура:** не дёргает ли `panTo` + `requestAnimationFrame` на слабом телефоне; throttle/debounce scroll handlers в `app.js`.
- **Repaints:** `backdrop-filter: blur` на многих карточках — тяжело на iOS; где упростить?
- **CDN:** fallback если unpkg/fonts недоступны в поезде?

### 2. iOS Safari
- `viewport-fit=cover` + `env(safe-area-inset-*)` — nav не перекрывает home indicator?
- `maximum-scale=1, user-scalable=no` — доступность vs «не зумится случайно» для мамы 75 лет (обоснуй).
- `apple-mobile-web-app-*` meta — полный набор? иконки (`apple-touch-icon`) — есть ли?
- Fixed `body::before` с background — известные баги iOS (обрезание, jump при scroll).
- `-webkit-overflow-scrolling`, momentum scroll в `.tour-stops`.
- Кнопки: min 44×44 pt touch target?
- `:active` / `:focus-visible` состояния.

### 3. Android Chrome
- Bottom nav не уезжает при появлении/скрытии URL bar (`100dvh` vs `100vh`).
- Tap delay, `-webkit-tap-highlight-color`.
- Glass cards без `backdrop-filter` fallback — читаемость на MIUI/Samsung Internet.

### 4. Ясность UI (для мамы и в дороге)
- Размер шрифта body, контраст текста на glass + фото фона (WCAG AA где возможно).
- Иерархия: время / заголовок шага / транспорт — читается ли на солнце?
- Bottom nav: подписи «План / Отель / Тур…» — не мелкие ли? активная вкладка очевидна?
- Кнопки «Карта», «Билеты», tour ▶/↺ — понятны без объяснения?
- `details/summary` дней — удобно ли открывать пальцем?
- Ошибки: что если Leaflet не загрузился — есть ли сообщение пользователю?

### 5. PWA и офлайн
- `manifest.json`: icons 192/512 — **отсутствуют**? добавить.
- Service worker — нет; нужен ли minimal cache для `index.html`, `data.js`, css, js, фон (для поезда без сети)?
- `theme_color`, `display: standalone` — поведение при «Добавить на экран».

### 6. Доступность
- `aria-label` на nav и tour-кнопках — достаточно?
- `prefers-reduced-motion` — анимации тура и scroll отключаются?
- `prefers-reduced-transparency` — уже есть в CSS; достаточно ли?
- Focus order при tab (если кто-то с клавиатурой).

### 7. Карта и вкладка «Тур»
- Высота `#map` / `.tour-map` на маленьком экране (iPhone SE).
- Список остановок `.tour-stops` — scroll не конфликтует с body?
- Переключение вкладки → map → не сбрасывается ли тур без необходимости?
- Tile layer CARTO — грузится ли из РФ; альтернатива?

## Что сделать по итогам

1. **Отчёт** (см. формат ниже).
2. **Исправления в коде** — минимальный diff, без переписывания всего проекта.
3. **Приоритет:** сначала то, что ломает UX на телефоне, потом nice-to-have.
4. **Не ломать:** данные в `data.js` (контент поездки), логику маршрута в `tour.js` без необходимости.

Проверяй изменения локально (`python3 -m http.server`) и опиши, что тестировал.

## Формат ответа

1. **Вердикт** (готов к поездке / нужны правки / критично тормозит или нечитаемо)
2. **Метрики оценочно** (размер critical path, тяжёлые ресурсы, top-3 узких места)
3. **🔴 Критично** (iOS / Android / обе)
4. **🟡 Важно**
5. **🟢 Полировка**
6. **Таблица по вкладкам:** План | Отель | Тур | Бюджет | Смотреть — проблема | fix
7. **Список PR-изменений:** файл → что сделать (конкретно)
8. **После правок:** что проверить руками на iPhone и Android (чеклист 5–7 пунктов)

Пиши **по-русски**, как разработчик коллеге. Потом **внеси правки** в репозиторий и кратко опиши diff.

## Ограничения

- Без React/Vue/сборщика — остаёмся на vanilla, если нет веской причины.
- Без тяжёлых npm-зависимостей.
- Бюджет трафика: по возможности < 500 KB на первый экран без карты.
- Коммит не делать, пока Сам явно не попросит.
```

---

## Как использовать

1. Открой папку `Happy Mama Tour` в Cursor.
2. **Agent** → новый чат → вставь промпт.
3. Агент сначала отчёт, потом правки в `index.html`, `styles.css`, `app.js`, `tour.js`, `manifest.json`.
4. Проверь на своём iPhone/Android: все 5 вкладок + анимация тура + ссылка «Карта».

## Известные слабые места (подсказка агенту)

| Область | Сейчас |
|---------|--------|
| PWA icons | в `manifest.json` нет `icons[]` |
| Service worker | нет |
| Шрифты | Google Fonts, 6 начертаний, render-blocking |
| Leaflet | грузится всегда, даже на вкладке «План» |
| Фон | JPEG ~244 KB, fixed + blur glass |
| Масштаб | `user-scalable=no` — спорно для 75 лет |
| Apple touch icon | не подключён в `index.html` |

## Связанные файлы

- Аудит маршрута (тур-менеджер): `AGENT-TOUR-REVIEW.md`
- Деплой: GitHub Pages → https://sambruev.github.io/Happy-Mama-Tour/
