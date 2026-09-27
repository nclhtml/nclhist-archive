import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  runTransaction
} from 'firebase/firestore';

import { db } from './firebase.js';

const guardRef = doc(db, 'system_settings', 'archive_write_guard');

const VERSION_FIELDS = [
  'versionFamilyId',
  'versionId',
  'versionLabel',
  'versionIsOriginal'
];

export function normalizeArchiveName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[–—]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, '');
}

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
  const match = String(archive.title || '').match(/D\s+Q\s*(\d+)$/i);
  return match ? String(Number(match[1])) : '';
}

export function canVersionArchive(archive) {
  const origin = String(archive?.origin || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();

  if (!origin) return false;

  return !(
    origin.includes('dse') ||
    origin.includes('mock') ||
    origin.includes('internal assessment') ||
    origin.includes('internal school exam')
  );
}

export function getArchiveVersionLabel(archive) {
  const label = String(
    archive?.versionLabel || archive?.year || 'Year unknown'
  );

  return archive?.versionFamilyId
    ? `${label}${archive.versionIsOriginal ? ' (Original)' : ''}`
    : `${label} (Original)`;
}

// Once a family exists, title/year matching must never combine versions.
export function getArchiveEditGroup(records, selected) {
  if (selected.versionFamilyId) {
    return records.filter(item =>
      item.versionFamilyId === selected.versionFamilyId &&
      item.versionId === selected.versionId
    );
  }

  const base = getArchiveBatchTitle(selected);

  if (!base) return [selected];

  return records.filter(item =>
    !item.versionFamilyId &&
    normalizeArchiveName(getArchiveBatchTitle(item)) ===
      normalizeArchiveName(base) &&
    String(item.year) === String(selected.year) &&
    item.origin === selected.origin
  );
}

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

function versionMetadata(record) {
  if (!record?.versionFamilyId) return {};

  if (
    typeof record.versionFamilyId !== 'string' ||
    typeof record.versionId !== 'string' ||
    !record.versionId ||
    typeof record.versionLabel !== 'string' ||
    !record.versionLabel
  ) {
    throw new Error('This record has incomplete version information.');
  }

  return Object.fromEntries(
    VERSION_FIELDS.map(field => [field, record[field]])
  );
}

function assertUnchanged(expected, actual) {
  if (
    !actual ||
    fingerprint(withoutId(actual)) !== fingerprint(withoutId(expected))
  ) {
    throw new Error(
      `"${expected.title}" changed or was deleted after the editor opened.\n\n` +
      'Close the editor, refresh, and reopen Edit Parent. Nothing was saved.'
    );
  }
}

function getNewVersionMetadata(form) {
  const draft = form.versionDraft;
  if (!draft) return {};

  const sources = draft.sources || [];
  const first = sources[0];

  if (!first || !sources.every(canVersionArchive)) {
    throw new Error('These documents cannot have additional versions.');
  }

  const base = getArchiveBatchTitle(first) || first.title;

  if (
    normalizeArchiveName(form.title) !== normalizeArchiveName(base) ||
    form.origin !== first.origin
  ) {
    throw new Error(
      'A new version must keep the original document title and origin.'
    );
  }

  const label = String(form.versionLabel || form.year || '').trim();

  if (!label || label.length > 80) {
    throw new Error('Enter a version label of 1–80 characters.');
  }

  const familyId = first.versionFamilyId ||
    [...sources].map(item => item.id).sort()[0];

  if (
    draft.familyId !== familyId ||
    typeof draft.versionId !== 'string' ||
    !draft.versionId ||
    sources.some(item =>
      first.versionFamilyId
        ? (
          item.versionFamilyId !== first.versionFamilyId ||
          item.versionId !== first.versionId
        )
        : Boolean(item.versionFamilyId)
    )
  ) {
    throw new Error('The version draft is invalid. Reopen Edit Parent.');
  }

  return {
    versionFamilyId: familyId,
    versionId: draft.versionId,
    versionLabel: label,
    versionIsOriginal: false
  };
}

export function buildBatchWriteEntries(form, originals) {
  const originalMap = new Map(originals.map(item => [item.id, item]));
  const baseTitle = String(form.title || '').trim();

  if (originals.length && form.versionDraft) {
    throw new Error('A draft cannot edit an existing version and create one together.');
  }

  let metadata = {};

  if (originals.length) {
    const first = originals[0];
    const originalBase = getArchiveBatchTitle(first) || first.title;

    if (
      normalizeArchiveName(baseTitle) !== normalizeArchiveName(originalBase) ||
      form.origin !== first.origin ||
      String(form.year) !== String(first.year)
    ) {
      throw new Error(
        'When editing, keep the original title, origin and year. ' +
        'Use Add new version to create a different year/version.'
      );
    }

    metadata = versionMetadata(first);

    if (originals.some(item =>
      (item.versionFamilyId || '') !== (first.versionFamilyId || '') ||
      (item.versionId || '') !== (first.versionId || '')
    )) {
      throw new Error('This editing session contains different versions.');
    }
  } else {
    metadata = getNewVersionMetadata(form);
  }

  let highestNumber = 0;

  // Include removed originals, so their numbers are not silently reused.
  originals.forEach(item => {
    highestNumber = Math.max(
      highestNumber,
      Number(getArchiveQuestionNumber(item)) || 0
    );
  });

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
        'This draft contains a saved record from another editing session.'
      );
    }

    if (!['Paper 1 (DBQ)', 'Paper 2 (Essay)'].includes(question.paperType)) {
      throw new Error('Select a supported paper type for every question set.');
    }

    if (original && question.paperType !== original.paperType) {
      throw new Error(`Keep the existing paper type for "${original.title}".`);
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
        throw new Error('DBQ numbers must be positive whole numbers.');
      }

      title = `${baseTitle}D Q${questionNumber}`;
    } else {
      title = `${baseTitle}E`;
    }

    // Preserve corresponding legacy question titles in a new version.
    // This also supports single documents with non-standard titles.
    if (!original && form.versionDraft) {
      const sources = form.versionDraft.sources;

      let corresponding = sources.find(item =>
        item.paperType === question.paperType &&
        (
          question.paperType === 'Paper 2 (Essay)' ||
          getArchiveQuestionNumber(item) === questionNumber
        )
      );

      if (
        sources.length === 1 &&
        form.questions.length === 1 &&
        sources[0].paperType === question.paperType
      ) {
        corresponding = sources[0];
      }

      if (corresponding) title = corresponding.title;
    }

    const subQuestions = (question.subQuestions || []).map(sub => ({
      ...sub,
      marks: question.paperType === 'Paper 2 (Essay)'
        ? ''
        : (sub.marks ?? '')
    }));

    if (!subQuestions.length) {
      throw new Error(`"${title}" needs at least one sub-question.`);
    }

    const labels = subQuestions.map(sub => normalizeArchiveName(sub.label));
    const ids = subQuestions.map(sub =>
      sub.id === undefined || sub.id === null ? '' : String(sub.id)
    );

    if (
      labels.some(label => !label) ||
      ids.some(id => !id) ||
      new Set(labels).size !== labels.length ||
      new Set(ids).size !== ids.length
    ) {
      throw new Error(
        `"${title}" has blank or duplicated sub-question labels/IDs.`
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
        subQuestions,
        ...metadata
      }
    };
  });
}

