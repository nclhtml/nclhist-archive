const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees
} = require("pdf-lib");

const SUPERADMIN = "clng@ktls.edu.hk";
const BUCKET_NAME = "nclhist.firebasestorage.app";
const MAX_BYTES = 30 * 1024 * 1024;
const MAX_PAGES = 200;
const SESSION_MS = 30 * 60 * 1000;

const firestore = admin.firestore();
const bucket = admin.storage().bucket(BUCKET_NAME);
const configRef = firestore.doc("skillbook_private/config");
const uploads = configRef.collection("uploads");
const sessions = configRef.collection("sessions");
const limits = configRef.collection("limits");

const ALLOWED_ORIGINS = new Set([
  "https://nclhist.netlify.app",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:4173"
]);

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function checkKindLanguage(kind, language) {
  if (!["dbq", "essay"].includes(kind)) {
    fail(400, "Invalid book type.");
  }

  if (!["en", "zh"].includes(language)) {
    fail(400, "Invalid language.");
  }
}

function checkId(value) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9-]{36}$/.test(value)
  ) {
    fail(400, "Invalid record ID.");
  }

  return value;
}

function parseRanges(value, count) {
  const text = String(value || "")
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/，/g, ",");

  if (!text) return [];

  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_PAGES
  ) {
    fail(400, "Upload the corresponding language PDF first.");
  }

  if (
    text.length > 1000 ||
    !/^[1-9]\d*(?:\s*-\s*[1-9]\d*)?(?:\s*,\s*[1-9]\d*(?:\s*-\s*[1-9]\d*)?)*$/.test(text)
  ) {
    fail(400, 'Use page ranges such as "13", "26-28", or "13, 16".');
  }

  const result = new Set();

  for (const part of text.split(",")) {
    const bounds = part.trim().split("-").map(Number);
    const start = bounds[0];
    const end = bounds.length === 2 ? bounds[1] : start;

    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < start ||
      end > count
    ) {
      fail(
        400,
        `Invalid range "${part.trim()}". This PDF has ${count} physical pages.`
      );
    }

    for (let page = start; page <= end; page++) {
      result.add(page);
    }
  }

  // Preserve the administrator's written order.
  return [...result];
}

const SHORT_DEFINITIONS = [
  ["attitude", "Attitude", "態度"],
  ["view", "View", "看法"],
  ["purpose", "Purpose/Main message", "目的/主要信息"],
  ["language", "Language and Argument", "用語及論據"],
  ["role", "Role", "角色"],
  ["features", "Characteristics/Features", "特徵"],
  ["efforts", "Efforts", "努力"],
  ["extent", "To what extent", "在甚麼程度"],
  ["usefulness", "Usefulness and Limitation", "用處與局限"],
  ["data", "Data description", "數據描述"],
  ["bias", "Fair and Bias", "公允與偏見"],
  ["change", "Turning point and change", "轉捩點及轉變"],
  ["caption", "Suggest a caption", "建議一個標題"],
  ["if", "If", "假設"],
  ["compare", "Compare sources", "比較看法"]
];

const LONG_DEFINITIONS = [
  ["discuss", "Plain discuss", "直述題", 1],
  ["importance", "Single-factor Relative Importance", "單項相對重要性", 3],
  ["two-sided", "Two-sided arguments", "兩面立論", 1],
  ["rather", "Rather Than", "而非", 2],
  ["stance", "Normal Stance", "立場題", 1],
  ["usefulness", "Usefulness and Limitation", "用處及局限", 1],
  ["change", "Change/Transformation", "轉變、蛻變", 1],
  ["progressive", "Progressive", "漸進題", 1],
  ["bias", "Fair and Bias", "公允與偏見", 1],
  ["dual", "Dual Question", "雙問題", 1],
  ["if", "If conditional", "假設", 1],
  ["compare", "Compare sources", "比較看法", 1]
];

function definitions() {
  return [
    ...SHORT_DEFINITIONS.map(([id, en, zh]) => ({
      id: `short-${id}`,
      titleEn: `Short: ${en}`,
      titleZh: `短答：${zh}`,
      headingEn: `Question word: ${en}`,
      headingZh: `DBQ 短答題型：${zh}`,
      length: 1
    })),
    ...LONG_DEFINITIONS.map(([id, en, zh, length]) => ({
      id: `long-${id}`,
      titleEn: `Long: ${en}`,
      titleZh: `長答：${zh}`,
      headingEn: `DBQ Long Question type: ${en}`,
      headingZh: `DBQ 長答題型：${zh}`,
      length
    }))
  ];
}

