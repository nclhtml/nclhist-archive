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

import {
  collection,
  getDocsFromServer
} from 'firebase/firestore';

import {
  buildBatchWriteEntries,
  getArchiveBatchTitle,
  getArchiveEditGroup,
  getArchiveQuestionNumber
} from './archiveWriteSafety.js';

import {
  stripDesignatedSampleFiles,
  validateDesignatedSampleDrafts,
  uploadQuestionDesignatedSamples
} from './DesignatedSamples.jsx';

const DBQ = 'Paper 1 (DBQ)';
const ESSAY = 'Paper 2 (Essay)';

const arrayValue = value =>
  Array.isArray(value) ? value : value ? [value] : [];

function freshDesignatedQuestion(paperType = DBQ) {
  return {
    id: Date.now() + Math.random(),
    paperType,
    questionNumber: '',
    topic: [],
    rating: 0,
    designatedSample: {},
    fileUrl: '',
    fileUrlChi: '',
    answerFileUrl: '',
    answerFileUrlChi: '',
    pagesStr: '',
    pagesStrChi: '',
    ansPagesStr: '',
    ansPagesStrChi: '',
    ansSource: 'answer',
    ansSourceChi: 'answer',
    subQuestions: [{
      id: crypto.randomUUID(),
      label: paperType === ESSAY ? '1' : 'a',
      content: '',
      contentChi: '',
      candidatePerformance: '',
      candidatePerformanceChi: '',
      marks: '',
      topic: [],
      questionType: [],
      sourceType: [],
      rating: 0,
      designatedSample: {}
    }]
  };
}

export function newDesignatedBatch({
  title = '',
  category = 'Assignments'
} = {}) {
  return {
    title,
    origin: category === 'Quizzes' ? 'Quiz' : 'Exercise',
    year: String(new Date().getFullYear()),
    tier: '10',
    questions: [freshDesignatedQuestion()]
  };
}

export function newDesignatedBatchQuestion(paperType = DBQ) {
  return freshDesignatedQuestion(paperType);
}

export async function loadDesignatedBatch(archiveId) {
  // Use the actual saved documents, not catalogue permission metadata.
  const snapshot = await getDocsFromServer(
    collection(db, 'archives')
  );

  const records = snapshot.docs.map(document => ({
    ...document.data(),
    id: document.id
  }));

  const selected = records.find(record => record.id === archiveId);

  if (!selected) {
    throw new Error('This archive record no longer exists.');
  }

  const originals = getArchiveEditGroup(records, selected)
    .sort((left, right) =>
      String(left.title).localeCompare(
        String(right.title),
        undefined,
        { numeric: true }
      ) ||
      left.id.localeCompare(right.id)
    );

  const form = {
    title: getArchiveBatchTitle(selected) || selected.title,
    origin: selected.origin,
    year: String(selected.year),
    tier: String(selected.tier || '10'),
    questions: originals.map((record, index) => ({
      id: record.id,
      originalTitle: record.title,
      paperType: record.paperType,

      // Legacy standalone DBQs may not have a number in their title.
      // This number is only the editor/import matching identity;
      // buildBatchWriteEntries preserves the saved title.
      questionNumber: record.paperType === DBQ
        ? getArchiveQuestionNumber(record) ||
          String(record.questionNumber || index + 1)
        : '',

      topic: arrayValue(record.topic),
      rating: record.rating ?? 0,
      designatedSample: record.designatedSample || {},
      fileUrl: record.fileUrl || '',
      fileUrlChi: record.fileUrlChi || '',
      answerFileUrl: record.answerFileUrl || '',
      answerFileUrlChi: record.answerFileUrlChi || '',
      pagesStr: '',
      pagesStrChi: '',
      ansPagesStr: '',
      ansPagesStrChi: '',
      ansSource: 'answer',
      ansSourceChi: 'answer',
      subQuestions: (record.subQuestions || []).map(sub => ({
        ...sub,
        topic: arrayValue(sub.topic),
        questionType: arrayValue(sub.questionType),
        sourceType: arrayValue(sub.sourceType),
        designatedSample: sub.designatedSample || {}
      }))
    }))
  };

  return {
    originals: JSON.parse(JSON.stringify(originals)),
    form: JSON.parse(JSON.stringify(form))
  };
}

function selectedPageIndices(value, source, description) {
  const text = String(value ?? '')
    .trim()
    .replace(/[–—]/g, '-')
    .replace(/，/g, ',');

  if (!text) return [];

  if (!source?.file || !source?.pdf) {
    throw new Error(`${description}: select its source PDF first.`);
  }

  if (
    !/^[1-9]\d*(?:\s*-\s*[1-9]\d*)?(?:\s*,\s*[1-9]\d*(?:\s*-\s*[1-9]\d*)?)*$/.test(text)
  ) {
    throw new Error(
      `${description}: use a range such as "2", "2-4", or "2, 5-6".`
    );
  }

  const maximum = source.pdf.getPageCount();
  const pages = new Set();

  for (const part of text.split(',')) {
    const bounds = part.trim().split('-').map(Number);
    const start = bounds[0];
    const end = bounds.length === 2 ? bounds[1] : start;

    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < start ||
      end > maximum
    ) {
      throw new Error(
        `${description}: "${part.trim()}" is invalid. ` +
        `The selected source has ${maximum} PDF pages.`
      );
    }

    for (let number = start; number <= end; number++) {
      pages.add(number - 1);
    }
  }

  return [...pages].sort((left, right) => left - right);
}

