import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";

import { db } from "./firebase";

export const normalizeGroup = (value) =>
  String(value ?? "").trim().toLowerCase();

export async function loadStudentClass(email) {
  const normalizedEmail = normalizeGroup(email);

  if (!normalizedEmail) return "";

  const snapshot = await getDocs(
    query(
      collection(db, "students"),
      where("email", "==", normalizedEmail),
      limit(1)
    )
  );

  if (snapshot.empty) return "";

  return String(snapshot.docs[0].data().className || "");
}

// This controls the interface.
// The backend and Firestore rules must enforce the same policy independently.
export function canOpenExercise(exercise, user, studentClass = "") {
  if (!user?.email) return false;
  if (user.isAdmin) return true;
  if (!user.isAuthorized) return false;

  const groups = new Set(
    (Array.isArray(exercise.assignedGroups)
      ? exercise.assignedGroups
      : []
    )
      .map(normalizeGroup)
      .filter(Boolean)
  );

  const role = normalizeGroup(user.role);
  const className = normalizeGroup(studentClass);

  return (
    groups.has("all") ||
    (Boolean(role) && groups.has(role)) ||
    (Boolean(className) && groups.has(className))
  );
}