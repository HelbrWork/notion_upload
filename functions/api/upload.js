const BUILD_VERSION = "v3_nospace_nodots_date";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const MAX_SMALL_FILE_BYTES = 20 * 1024 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-App-Version": BUILD_VERSION,
    },
  });
}

function formatDateForName(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${dd}${mm}${yyyy}`;
}

function formatDateForNotion(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function sanitizePrefix(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .toUpperCase();
}

function getExtension(fileName) {
  const match = fileName.match(/(\.[^.]+)$/);
  return match ? match[1] : "";
}

function buildBaseName(prefix, index, totalFiles, dateStr) {
  const safePrefix = sanitizePrefix(prefix);

  if (safePrefix) {
    if (totalFiles > 1) {
      return `${safePrefix}_${index}_${dateStr}`;
    }
    return `${safePrefix}_${dateStr}`;
  }

  if (totalFiles > 1) {
    return `${index}_${dateStr}`;
  }

  return dateStr;
}

async function notionFetch(env, path, init = {}, isJson = true) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${env.NOTION_TOKEN}`);
  headers.set("Notion-Version", NOTION_VERSION);

  if (isJson && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${NOTION_API_BASE}${path}`, {
    ...init,
    headers,
  });

  const text = await res.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${path} -> ${res.status} returned non-JSON: ${text}`);
    }
  }

  if (!res.ok) {
    throw new Error(`${path} -> ${res.status} ${JSON.stringify(data)}`);
  }

  return data;
}

async function createFileUpload(env, uploadFileName, contentType) {
  return notionFetch(env, "/file_uploads", {
    method: "POST",
    body: JSON.stringify({
      mode: "single_part",
      filename: uploadFileName,
      content_type: contentType || "application/octet-stream",
    }),
  });
}

async function sendFileUpload(env, fileUploadId, file, uploadFileName) {
  const form = new FormData();
  form.append("file", file, uploadFileName);

  return notionFetch(
    env,
    `/file_uploads/${fileUploadId}/send`,
    {
      method: "POST",
      body: form,
    },
    false
  );
}

async function createTicketPage(env, title, uploadFileName, fileUploadId, notionDate) {
  return notionFetch(env, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: {
        type: "data_source_id",
        data_source_id: env.TARGET_DATA_SOURCE_ID,
      },
      properties: {
        [env.TITLE_PROP]: {
          title: [
            {
              text: {
                content: title,
              },
            },
          ],
        },
        [env.FILES_PROP]: {
          files: [
            {
              type: "file_upload",
              name: uploadFileName,
              file_upload: {
                id: fileUploadId,
              },
            },
          ],
        },
        [env.DATE_PROP]: {
          date: {
            start: notionDate,
          },
        },
      },
    }),
  });
}

function extractTicketId(page, uniqueIdPropName) {
  const unique = page?.properties?.[uniqueIdPropName]?.unique_id;
  if (!unique || unique.number == null) return null;
  return unique.prefix ? `${unique.prefix}-${unique.number}` : String(unique.number);
}

export async function onRequestPost({ request, env }) {
  try {
    const form = await request.formData();
    const prefixRaw = String(form.get("titlePrefix") || "");
    const fileEntries = form.getAll("files");
    const files = fileEntries.filter((item) => item instanceof File);

    if (!files.length) {
      return json({ ok: false, build: BUILD_VERSION, error: "No files received" }, 400);
    }

    const now = new Date();
    const humanDate = formatDateForName(now);
    const notionDate = formatDateForNotion(now);

    const items = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (file.size > MAX_SMALL_FILE_BYTES) {
        throw new Error(`File ${file.name} is larger than 20 MB`);
      }

      const index = i + 1;
      const ext = getExtension(file.name);
      const title = buildBaseName(prefixRaw, index, files.length, humanDate);
      const uploadFileName = `${title}${ext}`;

      const upload = await createFileUpload(env, uploadFileName, file.type);
      await sendFileUpload(env, upload.id, file, uploadFileName);

      const page = await createTicketPage(
        env,
        title,
        uploadFileName,
        upload.id,
        notionDate
      );

      items.push({
        originalFileName: file.name,
        storedFileName: uploadFileName,
        title,
        ticketId: extractTicketId(page, env.UNIQUE_ID_PROP),
        pageId: page.id,
      });
    }

    return json({
      ok: true,
      build: BUILD_VERSION,
      created: items.length,
      items,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        build: BUILD_VERSION,
        error: error?.message || "Unknown error",
      },
      500
    );
  }
}
