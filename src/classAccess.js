import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  query,
  where
} from 'firebase/firestore';

import { db } from './firebase.js';

// Read the current saved role and the superadmin-assigned classes.
// Student profile membership alone does not grant class access.
export async function getUserClassAccess(rawEmail) {
  const email = String(rawEmail || '').toLowerCase().trim();

  if (!email) {
    return { role: null, classes: [] };
  }

  const roleSnap = await getDocFromServer(
    doc(db, 'user_roles', email)
  );

  if (!roleSnap.exists()) {
    return { role: null, classes: [] };
  }

  const role = roleSnap.data().role || null;

  const mappingSnap = await getDocFromServer(
    doc(db, 'user_students', email)
  );

  if (!mappingSnap.exists()) {
    return { role, classes: [] };
  }

  const mapping = mappingSnap.data();

  // Ignore outdated mappings after a role change.
  if (
    mapping.role !== role ||
    !Array.isArray(mapping.assignedClasses)
  ) {
    return { role, classes: [] };
  }

  const classes = [...new Set(
    mapping.assignedClasses.filter(
      name => typeof name === 'string' && name.length > 0
    )
  )];

  // Do not remove invisible characters from stored class identifiers.
  // Different teaching groups may have the same visible class name.
  if (
    mapping.classAccessMode === 'ownClass' &&
    classes.length !== 1
  ) {
    return { role, classes: [] };
  }

  return { role, classes };
}

// Support both assessment formats used by the existing website:
//   classes: ['4A', '4B']
//   className: '4A'
//
// Each query asks for just one permitted class.
// An assessment returned by both queries is included only once.
export async function getClassAssessments(classNames) {
  const classes = [...new Set(
    (classNames || []).filter(
      name => typeof name === 'string' && name.length > 0
    )
  )];

  const results = new Map();

  for (const className of classes) {
    const [multiClassSnap, singleClassSnap] = await Promise.all([
      getDocsFromServer(
        query(
          collection(db, 'assessments'),
          where('classes', 'array-contains', className)
        )
      ),
      getDocsFromServer(
        query(
          collection(db, 'assessments'),
          where('className', '==', className)
        )
      )
    ]);

    for (const snapshot of [multiClassSnap, singleClassSnap]) {
      snapshot.docs.forEach(d => {
        results.set(d.id, { ...d.data(), id: d.id });
      });
    }
  }

  return [...results.values()];
}