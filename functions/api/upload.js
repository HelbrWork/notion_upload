const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const MAX_SMALL_FILE_BYTES = 20 * 1024 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function stripExt(name) {
  return name.replace(/\.[^.]+$/, "");
}

function getExt(name) {
  const match = name.match(/(\.[^.]+)$/);
  return match ? match[1] : "";
}

function sanitizeFilePart(value) {
  return value
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDisplayDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  return `${day}.${month}.${year}`;
}

function buildBaseName(prefix, originalFileName, index, total, dateLabel) {
  const normalizedPrefix = sanitizeFilePart(prefix).toLocaleUpperCase();
  const fallbackBase = sanitizeFilePart(stripExt(originalFileName)) || "FILE";
  const basePrefix = normalizedPrefix || fallbackBase;

  if (total === 1) {
    return `${basePrefix} ${dateLabel}`;
  }

  return `${basePrefix} ${index + 1} ${dateLabel}`;
}

function renameFile(file, targetName) {
  return new File([file], targetName, {
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified,
  });
}

async function notionFetch(env, path, init = {}, isJson = true) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${env.NOTION_TOKEN}`);
  headers.set("Notion-Version", NOTION_VERSION);

  if (isJson && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

async function createFileUpload(env, file) {
  return notionFetch(env, "/file_uploads", {
    method: "POST",
    body: JSON.stringify({
      mode: "single_part",
      filename: file.name,
      content_type: file.type || "application/octet-stream",
    }),
  });
}

async function sendFileUpload(env, fileUploadId, file) {
  const form = new FormData();
  form.append("file", file, file.name);

  return notionFetch(
    env,
    `/file_uploads/${fileUploadId}/send`,
    {
      method: "POST",
      body: form,
    },
    false,
  );
}

async function createTicketPage(env, title, fileUploadId, fileName, dateValue) {
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
              name: fileName,
              file_upload: {
                id: fileUploadId,
              },
            },
          ],
        },
        [env.DATE_PROP]: {
          date: {
            start: dateValue,
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

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!env.NOTION_TOKEN || !env.TARGET_DATA_SOURCE_ID) {
      return json({ error: "Missing required Cloudflare secrets/env vars" }, 500);
    }

    const form = await request.formData();
    const prefix = String(form.get("titlePrefix") || "").trim();
    const fileEntries = form.getAll("files");
    const files = fileEntries.filter((entry) => entry instanceof File);

    if (!files.length) {
      return json({ error: "No files received" }, 400);
    }

    const allowedMimePrefixes = ["image/"];
    const now = new Date();
    const notionDate = now.toISOString().slice(0, 10);
    const displayDate = formatDisplayDate(now);
    const items = [];

    for (let i = 0; i < files.length; i += 1) {
      const originalFile = files[i];

      if (!allowedMimePrefixes.some((prefixValue) => originalFile.type.startsWith(prefixValue))) {
        throw new Error(`Unsupported file type: ${originalFile.name}`);
      }

      if (originalFile.size > MAX_SMALL_FILE_BYTES) {
        throw new Error(`File ${originalFile.name} is larger than 20 MB`);
      }

      const title = buildBaseName(prefix, originalFile.name, i, files.length, displayDate);
      const renamedFileName = `${title}${getExt(originalFile.name)}`;
      const renamedFile = renameFile(originalFile, renamedFileName);

      const upload = await createFileUpload(env, renamedFile);
      await sendFileUpload(env, upload.id, renamedFile);

      const page = await createTicketPage(
        env,
        title,
        upload.id,
        renamedFile.name,
        notionDate,
      );

      items.push({
        originalFileName: originalFile.name,
        fileName: renamedFile.name,
        title,
        pageId: page.id,
        ticketId: extractTicketId(page, env.UNIQUE_ID_PROP),
      });
    }

    return json({
      ok: true,
      created: items.length,
      items,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error?.message || "Unknown error",
      },
      500,
    );
  }
}