export async function saveDesignatedBatch({
  form,
  originals,
  sources,
  email
}) {
  if (!String(form.title || '').trim()) {
    throw new Error('Enter the examination/document title.');
  }

  if (!form.origin || !/^\d{4}$/.test(String(form.year || ''))) {
    throw new Error('Select an origin and enter a four-digit year.');
  }

  if (!form.questions?.length) {
    throw new Error('Keep at least one question set.');
  }

  for (const [role, file] of Object.entries(form.aiSourceFiles || {})) {
    if (sources[role]?.file !== file) {
      throw new Error(
        'An AI-import source PDF changed. Reopen the saved editor or ' +
        'regenerate the new draft using the selected files.'
      );
    }
  }

  // Validate every range before preparing/uploads.
  const pagePlans = form.questions.map((question, index) => {
    const label = question.originalTitle || `Question set ${index + 1}`;
    const result = {};

    for (const language of ['en', 'zh']) {
      const suffix = language === 'zh' ? 'Chi' : '';
      const main = sources[`question_${language}`];
      const answerSource = question[`ansSource${suffix}`] || 'answer';

      if (!['main', 'answer'].includes(answerSource)) {
        throw new Error(`${label}: invalid answer source.`);
      }

      result[`fileUrl${suffix}`] = {
        indices: selectedPageIndices(
          question[`pagesStr${suffix}`],
          main,
          `${label} ${language.toUpperCase()} question pages`
        ),
        source: main
      };

      const answer = answerSource === 'main'
        ? main
        : sources[`answer_${language}`];

      result[`answerFileUrl${suffix}`] = {
        indices: selectedPageIndices(
          question[`ansPagesStr${suffix}`],
          answer,
          `${label} ${language.toUpperCase()} answer pages`
        ),
        source: answer
      };

      for (const field of [
        `fileUrl${suffix}`,
        `answerFileUrl${suffix}`
      ]) {
        if (question[field] && result[field].indices.length) {
          throw new Error(
            `${label}: detach the saved ${field} attachment before ` +
            'entering replacement pages.'
          );
        }
      }
    }

    if (
      question.paperType === DBQ &&
      !question.fileUrl &&
      !question.fileUrlChi &&
      !result.fileUrl.indices.length &&
      !result.fileUrlChi.indices.length
    ) {
      throw new Error(`${label}: supply a DBQ question PDF in at least one language.`);
    }

    return result;
  });

  await validateDesignatedSampleDrafts(form.questions);

  const entries = buildBatchWriteEntries({
    ...form,
    questions: form.questions.map(stripDesignatedSampleFiles)
  }, originals);

  const plan = await prepareArchiveWrite({
    originals,
    entries,
    newExamTitle: originals.length ? '' : form.title
  });

  if (
    plan.removed.length &&
    !window.confirm(
      'Remove these question records when saving?\n\n' +
      plan.removed.map(record => `${record.title} [${record.id}]`).join('\n') +
      '\n\nBoth languages belong to the same record. ' +
      'Existing Storage files will not be deleted.'
    )
  ) {
    return null;
  }

  const originalMap = new Map(
    originals.map(record => [record.id, record])
  );

  const payloads = [];

  for (let index = 0; index < form.questions.length; index++) {
    const question = form.questions[index];
    const entry = plan.entries[index];
    const original = originalMap.get(entry.id);

    const privateArchiveId = entry.data.versionFamilyId
      ? entry.id
      : '';

    const attachments = {
      fileUrl: question.fileUrl || '',
      fileUrlChi: question.fileUrlChi || '',
      answerFileUrl: question.answerFileUrl || '',
      answerFileUrlChi: question.answerFileUrlChi || ''
    };

    for (const [field, selection] of Object.entries(pagePlans[index])) {
      if (!selection.indices.length) continue;

      const output = await PDFDocument.create();
      const pages = await output.copyPages(
        selection.source.pdf,
        selection.indices
      );

      pages.forEach(page => output.addPage(page));

      attachments[field] = await saveArchivePdf(
        await output.save(),
        `pdfs/designated/${entry.id}/${plan.token}/${field}.pdf`,
        privateArchiveId
      );
    }

    const samples = await uploadQuestionDesignatedSamples(
      question,
      `${entry.id}/${plan.token}`,
      privateArchiveId
    );

    const { id: ignoredOriginalId, ...savedOriginal } = original || {};

    payloads.push({
      ...savedOriginal,
      ...entry.data,
      ...attachments,
      designatedSample: samples.designatedSample,
      subQuestions: samples.subQuestions.map(sub => ({
        ...sub,
        marks: question.paperType === ESSAY ? '' : (sub.marks ?? '')
      })),
      hasFile: Boolean(attachments.fileUrl || attachments.fileUrlChi),
      hasAnswer: Boolean(
        attachments.answerFileUrl || attachments.answerFileUrlChi
      ),
      updatedAt: new Date().toISOString(),
      updatedBy: email
    });
  }

  return commitArchiveWrite(plan, payloads, email);
}

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