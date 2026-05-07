const BUILD_VERSION = "v5_image_video_debug_nospaces_date";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const MAX_SMALL_FILE_BYTES = 60 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".svg",
  ".mp4",
  ".mov",
  ".webm",
  ".m4v",
  ".avi",
  ".mkv",
]);

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
  const match = String(fileName || "").match(/(\.[^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function isAllowedMediaType(file) {
  const type = String(file?.type || "").toLowerCase();
  const ext = getExtension(file?.name || "");

  if (type.startsWith("image/") || type.startsWith("video/")) {
    return true;
  }

  return ALLOWED_EXTENSIONS.has(ext);
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

async function notionFetch(env, path, init = {}, expectJson = true) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${env.NOTION_TOKEN}`);
  headers.set("Notion-Version", NOTION_VERSION);

  if (expectJson && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    ...init,
    headers,
  });

  const raw = await response.text();
  let data = {};

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      if (!response.ok) {
        throw new Error(`${path} -> ${response.status} non-JSON response: ${raw}`);
      }
      data = { raw };
    }
  }

  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${JSON.stringify(data)}`);
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
  let stage = "start";

  try {
    stage = "read_form";
    const form = await request.formData();

    const prefixRaw = String(form.get("titlePrefix") || "");
    const fileEntries = form.getAll("files");
    const files = fileEntries.filter((item) => item instanceof File);

    if (!files.length) {
      return json(
        {
          ok: false,
          build: BUILD_VERSION,
          stage: "validate",
          error: "No files received",
        },
        400
      );
    }

    const now = new Date();
    const humanDate = formatDateForName(now);
    const notionDate = formatDateForNotion(now);

    const items = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const index = i + 1;

      console.log("UPLOAD_FILE", {
        name: file.name,
        type: file.type,
        size: file.size,
      });

      stage = "validate";

      if (!isAllowedMediaType(file)) {
        throw new Error(`Unsupported file type: ${file.name} (${file.type || "unknown"})`);
      }

      if (file.size > MAX_SMALL_FILE_BYTES) {
        throw new Error(
          `File ${file.name} is larger than 20 MB. Current version supports files up to 20 MB.`
        );
      }

      const ext = getExtension(file.name);
      const title = buildBaseName(prefixRaw, index, files.length, humanDate);
      const uploadFileName = `${title}${ext}`;

      stage = "create_upload";
      const upload = await createFileUpload(env, uploadFileName, file.type);

      stage = "send_upload";
      await sendFileUpload(env, upload.id, file, uploadFileName);

      stage = "create_page";
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
      stage: "done",
      created: items.length,
      items,
    });
  } catch (error) {
    console.error("UPLOAD_ERROR", {
      build: BUILD_VERSION,
      stage,
      message: error?.message,
      stack: error?.stack,
    });

    return json(
      {
        ok: false,
        build: BUILD_VERSION,
        stage,
        error: error?.message || "Unknown error",
      },
      500
    );
  }
}