function emptyConfig() {
  return {
    revision: "0",
    books: {
      dbq: { en: null, zh: null },
      essay: { en: null, zh: null }
    },
    sections: {
      dbq: definitions().map(item => ({
        id: item.id,
        titleEn: item.titleEn,
        titleZh: item.titleZh,
        en: "",
        zh: "",
        tags: []
      })),
      essay: []
    }
  };
}

async function readConfig() {
  const snapshot = await configRef.get();
  return snapshot.exists ? snapshot.data() : emptyConfig();
}

async function authorize(req) {
  const authorization = req.get("Authorization") || "";
  const match = authorization.match(/^Bearer (.+)$/);

  if (!match) fail(401, "Please sign in again.");

  let token;

  try {
    token = await admin.auth().verifyIdToken(match[1], true);
  } catch {
    fail(401, "Your login has expired. Please sign in again.");
  }

  if (!token.email_verified || !token.email) {
    fail(403, "A verified email account is required.");
  }

  const realEmail = cleanEmail(token.email);
  const actingAs = cleanEmail(req.get("X-Skills-Act-As"));

  if (actingAs && realEmail !== SUPERADMIN) {
    fail(403, "Impersonation is not permitted.");
  }

  const email = actingAs || realEmail;
  let role = "admin";

  if (email !== SUPERADMIN) {
    const snapshot = await firestore.doc(`user_roles/${email}`).get();

    if (!snapshot.exists) {
      fail(403, "This account does not have website access.");
    }

    role = snapshot.data().role;

    if (typeof role !== "string" || !role.trim()) {
      fail(403, "This account has no valid role.");
    }
  }

  if (role === "dse_only") {
    fail(403, "Skills books are not available to the DSE-only group.");
  }

  return {
    uid: token.uid,
    email,
    realEmail,
    role,
    manager: realEmail === SUPERADMIN && !actingAs
  };
}

function requireManager(account) {
  if (!account.manager) {
    fail(403, "Only the superadmin outside Debug Mode may manage skills books.");
  }
}

async function rateLimit(account, action) {
  const minute = Math.floor(Date.now() / 60000);
  const reference = limits.doc(account.uid);

  await firestore.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    const previous = snapshot.data() || {};
    const sameMinute = previous.minute === minute;

    const total = (sameMinute ? previous.total || 0 : 0) + 1;
    const creates =
      (sameMinute ? previous.creates || 0 : 0) +
      (["open", "preview"].includes(action) ? 1 : 0);

    if (total > 150 || creates > 15) {
      fail(429, "Too many requests. Please wait one minute and try again.");
    }

    transaction.set(reference, { minute, total, creates });
  });
}

let pdfjsPromise;

async function loadPdfJs(bytes) {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }

  const pdfjs = await pdfjsPromise;
  const packageFolder = path.dirname(
    require.resolve("pdfjs-dist/package.json")
  );

  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    cMapPacked: true,
    cMapUrl: path.join(packageFolder, "cmaps") + path.sep,
    standardFontDataUrl:
      path.join(packageFolder, "standard_fonts") + path.sep
  });

  try {
    return await task.promise;
  } catch (error) {
    await task.destroy();
    throw error;
  }
}

function normalizeHeading(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]/g, "");
}

async function detectDbqRanges(bytes, language) {
  const pdf = await loadPdfJs(bytes);
  const items = definitions();
  const occurrences = new Map(items.map(item => [item.id, []]));

  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const textContent = await page.getTextContent();
      const text = normalizeHeading(
        textContent.items.map(item => item.str || "").join(" ")
      );

      const matches = items.filter(item =>
        text.includes(
          normalizeHeading(language === "zh"
            ? item.headingZh
            : item.headingEn)
        )
      );

      // A page matching many headings is probably the contents page.
      if (matches.length > 0 && matches.length <= 3) {
        for (const item of matches) {
          occurrences.get(item.id).push(number);
        }
      }

      page.cleanup();
    }

    const ranges = {};

    for (const item of items) {
      const found = occurrences.get(item.id);

      // Ambiguous or missing headings are deliberately left blank.
      if (found.length !== 1) continue;

      const start = found[0];
      const end = start + item.length - 1;

      if (end <= pdf.numPages) {
        ranges[item.id] = start === end
          ? String(start)
          : `${start}-${end}`;
      }
    }

    return ranges;
  } finally {
    await pdf.destroy();
  }
}