export async function prepareArchiveWrite({
  originals = [],
  entries = [],
  newExamTitle = '',
  versionDraft = null
}) {
  const sources = versionDraft?.sources || [];

  if (originals.length + entries.length + sources.length > 150) {
    throw new Error(
      'At most 150 combined original, source and draft records are supported per save.'
    );
  }

  const guardSnapshot = await getDocFromServer(guardRef);
  const version = guardSnapshot.data()?.version || '';

  const archiveSnapshot = await getDocsFromServer(collection(db, 'archives'));
  const current = archiveSnapshot.docs.map(snapshot => ({
    ...snapshot.data(),
    id: snapshot.id
  }));

  const currentMap = new Map(current.map(item => [item.id, item]));
  const originalIds = new Set(originals.map(item => item.id));

  [...originals, ...sources].forEach(original => {
    assertUnchanged(original, currentMap.get(original.id));
  });

  const promotions = [];

  if (versionDraft) {
    if (originals.length || !sources.length || !entries.length) {
      throw new Error('Invalid new-version operation.');
    }

    const first = sources[0];
    const meta = entries[0].data;

    const actualGroup = getArchiveEditGroup(current, currentMap.get(first.id));
    const sourceIds = new Set(sources.map(item => item.id));

    if (
      actualGroup.length !== sources.length ||
      actualGroup.some(item => !sourceIds.has(item.id))
    ) {
      throw new Error(
        'The original question group changed. Reopen Edit Parent before adding a version.'
      );
    }

    if (
      !sources.every(canVersionArchive) ||
      !meta.versionFamilyId ||
      !meta.versionId ||
      meta.versionIsOriginal !== false ||
      entries.some(entry =>
        entry.data.versionFamilyId !== meta.versionFamilyId ||
        entry.data.versionId !== meta.versionId ||
        entry.data.versionLabel !== meta.versionLabel ||
        entry.data.origin !== first.origin
      )
    ) {
      throw new Error('Invalid version identity.');
    }

    if (!first.versionFamilyId) {
      const familyId = [...sourceIds].sort()[0];

      if (meta.versionFamilyId !== familyId) {
        throw new Error('The original family identifier changed.');
      }

      sources.forEach(item => {
        promotions.push({
          id: item.id,
          data: {
            versionFamilyId: familyId,
            versionId: familyId,
            versionLabel: String(item.year || 'Year unknown'),
            versionIsOriginal: true
          }
        });
      });
    } else if (meta.versionFamilyId !== first.versionFamilyId) {
      throw new Error('The new version belongs to a different family.');
    }

    const familyRecords = [
      ...current.filter(item => item.versionFamilyId === meta.versionFamilyId),
      ...promotions.map(item => ({
        ...currentMap.get(item.id),
        ...item.data
      }))
    ];

    if (familyRecords.some(item =>
      item.versionId === meta.versionId ||
      normalizeArchiveName(item.versionLabel) ===
        normalizeArchiveName(meta.versionLabel)
    )) {
      throw new Error(
        `Version "${meta.versionLabel}" already exists in this family.\n\n` +
        'Choose a different label, for example "2026 revised". ' +
        'The year field can remain unchanged.'
      );
    }
  }

  if (newExamTitle && !versionDraft) {
    const key = normalizeArchiveName(newExamTitle);
    const existing = current.find(item =>
      normalizeArchiveName(getArchiveBatchTitle(item) || item.title) === key
    );

    if (existing) {
      throw new Error(
        `The document family "${newExamTitle}" already exists.\n\n` +
        'Use Edit Parent to correct it or Add new version to create a version.'
      );
    }
  }

  const promotedMap = new Map(promotions.map(item => [item.id, item.data]));
  const names = new Set();
  const retainedIds = new Set();

  const plannedEntries = entries.map(entry => {
    const titleKey = normalizeArchiveName(entry.data.title);

    if (!titleKey || names.has(titleKey)) {
      throw new Error(`Missing or duplicated draft title: "${entry.data.title}".`);
    }

    names.add(titleKey);

    if (entry.id) {
      if (!originalIds.has(entry.id) || retainedIds.has(entry.id)) {
        throw new Error('A saved document ID is invalid or repeated.');
      }

      retainedIds.add(entry.id);
    }

    const conflict = current.find(item => {
      if (originalIds.has(item.id)) return false;
      if (normalizeArchiveName(item.title) !== titleKey) return false;

      const other = { ...item, ...(promotedMap.get(item.id) || {}) };

      // Equal titles are valid ONLY across versions of the SAME family.
      return !(
        entry.data.versionFamilyId &&
        other.versionFamilyId === entry.data.versionFamilyId &&
        other.versionId &&
        other.versionId !== entry.data.versionId
      );
    });

    if (conflict) {
      throw new Error(
        `"${entry.data.title}" already exists outside this version.\n` +
        `Existing ID: ${conflict.id}`
      );
    }

    return {
      ...entry,
      id: entry.id || doc(collection(db, 'archives')).id
    };
  });

  const removed = originals.filter(item => !retainedIds.has(item.id));
  const removedIds = new Set(removed.map(item => item.id));
  const removedChildLinks = new Set();

  for (const entry of plannedEntries) {
    const original = currentMap.get(entry.id);
    if (!original) continue;

    const kept = new Set(
      (entry.data.subQuestions || []).map(child => String(child.id))
    );

    (original.subQuestions || []).forEach(child => {
      if (!kept.has(String(child.id))) {
        removedChildLinks.add(`${original.id}_${child.id}`);
      }
    });
  }

  // Version deletion is deliberately not part of this feature.
  // Retaining saved IDs avoids breaking old assignment links.
  if (
    originals.some(item => item.versionFamilyId) &&
    (removed.length || removedChildLinks.size)
  ) {
    throw new Error(
      'Saved version records and their question IDs must be retained.\n\n' +
      'You may edit their wording, tags and attachments, or add questions. ' +
      'To create a different question structure, use Add new version.'
    );
  }

  if (removed.length || removedChildLinks.size) {
    const assessments = await getDocsFromServer(collection(db, 'assessments'));

    const isRemovedLink = link =>
      typeof link === 'string' &&
      (
        removedIds.has(link) ||
        removedChildLinks.has(link) ||
        [...removedIds].some(id => link.startsWith(`${id}_`))
      );

    const linked = assessments.docs.filter(snapshot => {
      const data = snapshot.data();

      return isRemovedLink(data.linkedDocId) ||
        (data.sectionsConfig || []).some(section =>
          isRemovedLink(section.linkedDocId)
        );
    });

    if (linked.length) {
      throw new Error(
        'Removal stopped. These assessments still use the removed records:\n\n' +
        linked.map(snapshot =>
          `${snapshot.data().name || 'Assessment'} [${snapshot.id}]`
        ).join('\n')
      );
    }
  }

  return {
    version,
    token: doc(collection(db, 'archives')).id,
    entries: plannedEntries,
    originals,
    sources,
    promotions,
    removed,
    currentMap
  };
}

