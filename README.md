# Happy Mama Tour

Мобильный гид для поездки **с мамой в Петербург** (3–10 августа 2026).  
Стиль — как [sam-scenes](https://github.com/SamBruev/sam-scenes): тёмный фон, золото, liquid glass, плавные анимации.

## Что внутри

| Вкладка | Содержание |
|---------|------------|
| **План** | 8 дней по шагам: время, транспорт (поезд, каршеринг, метро…), адреса, суммы |
| **Отель** | Адрес, бронь, телефон, карта |
| **Карта** | Все ключевые точки на тёмной карте |
| **Бюджет** | Отель, билеты, музеи, еда, траты по дням |
| **Смотреть** | Чеклист мест и что взять в дорогу |

## Заполнить свои данные

Отредактируйте **`data.js`**:

- `hotel` — название, адрес, цена, номер брони
- `tickets` — номера поездов, время, стоимость
- `budgetFixed` — фиксированные траты
- `days` — расписание (уже есть черновик с 3 августа, приезд в 23:00, каршеринг)

Поля с `←` — замените на реальные значения.

## Локально

```bash
cd "Happy Mama Tour"
python3 -m http.server 8080
```

http://localhost:8080

## GitHub Pages

```bash
git add .
git commit -m "Happy Mama Tour — гид для поездки с мамой"
git remote add origin https://github.com/SamBruev/Happy-Mama-Tour.git
git push -u origin main
```

**Settings → Pages → Source → GitHub Actions**

Live: https://sambruev.github.io/Happy-Mama-Tour/