async function readAsset(assetId) {
  const snapshot = await uploads.doc(checkId(assetId)).get();
  const data = snapshot.data();

  if (!data?.asset) {
    fail(404, "This uploaded book has not completed processing.");
  }

  return data.asset;
}

async function privateBytes(storagePath) {
  if (!storagePath.startsWith("skillbooks_private/")) {
    fail(403, "Invalid private file.");
  }

  const file = bucket.file(storagePath);
  const [metadata] = await file.getMetadata();

  if (Number(metadata.size) > MAX_BYTES) {
    fail(400, "The PDF is larger than the supported limit.");
  }

  const [bytes] = await file.download();
  return bytes;
}

async function createSession(account, options) {
  const {
    asset,
    pages,
    title,
    entries = [],
    warnings = [],
    revision = null,
    temporary = false
  } = options;

  const id = randomUUID();
  const expiresAt = Date.now() + SESSION_MS;
  const storagePath = temporary
    ? `skillbooks_private/sessions/${id}.pdf`
    : asset.path;

  const reference = sessions.doc(id);

  // Record the temporary path before writing its file.
  // A failed/abandoned operation can therefore still be cleaned up.
  await reference.set({
    uid: account.uid,
    email: account.email,
    expiresAt,
    path: storagePath,
    temporary,
    revision,
    ready: false
  });

  if (temporary) {
    const source = await PDFDocument.load(await privateBytes(asset.path));
    const output = await PDFDocument.create();

    const copied = await output.copyPages(
      source,
      pages.map(number => number - 1)
    );

    copied.forEach(page => output.addPage(page));

    const bytes = await output.save();

    if (bytes.length > MAX_BYTES) {
      fail(400, "The assembled recall document is too large.");
    }

    await bucket.file(storagePath).save(Buffer.from(bytes), {
      resumable: false,
      metadata: {
        contentType: "application/pdf",
        cacheControl: "private, no-store"
      }
    });
  }

  await reference.update({
    ready: true,
    pageCount: pages.length,
    sourcePages: temporary ? [] : pages
  });

  return {
    id,
    title,
    pageCount: pages.length,
    expiresAt,
    entries,
    warnings
  };
}

async function loadSession(account, id) {
  const reference = sessions.doc(checkId(id));
  const snapshot = await reference.get();
  const session = snapshot.data();

  if (
    !session ||
    session.uid !== account.uid ||
    session.email !== account.email
  ) {
    fail(403, "This reading session is unavailable.");
  }

  if (!session.ready || session.expiresAt <= Date.now()) {
    fail(410, "This reading session expired. Close it and open the book again.");
  }

  if (session.revision !== null) {
    const current = await readConfig();

    if (current.revision !== session.revision) {
      fail(410, "The skillbook settings changed. Please reopen this reader.");
    }
  }

  return { reference, session };
}

async function renderSessionPage(account, id, requestedPage) {
  const { session } = await loadSession(account, id);
  const number = Number(requestedPage);

  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > session.pageCount
  ) {
    fail(400, "Invalid reader page.");
  }

  const sourceNumber = session.temporary
    ? number
    : session.sourcePages[number - 1];

  const source = await PDFDocument.load(
    await privateBytes(session.path)
  );

  const single = await PDFDocument.create();
  const [page] = await single.copyPages(source, [sourceNumber - 1]);
  single.addPage(page);

  // Bake the watermark into the server-rendered page.
  const font = await single.embedFont(StandardFonts.Helvetica);
  const { width, height } = page.getSize();

  const identity = account.email.replace(/[^\x20-\x7E]/g, "?");
  const text = `${identity} | ${new Date().toISOString().slice(0, 16)} UTC`;
  const size = Math.min(
    21,
    (width * 0.82) / Math.max(1, font.widthOfTextAtSize(text, 1))
  );

  for (const vertical of [0.3, 0.65]) {
    page.drawText(text, {
      x: width * 0.06,
      y: height * vertical,
      size,
      font,
      color: rgb(0.35, 0.35, 0.35),
      opacity: 0.23,
      rotate: degrees(24)
    });
  }

  const pdf = await loadPdfJs(await single.save());
  let canvasPair;

  try {
    const renderPage = await pdf.getPage(1);
    const base = renderPage.getViewport({ scale: 1 });
    const scale = Math.min(1600 / base.width, 2200 / base.height);
    const viewport = renderPage.getViewport({ scale });

    canvasPair = pdf.canvasFactory.create(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height)
    );

    await renderPage.render({
      canvasContext: canvasPair.context,
      viewport,
      background: "rgb(255,255,255)"
    }).promise;

    return canvasPair.canvas.toBuffer("image/jpeg");
  } finally {
    if (canvasPair) pdf.canvasFactory.destroy(canvasPair);
    await pdf.destroy();
  }
}

