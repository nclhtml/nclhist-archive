import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  runTransaction
} from 'firebase/firestore';

import { db } from './firebase.js';

// Shared revision document used by the updated upload/delete handlers.
// If permission is denied, stop rather than bypassing duplicate protection.
const guardRef = doc(db, 'system_settings', 'archive_write_guard');

export function normalizeArchiveName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[–—]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, '');
}

// Recover the exact exam family, not a loose title prefix.
export function getArchiveBatchTitle(archive) {
  if (String(archive.batchTitle || '').trim()) {
    return String(archive.batchTitle).trim();
  }

  const title = String(archive.title || '').trim();

  if (archive.paperType === 'Paper 1 (DBQ)') {
    const match = title.match(/^(.*?)D\s+Q\s*(\d+)$/i);
    return match ? match[1].trim() : '';
  }

  if (archive.paperType === 'Paper 2 (Essay)') {
    const match = title.match(/^(.*?)E$/i);
    return match ? match[1].trim() : '';
  }

  return '';
}

export function getArchiveQuestionNumber(archive) {
  const match = String(archive.title || '')
    .match(/D\s+Q\s*(\d+)$/i);

  return match ? String(Number(match[1])) : '';
}

// Stable comparison also works when object property order differs.
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);

  if (value && typeof value === 'object') {
    if (typeof value.toJSON === 'function') {
      return stableValue(value.toJSON());
    }

    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, stableValue(value[key])])
    );
  }

  return value;
}

function fingerprint(value) {
  return JSON.stringify(stableValue(value));
}

function withoutId(value) {
  const { id, ...data } = value;
  return data;
}

export function buildBatchWriteEntries(form, originals) {
  const originalMap = new Map(originals.map(item => [item.id, item]));
  const baseTitle = String(form.title || '').trim();

  // Editing an existing exam must not silently rename its records.
  if (originals.length) {
    const first = originals[0];
    const originalBase = getArchiveBatchTitle(first) || first.title;

    if (
      normalizeArchiveName(baseTitle) !==
        normalizeArchiveName(originalBase) ||
      form.origin !== first.origin ||
      String(form.year) !== String(first.year)
    ) {
      throw new Error(
        'When editing an existing exam, keep its exam title, origin and year unchanged. ' +
        'This prevents existing question links from being silently reassigned.'
      );
    }
  }

  // Allocate new DBQ numbers above the existing/explicit numbers.
  // Removing Q2 must NOT rename Q3 to Q2.
  let highestNumber = 0;

  form.questions.forEach(question => {
    const original = originalMap.get(question.id);
    const number = original
      ? getArchiveQuestionNumber(original)
      : String(question.questionNumber || '');

    if (/^[1-9]\d*$/.test(number)) {
      highestNumber = Math.max(highestNumber, Number(number));
    }
  });

  return form.questions.map(question => {
    const original = originalMap.get(question.id);

    if (typeof question.id === 'string' && !original) {
      throw new Error(
        'This draft contains a saved document from outside the exam being edited. ' +
        'Remove it from this draft and edit its original exam separately.'
      );
    }

    if (!['Paper 1 (DBQ)', 'Paper 2 (Essay)'].includes(question.paperType)) {
      throw new Error('Select a supported paper type for every question set.');
    }

    if (original && question.paperType !== original.paperType) {
      throw new Error(
        `Keep the existing paper type for "${original.title}".`
      );
    }

    let title;
    let questionNumber = '';

    if (original) {
      title = original.title;
      questionNumber = getArchiveQuestionNumber(original);
    } else if (question.paperType === 'Paper 1 (DBQ)') {
      questionNumber = String(question.questionNumber || '');

      if (!questionNumber) {
        highestNumber += 1;
        questionNumber = String(highestNumber);
      }

      if (!/^[1-9]\d*$/.test(questionNumber)) {
        throw new Error('DBQ question numbers must be positive whole numbers.');
      }

      title = `${baseTitle}D Q${questionNumber}`;
    } else {
      title = `${baseTitle}E`;
    }

    const subQuestions = (question.subQuestions || []).map(subQuestion => ({
      ...subQuestion,
      marks: question.paperType === 'Paper 2 (Essay)'
        ? ''
        : (subQuestion.marks ?? '')
    }));

    if (!subQuestions.length) {
      throw new Error(
        `"${title}" has no sub-questions. Remove its whole question card instead.`
      );
    }

    const labels = subQuestions.map(subQuestion =>
      normalizeArchiveName(subQuestion.label)
    );

    const ids = subQuestions.map(subQuestion => String(subQuestion.id));

    if (
      labels.some(label => !label) ||
      new Set(labels).size !== labels.length ||
      new Set(ids).size !== ids.length
    ) {
      throw new Error(
        `"${title}" contains blank/duplicate sub-question labels or duplicate IDs. ` +
        'Remove the duplicated sub-question before saving.'
      );
    }

    return {
      id: original ? original.id : null,
      data: {
        title,
        batchTitle: baseTitle,
        questionNumber,
        origin: form.origin,
        year: form.year,
        paperType: question.paperType,
        topic: question.topic || [],
        tier: form.tier,
        rating: question.rating ?? original?.rating ?? 0,
        subQuestions
      }
    };
  });
}

