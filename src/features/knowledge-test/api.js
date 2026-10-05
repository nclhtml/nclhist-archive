import { getFunctions, httpsCallable } from "firebase/functions";
import { auth } from "../../firebase.js";

const callable = httpsCallable(
  getFunctions(auth.app, "us-central1"),
  "knowledgeApi",
  { timeout: 120000 }
);

export async function knowledgeApi(action, payload = {}) {
  const result = await callable({ ...payload, action });
  return result.data;
}

export const TOPICS = [
  { id: "japan", label: "Japan", theme: "A" },
  { id: "china", label: "China", theme: "A" },
  { id: "hong-kong", label: "Hong Kong", theme: "A" },
  { id: "ww1", label: "World War I", theme: "B" },
  { id: "ww2", label: "World War II", theme: "B" },
  { id: "cold-war", label: "Cold War", theme: "B" },
  { id: "cooperation", label: "International Cooperation", theme: "B" }
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