function checkPrivateAttachments(value, archiveId) {
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    if (
      ['fileUrl', 'fileUrlChi', 'answerFileUrl', 'answerFileUrlChi'].includes(key) &&
      child
    ) {
      if (typeof child !== 'string' || !child.startsWith('/archive-pdf?')) {
        throw new Error('New versions must use protected PDF attachments.');
      }

      const params = new URLSearchParams(child.split('?')[1]);
      const path = params.get('path') || '';

      if (!path.startsWith(`archive_versions/${archiveId}/`)) {
        throw new Error('A PDF attachment belongs to another version record.');
      }
    } else if (child && typeof child === 'object') {
      checkPrivateAttachments(child, archiveId);
    }
  }
}

export async function commitArchiveWrite(plan, payloads, email) {
  if (payloads.length !== plan.entries.length) {
    throw new Error('The prepared document count changed.');
  }

  const expectedRecords = new Map(
    [...plan.originals, ...(plan.sources || [])]
      .map(item => [item.id, item])
  );

  const originalIds = new Set(plan.originals.map(item => item.id));
  const affectedIds = [...new Set([
    ...expectedRecords.keys(),
    ...plan.entries.map(entry => entry.id)
  ])];

  payloads.forEach((payload, index) => {
    const entry = plan.entries[index];

    if (
      payload.title !== entry.data.title ||
      payload.origin !== entry.data.origin ||
      String(payload.year) !== String(entry.data.year) ||
      VERSION_FIELDS.some(field =>
        payload[field] !== entry.data[field]
      )
    ) {
      throw new Error('Document/version identity changed during saving.');
    }

    if (payload.versionFamilyId && payload.versionIsOriginal === false) {
      checkPrivateAttachments(payload, entry.id);
    }
  });

  await runTransaction(db, async transaction => {
    const guard = await transaction.get(guardRef);

    if ((guard.data()?.version || '') !== plan.version) {
      throw new Error(
        'Another archive save finished while this operation was preparing. ' +
        'Refresh and reopen the editor. No archive changes were applied.'
      );
    }

    const snapshots = [];

    for (const id of affectedIds) {
      snapshots.push(await transaction.get(doc(db, 'archives', id)));
    }

    for (const snapshot of snapshots) {
      const expected = expectedRecords.get(snapshot.id);

      if (expected) {
        assertUnchanged(
          expected,
          snapshot.exists()
            ? { ...snapshot.data(), id: snapshot.id }
            : null
        );
      } else if (snapshot.exists()) {
        throw new Error('A new archive ID is already in use. Please retry.');
      }
    }

    plan.entries.forEach((entry, index) => {
      const target = doc(db, 'archives', entry.id);

      if (originalIds.has(entry.id)) {
        transaction.update(target, payloads[index]);
      } else {
        transaction.set(target, payloads[index]);
      }
    });

    (plan.promotions || []).forEach(item => {
      // Metadata only: original content, years, IDs and links stay intact.
      transaction.update(doc(db, 'archives', item.id), item.data);
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

  return [
    ...plan.entries.map((entry, index) => ({
      ...(plan.currentMap.get(entry.id) || {}),
      ...payloads[index],
      id: entry.id
    })),
    ...(plan.promotions || []).map(item => ({
      ...plan.currentMap.get(item.id),
      ...item.data,
      id: item.id
    }))
  ];
}