// Run BEFORE uploading any PDF bytes.
export async function prepareArchiveWrite({
  originals = [],
  entries = [],
  newExamTitle = ''
}) {
  if (originals.length + entries.length > 150) {
    throw new Error(
      'This editor supports at most 150 combined original/new question records per save. ' +
      'Nothing was changed.'
    );
  }

  // Read the revision BEFORE checking existing archive records.
  const guardSnapshot = await getDocFromServer(guardRef);
  const version = guardSnapshot.data()?.version || '';

  const archiveSnapshot = await getDocsFromServer(
    collection(db, 'archives')
  );

  const current = archiveSnapshot.docs.map(snapshot => ({
    ...snapshot.data(),
    id: snapshot.id
  }));

  const currentMap = new Map(current.map(item => [item.id, item]));
  const originalIds = new Set(originals.map(item => item.id));

  for (const original of originals) {
    const saved = currentMap.get(original.id);

    if (
      !saved ||
      fingerprint(withoutId(saved)) !==
        fingerprint(withoutId(original))
    ) {
      throw new Error(
        `"${original.title}" changed after this editor was opened. ` +
        'Close the editor and reopen Edit Parent before saving.'
      );
    }
  }

  if (newExamTitle) {
    const examKey = normalizeArchiveName(newExamTitle);

    const existingExam = current.find(item =>
      normalizeArchiveName(
        getArchiveBatchTitle(item) || item.title
      ) === examKey
    );

    if (existingExam) {
      throw new Error(
        `The exam "${newExamTitle}" already exists.\n\n` +
        `Existing record: ${existingExam.title}\n` +
        `ID: ${existingExam.id}\n\n` +
        'Use Edit Parent on that exam to add Chinese files, answers or corrections. ' +
        'Do not upload the full exam again.'
      );
    }
  }

  const names = new Set();
  const retainedIds = new Set();

  const plannedEntries = entries.map(entry => {
    const titleKey = normalizeArchiveName(entry.data.title);

    if (!titleKey) throw new Error('A document title is missing.');

    if (names.has(titleKey)) {
      throw new Error(
        `Duplicate question title in this draft: "${entry.data.title}".\n\n` +
        'Keep only one card for each DBQ number and one grouped Essay card.'
      );
    }

    names.add(titleKey);

    if (entry.id) {
      if (!originalIds.has(entry.id) || retainedIds.has(entry.id)) {
        throw new Error('A saved document ID is invalid or repeated in this draft.');
      }

      retainedIds.add(entry.id);
    }

    const conflictingDocument = current.find(item =>
      !originalIds.has(item.id) &&
      normalizeArchiveName(item.title) === titleKey
    );

    if (conflictingDocument) {
      throw new Error(
        `"${entry.data.title}" already exists outside this editing session.\n\n` +
        `Existing ID: ${conflictingDocument.id}\n` +
        'Close this draft and edit the existing record instead.'
      );
    }

    return {
      ...entry,
      id: entry.id || doc(collection(db, 'archives')).id
    };
  });

  const removed = originals.filter(item => !retainedIds.has(item.id));
  const removedIds = new Set(removed.map(item => item.id));

  // Protect references to deleted whole documents and removed sub-questions.
  const removedChildLinks = new Set();

  for (const entry of plannedEntries) {
    const original = currentMap.get(entry.id);
    if (!original) continue;

    const keptChildIds = new Set(
      (entry.data.subQuestions || []).map(child => String(child.id))
    );

    (original.subQuestions || []).forEach(child => {
      if (!keptChildIds.has(String(child.id))) {
        removedChildLinks.add(`${original.id}_${child.id}`);
      }
    });
  }

  if (removed.length || removedChildLinks.size) {
    const assessmentSnapshot = await getDocsFromServer(
      collection(db, 'assessments')
    );

    const isRemovedLink = link =>
      typeof link === 'string' &&
      (
        removedIds.has(link) ||
        removedChildLinks.has(link) ||
        [...removedIds].some(id => link.startsWith(`${id}_`))
      );

    const linkedAssessments = assessmentSnapshot.docs.filter(snapshot => {
      const assessment = snapshot.data();

      return (
        isRemovedLink(assessment.linkedDocId) ||
        (assessment.sectionsConfig || []).some(section =>
          isRemovedLink(section.linkedDocId)
        )
      );
    });

    if (linkedAssessments.length) {
      throw new Error(
        'Removal stopped because these assessments still link to a document ' +
        'or sub-question you are removing:\n\n' +
        linkedAssessments.map(snapshot =>
          `${snapshot.data().name || 'Assessment'} [${snapshot.id}]`
        ).join('\n') +
        '\n\nKeep the linked copy, or relink those assessments to the copy you intend to keep first.'
      );
    }
  }

  return {
    version,
    token: doc(collection(db, 'archives')).id,
    entries: plannedEntries,
    originals,
    removed,
    currentMap
  };
}

