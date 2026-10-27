import { getFunctions, httpsCallable } from "firebase/functions";
import { auth } from "../../firebase.js";

const callable = httpsCallable(
  getFunctions(auth.app, "us-central1"),
  "knowledgeApi",
  { timeout: 120000 }
);

// This controls ONLY Knowledge Test requests.
// It does not change the Firebase login or other website features.
let inspectionEmail = "";
let inspectionRevision = 0;

function cleanEmail(value) {
  return String(value || "").toLowerCase().trim();
}

export function setKnowledgeInspectionEmail(value = "") {
  const next = cleanEmail(value);

  if (next === inspectionEmail) return;

  inspectionEmail = next;
  inspectionRevision += 1;
}

export async function knowledgeApi(action, payload = {}) {
  const account = auth.currentUser;

  if (!account) {
    throw new Error(
      "Please sign in again with the account that owns this exercise."
    );
  }

  // Freeze the requested view for this particular request.
  const requestedInspectionEmail = inspectionEmail;
  const requestedInspectionRevision = inspectionRevision;

  const expectedUid = payload.expectedUid || account.uid;

  const checkRequestIdentity = () => {
    if (auth.currentUser?.uid !== expectedUid) {
      throw new Error(
        "The signed-in account changed. Reload the page before continuing."
      );
    }

    if (
      inspectionRevision !== requestedInspectionRevision ||
      inspectionEmail !== requestedInspectionEmail
    ) {
      throw new Error(
        "The inspected account changed. The previous account's response was not displayed."
      );
    }
  };

  if (account.uid !== expectedUid) {
    throw new Error(
      "The signed-in account changed. Please return to the correct account before continuing."
    );
  }

  await account.getIdToken();

  checkRequestIdentity();

  const result = await callable({
    ...payload,
    action,
    expectedUid,

    // Explicitly overwrite any payload value.
    // The server independently checks whether the REAL login
    // is allowed to request this account.
    effectiveEmail:
      requestedInspectionEmail || cleanEmail(account.email)
  });

  checkRequestIdentity();

  return result.data;
}

export const TOPICS = [
  { id: "japan", label: "Japan", theme: "A" },
  { id: "china", label: "China", theme: "A" },
  { id: "hong-kong", label: "Hong Kong", theme: "A" },
  { id: "ww1", label: "World War I", theme: "B" },
  { id: "ww2", label: "World War II", theme: "B" },
  { id: "cold-war", label: "Cold War", theme: "B" },
{ id: "cooperation", label: "International Cooperation", theme: "B" },
  {
    id: "question-type",
    label: "Question type recognition",
    theme: "SKILLS"
  }
];

export function topicName(id) {
  return TOPICS.find(t => t.id === id)?.label || id;
}

export function accuracy(correct, total) {
  return total ? `${Math.round(correct / total * 100)}%` : "—";
}

export function hkTime(value, language = "en") {
  if (!value) return "—";

  return new Date(value).toLocaleString(
    language === "zh" ? "zh-HK" : "en-GB",
    {
      timeZone: "Asia/Hong_Kong",
      dateStyle: "medium",
      timeStyle: "short"
    }
  );
}

function safeCount(value) {
  const number = Number(value);

  return Number.isFinite(number) && number >= 0
    ? Math.floor(number)
    : 0;
}

export function assignmentDone(a) {
  return safeCount(a.completed) + safeCount(a.late);
}

export function assignmentClosed(a) {
  return Boolean(
    a.cancelled ||
    a.ended ||
    a.closed ||
    assignmentDone(a) >= Number(a.target || 1)
  );
}

export function assignmentStatus(a, language = "en") {
  const tr = (en, zh) => language === "zh" ? zh : en;

  if (a.cancelled) return tr("Cancelled", "已取消");

  if (assignmentDone(a) >= Number(a.target || 1)) {
    return safeCount(a.late) > 0
      ? tr("Completed with late work", "已完成（包括遲交）")
      : tr("Completed", "已完成");
  }

  if (a.ended || a.closed) {
    return tr("Ended by teacher", "老師已結束功課");
  }

  if (Date.now() < a.startsAt) return tr("Upcoming", "尚未開始");
  if (Date.now() > a.dueAt) return tr("Overdue", "逾期未完成");

  return tr("In progress", "進行中");
}