# Notion ticket upload portal

Готовый MVP под Cloudflare Pages + Pages Functions v3.

Что делает:
- принимает несколько изображений через drag & drop;
- на каждый файл создаёт отдельную запись в Notion;
- пишет в твою таблицу `database_id`;
- `Ticket ID` Notion проставляет сам.

## Таблица Notion

Ожидаемые колонки в целевой таблице:
- `Title` — type `title`
- `Files & media` — type `files`
- `Date` — type `date`
- `Ticket ID` — type `unique_id`

## Перед стартом

1. Перевыпусти токен Notion.
2. Подключи интеграцию к нужной таблице через **Add connections**.
3. Скопируй `.dev.vars.example` в `.dev.vars` и заполни значения.

```bash
cp .dev.vars.example .dev.vars
```

## Локальный запуск

```bash
npm install
npm run dev
```

После этого открой локальный адрес, который покажет Wrangler.

## Деплой

### Вариант 1: через Git + Cloudflare Pages

1. Залей проект в GitHub.
2. Создай новый Cloudflare Pages project.
3. Подключи репозиторий.
4. Поставь output directory: `public`.
5. В Variables / Secrets добавь:
   - `NOTION_TOKEN`
   - `TARGET_DATA_SOURCE_ID`
   - `TITLE_PROP`
   - `FILES_PROP`
   - `DATE_PROP`
   - `UNIQUE_ID_PROP`

### Вариант 2: через Wrangler

```bash
npx wrangler login
npx wrangler pages deploy public --project-name your-project-name
```

Потом добавь те же secrets в Cloudflare Pages project settings.

## Как работают названия

- если поле `Префикс названия` пустое, запись будет называться по имени файла;
- если префикс указан и файлов несколько, названия будут такие:
  - `Casino#1`
  - `Casino#2`
  - `Casino#3`

## Ограничения текущего MVP

- только изображения;
- до 20 MB на файл;
- без авторизации на самой странице.

Если захочешь, следующим шагом можно добавить:
- пароль на страницу;
- поле `buyer` / `manager`;
- комментарий к тикету;
- статус;
- логотип и нормальный UI под команду.