// All archive creates, updates and removals are committed together.
// No Storage uploads or UI changes take place inside the transaction.
export async function commitArchiveWrite(plan, payloads, email) {
  if (payloads.length !== plan.entries.length) {
    throw new Error('The prepared document count changed. Nothing was saved.');
  }

  const originalIds = new Set(plan.originals.map(item => item.id));

  const affectedIds = [
    ...new Set([
      ...originalIds,
      ...plan.entries.map(entry => entry.id)
    ])
  ];

  await runTransaction(db, async transaction => {
    const guardSnapshot = await transaction.get(guardRef);

    if ((guardSnapshot.data()?.version || '') !== plan.version) {
      throw new Error(
        'Another archive save finished while this operation was preparing. ' +
        'Close and reopen the editor, then try again. No archive changes from this operation were applied.'
      );
    }

    // Read all affected documents before writing anything.
    const snapshots = [];

    for (const id of affectedIds) {
      snapshots.push(
        await transaction.get(doc(db, 'archives', id))
      );
    }

for (const snapshot of snapshots) {
      const expected = plan.currentMap.get(snapshot.id);

      if (originalIds.has(snapshot.id)) {
        const documentLabel =
          expected?.title || snapshot.id;

        if (!expected) {
          throw new Error(
            'The original comparison record is missing.\n\n' +
            `Document: ${documentLabel}\n` +
            `Database ID: ${snapshot.id}\n\n` +
            'Close the editor, refresh the page, and reopen Edit Parent.'
          );
        }

        if (!snapshot.exists()) {
          throw new Error(
            'This document was deleted after saving started.\n\n' +
            `Document: ${documentLabel}\n` +
            `Database ID: ${snapshot.id}\n\n` +
            'Close the editor, refresh the page, and reopen Edit Parent.'
          );
        }

        // Compare the same representation on BOTH sides.
        //
        // "id" is used by the UI to identify the Firestore document.
        // Some legacy records also contain an "id" data field.
        // Do not mistake that legacy field for a content change.
        //
        // The actual Firestore document ID remains checked separately
        // through snapshot.id and originalIds.
        const actualData = withoutId(snapshot.data());
        const expectedData = withoutId(expected);

        if (
          fingerprint(actualData) !==
          fingerprint(expectedData)
        ) {
          const fieldNames = [
            ...new Set([
              ...Object.keys(expectedData),
              ...Object.keys(actualData)
            ])
          ];

          const changedFields = fieldNames.filter(field =>
            fingerprint(actualData[field]) !==
            fingerprint(expectedData[field])
          );

          // Log field names only, not question contents or PDF URLs.
          console.error('Archive comparison detected a real difference:', {
            documentId: snapshot.id,
            title: documentLabel,
            changedFields
          });

          throw new Error(
            'The saved document changed while this operation was preparing.\n\n' +
            `Document: ${documentLabel}\n` +
            `Database ID: ${snapshot.id}\n` +
            `Changed fields: ${changedFields.join(', ') || '(unknown)'}\n\n` +
            'No archive changes from this transaction were applied.\n\n' +
            'Close other editing tabs, refresh the page, and reopen Edit Parent. ' +
            'If this repeats, send the full message including the changed fields.'
          );
        }
      } else if (snapshot.exists()) {
        throw new Error(
          'A new document ID is already in use. Please retry.'
        );
      }
    }

    plan.entries.forEach((entry, index) => {
      const payload = payloads[index];

      if (
        payload.title !== entry.data.title ||
        payload.origin !== entry.data.origin ||
        String(payload.year) !== String(entry.data.year)
      ) {
        throw new Error('Document identity changed during saving.');
      }

      const target = doc(db, 'archives', entry.id);

      if (originalIds.has(entry.id)) {
        transaction.update(target, payload);
      } else {
        transaction.set(target, payload);
      }
    });

    plan.removed.forEach(item => {
      transaction.delete(doc(db, 'archives', item.id));
    });

    transaction.set(guardRef, {
      version: plan.token,
      updatedAt: new Date().toISOString(),
      updatedBy: email
    }, { merge: true });
  });

  return plan.entries.map((entry, index) => ({
    ...(plan.currentMap.get(entry.id) || {}),
    ...payloads[index],
    id: entry.id
  }));
}