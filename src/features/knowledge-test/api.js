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

export function hkTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Asia/Hong_Kong",
    dateStyle: "medium",
    timeStyle: "short"
  });
}

export function assignmentStatus(a) {
  if (a.cancelled) return "Cancelled";
  if (a.completed >= a.target) return "Completed";
  if (Date.now() < a.startsAt) return "Upcoming";
  if (Date.now() > a.dueAt) return "Overdue";
  return "In progress";
}