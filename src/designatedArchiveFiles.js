import {
  doc,
  getDocFromServer
} from 'firebase/firestore';

import { PDFDocument } from 'pdf-lib';

import { db } from './firebase.js';
import {
  prepareArchiveWrite,
  commitArchiveWrite
} from './archiveWriteSafety.js';

import { saveArchivePdf } from './archiveVersionFiles.js';

async function validatePdf(file) {
  if (!file) return;

  if (file.size === 0 || file.size > 8 * 1024 * 1024) {
    throw new Error('Each PDF must be non-empty and at most 8 MiB.');
  }

  await PDFDocument.load(await file.arrayBuffer());
}

export async function createDesignatedArchive({
  title,
  paperType,
  category,
  englishFile,
  chineseFile,
  email
}) {
  const cleanTitle = String(title || '').trim();

  if (!cleanTitle) throw new Error('Enter the item/document name first.');

  if (!englishFile && !chineseFile) {
    throw new Error('Select at least one language PDF.');
  }

  await Promise.all([
    validatePdf(englishFile),
    validatePdf(chineseFile)
  ]);

  const year = new Date().getFullYear().toString();

  const data = {
    title: cleanTitle,
    origin: category === 'Quizzes' ? 'Quiz' : 'Exercise',
    year,
    paperType,
    topic: [],
    tier: '10',
    rating: 0,
    subQuestions: [{
      id: crypto.randomUUID(),
      label: paperType === 'Paper 2 (Essay)' ? '1' : 'a',
      content: cleanTitle,
      contentChi: '',
      marks: '',
      topic: [],
      questionType: [],
      sourceType: []
    }]
  };

  const plan = await prepareArchiveWrite({
    entries: [{ id: null, data }]
  });

  const archiveId = plan.entries[0].id;
  const folder = `pdfs/designated/${archiveId}/${plan.token}`;

  const fileUrl = englishFile
    ? await saveArchivePdf(englishFile, `${folder}/english.pdf`)
    : '';

  const fileUrlChi = chineseFile
    ? await saveArchivePdf(chineseFile, `${folder}/chinese.pdf`)
    : '';

  const payload = {
    ...data,
    fileUrl,
    fileUrlChi,
    answerFileUrl: '',
    answerFileUrlChi: '',
    hasFile: Boolean(fileUrl || fileUrlChi),
    hasAnswer: false,
    updatedAt: new Date().toISOString(),
    updatedBy: email
  };

  const saved = await commitArchiveWrite(plan, [payload], email);

  return saved[0];
}

export async function addDesignatedArchiveLanguage({
  archiveId,
  language,
  file,
  email
}) {
  await validatePdf(file);

  if (!file) return null;

  const snapshot = await getDocFromServer(
    doc(db, 'archives', archiveId)
  );

  if (!snapshot.exists()) {
    throw new Error('The linked archive record no longer exists.');
  }

  const original = {
    ...snapshot.data(),
    id: snapshot.id
  };

  const field = language === 'zh' ? 'fileUrlChi' : 'fileUrl';

  if (original[field]) {
    throw new Error(
      'This language PDF was already added elsewhere. Reload the list.'
    );
  }

  const { id, ...data } = original;

  const plan = await prepareArchiveWrite({
    originals: [original],
    entries: [{ id, data }]
  });

  const fileUrl = await saveArchivePdf(
    file,
    `pdfs/designated/${id}/${plan.token}/${language}.pdf`,
    original.versionFamilyId ? id : ''
  );

  const payload = {
    ...data,
    [field]: fileUrl,
    hasFile: true,
    updatedAt: new Date().toISOString(),
    updatedBy: email
  };

  const saved = await commitArchiveWrite(plan, [payload], email);

  return saved[0];
}