async function deleteSession(reference, data) {
  if (
    data.temporary &&
    typeof data.path === "string" &&
    data.path.startsWith("skillbooks_private/sessions/")
  ) {
    await bucket.file(data.path).delete({ ignoreNotFound: true });
  }

  await reference.delete();
}

async function processAction(account, body) {
  const { action } = body;

  if (action === "catalog") {
    const config = await readConfig();

    return {
      dbq: {
        en: Boolean(config.books.dbq.en),
        zh: Boolean(config.books.dbq.zh)
      },
      essay: {
        en: Boolean(config.books.essay.en),
        zh: Boolean(config.books.essay.zh)
      }
    };
  }

  if (action === "adminConfig") {
    requireManager(account);
    return readConfig();
  }

  if (action === "prepareUpload") {
    requireManager(account);
    checkKindLanguage(body.kind, body.language);

    const id = randomUUID();
    const storagePath = `skillbooks_uploads/${account.uid}/${id}.pdf`;

    await uploads.doc(id).set({
      uid: account.uid,
      kind: body.kind,
      language: body.language,
      name: String(body.name || "Skillbook.pdf").slice(0, 250),
      stagingPath: storagePath,
      createdAt: Date.now()
    });

    return { id, path: storagePath };
  }

  if (action === "finishUpload") {
    requireManager(account);

    const reference = uploads.doc(checkId(body.id));
    const snapshot = await reference.get();
    const upload = snapshot.data();

    if (!upload || upload.uid !== account.uid) {
      fail(403, "Upload record not found.");
    }

    // Allow a safe retry after a network interruption.
    if (upload.asset) {
      return {
        asset: upload.asset,
        ranges: upload.ranges || {}
      };
    }

    const stagingFile = bucket.file(upload.stagingPath);
    const [metadata] = await stagingFile.getMetadata();

    if (
      Number(metadata.size) < 1 ||
      Number(metadata.size) > MAX_BYTES ||
      metadata.contentType !== "application/pdf"
    ) {
      fail(400, "Upload a PDF no larger than 30 MB.");
    }

    const [bytes] = await stagingFile.download();
    const pdf = await PDFDocument.load(bytes);
    const count = pdf.getPageCount();

    if (count < 1 || count > MAX_PAGES) {
      fail(400, `Books must contain between 1 and ${MAX_PAGES} pages.`);
    }

    let ranges = {};

    if (upload.kind === "dbq") {
      try {
        ranges = await detectDbqRanges(bytes, upload.language);
      } catch (error) {
        console.warn("Skill heading detection was unavailable:", error.message);
        // The book remains usable with manually entered page ranges.
      }
    }

    const storagePath =
      `skillbooks_private/books/${upload.kind}/${upload.language}/${body.id}.pdf`;

    // Save new bytes rather than copying Firebase download-token metadata.
    await bucket.file(storagePath).save(bytes, {
      resumable: false,
      metadata: {
        contentType: "application/pdf",
        cacheControl: "private, no-store"
      }
    });

    const asset = {
      id: body.id,
      kind: upload.kind,
      language: upload.language,
      name: upload.name,
      pageCount: count,
      path: storagePath
    };

    await reference.update({ asset, ranges });

    // The browser-uploaded staging object is no longer needed.
    await stagingFile.delete({ ignoreNotFound: true });

    return { asset, ranges };
  }

  if (action === "saveConfig") {
    requireManager(account);

    if (body.reviewed !== true) {
      fail(400, "Review the language PDFs and page mappings before publishing.");
    }

    const draft = body.config;

    if (!draft || typeof draft !== "object") {
      fail(400, "Missing settings.");
    }

    const next = emptyConfig();

    for (const kind of ["dbq", "essay"]) {
      for (const language of ["en", "zh"]) {
        const submitted = draft.books?.[kind]?.[language];

        if (submitted) {
          const asset = await readAsset(submitted.id);

          if (
            asset.kind !== kind ||
            asset.language !== language
          ) {
            fail(400, "A book was assigned to the wrong language or paper.");
          }

          next.books[kind][language] = asset;
        }
      }

      const rows = draft.sections?.[kind];

      if (!Array.isArray(rows) || rows.length > 100) {
        fail(400, "Invalid skills section list.");
      }

      const seen = new Set();

      next.sections[kind] = rows.map(row => {
        if (
          !row ||
          typeof row.id !== "string" ||
          !/^[a-zA-Z0-9-]{1,80}$/.test(row.id) ||
          seen.has(row.id)
        ) {
          fail(400, "A skill section has an invalid or duplicate ID.");
        }

        seen.add(row.id);

        const titleEn = String(row.titleEn || "").trim();
        const titleZh = String(row.titleZh || "").trim();

        if (
          (!titleEn && !titleZh) ||
          titleEn.length > 180 ||
          titleZh.length > 180
        ) {
          fail(400, "Every skill section needs a title of at most 180 characters.");
        }

        if (
          !Array.isArray(row.tags) ||
          row.tags.length > 100 ||
          row.tags.some(tag =>
            typeof tag !== "string" ||
            !tag.trim() ||
            tag.length > 250
          )
        ) {
          fail(400, "Invalid question-label mapping.");
        }

        const output = {
          id: row.id,
          titleEn,
          titleZh,
          tags: [...new Set(row.tags)],
          en: String(row.en || "").trim(),
          zh: String(row.zh || "").trim()
        };

        for (const language of ["en", "zh"]) {
          if (output[language]) {
            parseRanges(
              output[language],
              next.books[kind][language]?.pageCount
            );
          }
        }

        return output;
      });
    }

    next.revision = randomUUID();
    next.updatedAt = new Date().toISOString();
    next.updatedBy = account.realEmail;

    await firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(configRef);
      const revision = snapshot.exists
        ? snapshot.data().revision
        : "0";

      if (draft.revision !== revision) {
        fail(
          409,
          "Another settings save occurred. Close this manager and reopen it before editing again."
        );
      }

      transaction.set(configRef, next);
    });

    return next;
  }

  if (action === "preview") {
    requireManager(account);

    const asset = await readAsset(body.assetId);
    const selected = body.pages
      ? parseRanges(body.pages, asset.pageCount)
      : Array.from({ length: asset.pageCount }, (_, index) => index + 1);

    return createSession(account, {
      asset,
      pages: selected,
      title: `Draft preview: ${asset.name}`,
      revision: null
    });
  }

  if (action === "open") {
    const config = await readConfig();
    const language = body.language;

    if (!["en", "zh"].includes(language)) {
      fail(400, "Invalid language.");
    }

    let kind = body.kind;
    let questions = [];

    if (body.mode === "recall") {
      if (
        typeof body.archiveId !== "string" ||
        !body.archiveId ||
        body.archiveId.includes("/") ||
        body.archiveId.length > 200
      ) {
        fail(400, "Invalid archive record.");
      }

      const archiveSnapshot = await firestore
        .doc(`archives/${body.archiveId}`)
        .get();

      if (!archiveSnapshot.exists) {
        fail(404, "The question record no longer exists.");
      }

      const archive = archiveSnapshot.data();

      kind = archive.paperType === "Paper 1 (DBQ)"
        ? "dbq"
        : archive.paperType === "Paper 2 (Essay)"
          ? "essay"
          : null;

      if (
        !Array.isArray(body.childIds) ||
        !body.childIds.length ||
        body.childIds.length > 100
      ) {
        fail(400, "No questions were selected for skill recall.");
      }

      const ids = new Set(body.childIds.map(String));
      const savedQuestions = Array.isArray(archive.subQuestions)
        ? archive.subQuestions
        : [];

      // Database order is authoritative. Never sort by page or label.
      questions = savedQuestions.filter(question =>
        ids.has(String(question.id))
      );

      if (questions.length !== ids.size) {
        fail(409, "The questions changed. Reopen the question preview.");
      }
    } else if (body.mode !== "book") {
      fail(400, "Invalid reader mode.");
    }

    checkKindLanguage(kind, language);

    const asset = config.books[kind][language];

    if (!asset) {
      fail(
        404,
        language === "zh"
          ? "這本技巧筆記的中文版尚未上載。"
          : "The English version of this skillbook has not been uploaded yet."
      );
    }

    if (body.mode === "book") {
      return createSession(account, {
        asset,
        pages: Array.from(
          { length: asset.pageCount },
          (_, index) => index + 1
        ),
        title: language === "zh"
          ? kind === "dbq" ? "DBQ 答題技巧" : "論述題答題技巧"
          : kind === "dbq" ? "DBQ Skills Book" : "Essay Skills Book",
        revision: config.revision
      });
    }

    const pages = [];
    const positions = new Map();
    const entries = [];
    const warnings = [];

    for (const question of questions) {
      const tags = Array.isArray(question.questionType)
        ? question.questionType
        : typeof question.questionType === "string"
          ? [question.questionType]
          : [];

      const questionLabel = `Q${question.label}`;

      if (!tags.length) {
        warnings.push(`${questionLabel}: no question-type labels.`);
      }

      for (const tag of tags) {
        const matches = config.sections[kind].filter(section =>
          section.tags.includes(tag)
        );

        if (!matches.length) {
          warnings.push(`${questionLabel}: "${tag}" is not linked.`);
          continue;
        }

        for (const section of matches) {
          const selected = parseRanges(
            section[language],
            asset.pageCount
          );

          if (!selected.length) {
            warnings.push(
              `${questionLabel}: "${tag}" has no ${language.toUpperCase()} pages.`
            );
            continue;
          }

          for (const page of selected) {
            if (!positions.has(page)) {
              pages.push(page);
              positions.set(page, pages.length);
            }
          }

          entries.push({
            question: questionLabel,
            title: language === "zh"
              ? section.titleZh || section.titleEn
              : section.titleEn || section.titleZh,
            page: positions.get(selected[0])
          });
        }
      }
    }

    if (!pages.length) {
      fail(
        404,
        language === "zh"
          ? "此題尚未連結可用的技巧頁面。"
          : "No skills pages have been linked to these questions yet."
      );
    }

    return createSession(account, {
      asset,
      pages,
      entries,
      warnings: [...new Set(warnings)],
      temporary: true,
      revision: config.revision,
      title: language === "zh" ? "技巧重溫" : "Skill Recall"
    });
  }

  if (action === "close") {
    const reference = sessions.doc(checkId(body.id));
    const snapshot = await reference.get();

    if (
      snapshot.exists &&
      snapshot.data().uid === account.uid &&
      snapshot.data().email === account.email
    ) {
      await deleteSession(reference, snapshot.data());
    }

    return { ok: true };
  }

  fail(400, "Unknown skills action.");
}

exports.skillsApi = functions
  .runWith({
    memory: "2GB",
    timeoutSeconds: 300,
    maxInstances: 4
  })
  .https.onRequest(async (req, res) => {
    const origin = req.get("Origin");

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return res.status(403).json({ error: "This website origin is not permitted." });
    }

    if (origin) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
    }

    res.set("Cache-Control", "private, no-store, max-age=0");
    res.set("X-Content-Type-Options", "nosniff");

    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.set(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Skills-Act-As"
      );
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Use POST." });
    }

    try {
      if (
        !req.body ||
        typeof req.body !== "object" ||
        Array.isArray(req.body) ||
        (req.rawBody && req.rawBody.length > 500000)
      ) {
        fail(400, "Invalid request.");
      }

      const account = await authorize(req);
      await rateLimit(account, req.body.action);

      if (req.body.action === "page") {
        const image = await renderSessionPage(
          account,
          req.body.id,
          req.body.page
        );

        res.set("Content-Type", "image/jpeg");
        return res.status(200).send(image);
      }

      return res.status(200).json(
        await processAction(account, req.body)
      );
    } catch (error) {
      console.error("Skills request failed:", error);

      return res.status(error.status || 500).json({
        error: error.status
          ? error.message
          : "The skills request failed. Please retry or ask the administrator to check the function logs."
      });
    }
  });

exports.cleanupSkillSessions = functions
  .runWith({ timeoutSeconds: 300 })
  .pubsub.schedule("every 30 minutes")
  .onRun(async () => {
    const expired = await sessions
      .where("expiresAt", "<=", Date.now())
      .limit(300)
      .get();

    for (const snapshot of expired.docs) {
      await deleteSession(snapshot.ref, snapshot.data());
    }

    // Remove abandoned browser-uploaded staging files after one day.
    const abandoned = await uploads
      .where("createdAt", "<=", Date.now() - 24 * 60 * 60 * 1000)
      .get();

    for (const snapshot of abandoned.docs) {
      const upload = snapshot.data();

      if (!upload.stagingCleaned && upload.stagingPath) {
        await bucket.file(upload.stagingPath).delete({
          ignoreNotFound: true
        });

        await snapshot.ref.update({ stagingCleaned: true });
      }
    }

    return null;
  });