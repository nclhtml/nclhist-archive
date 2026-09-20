import React, { useState } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { PDFDocument } from 'pdf-lib';
import { storage } from './firebase.js';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_LENGTH = 16000;

const EMPTY_VERSION = {
  text: '',
  fileUrl: ''
};

function getVersion(sample, language) {
  const value = sample?.[language];

  return {
    text: typeof value?.text === 'string' ? value.text : '',
    fileUrl: typeof value?.fileUrl === 'string' ? value.fileUrl : '',
    pendingFile: value?.pendingFile || null
  };
}

function savedSampleData(sample) {
  return {
    en: {
      text: getVersion(sample, 'en').text,
      fileUrl: getVersion(sample, 'en').fileUrl
    },
    zh: {
      text: getVersion(sample, 'zh').text,
      fileUrl: getVersion(sample, 'zh').fileUrl
    }
  };
}

// The archive planning helper must receive ordinary data,
// never browser File objects.
export function stripDesignatedSampleFiles(question) {
  return {
    ...question,
    designatedSample: savedSampleData(question.designatedSample),
    subQuestions: (question.subQuestions || []).map(sub => ({
      ...sub,
      designatedSample: savedSampleData(sub.designatedSample)
    }))
  };
}

// Validate every designated sample before uploading any of its PDFs.
export async function validateDesignatedSampleDrafts(questions) {
  let totalTextBytes = 0;

  for (const [questionIndex, question] of questions.entries()) {
    const targets = [
      {
        label: `Question set ${questionIndex + 1}, whole question`,
        sample: question.designatedSample
      },
      ...(question.subQuestions || []).map(sub => ({
        label: `Question set ${questionIndex + 1}, part ${sub.label}`,
        sample: sub.designatedSample
      }))
    ];

    for (const target of targets) {
      for (const language of ['en', 'zh']) {
        const version = getVersion(target.sample, language);

        if (version.text.length > MAX_TEXT_LENGTH) {
          throw new Error(
            `${target.label}: ${language.toUpperCase()} sample text ` +
            `exceeds ${MAX_TEXT_LENGTH} characters.`
          );
        }

        totalTextBytes += new TextEncoder().encode(version.text).length;

        if (!version.pendingFile) continue;

        const file = version.pendingFile;

        if (
          !(file instanceof File) ||
          !/\.pdf$/i.test(file.name) ||
          file.size === 0 ||
          file.size > MAX_FILE_BYTES
        ) {
          throw new Error(
            `${target.label}: select a non-empty PDF of at most 20 MB.`
          );
        }

        try {
          const pdf = await PDFDocument.load(await file.arrayBuffer());

          if (pdf.getPageCount() < 1) {
            throw new Error('Empty PDF');
          }
        } catch {
          throw new Error(
            `${target.label}: the ${language.toUpperCase()} sample PDF ` +
            'cannot be read. Use a valid, unprotected PDF.'
          );
        }
      }
    }
  }

  // A conservative limit for this feature, separate from question content.
  if (totalTextBytes > 300000) {
    throw new Error(
      'This batch contains too much designated-sample text. ' +
      'Use PDF attachments for longer samples.'
    );
  }
}

async function uploadSample(sample, folder) {
  const result = savedSampleData(sample);

  for (const language of ['en', 'zh']) {
    const version = getVersion(sample, language);

    if (!version.pendingFile) continue;

    const fileRef = ref(
      storage,
      `pdfs/designated_samples/${folder}/${language}-${crypto.randomUUID()}.pdf`
    );

    await uploadBytes(fileRef, version.pendingFile, {
      contentType: 'application/pdf'
    });

    result[language].fileUrl = await getDownloadURL(fileRef);
  }

  return result;
}

export async function uploadQuestionDesignatedSamples(question, folder) {
  const designatedSample = await uploadSample(
    question.designatedSample,
    `${folder}/whole`
  );

  const subQuestions = [];

  for (const [index, sub] of (question.subQuestions || []).entries()) {
    subQuestions.push({
      ...sub,
      designatedSample: await uploadSample(
        sub.designatedSample,
        `${folder}/part-${index}`
      )
    });
  }

  return {
    designatedSample,
    subQuestions
  };
}

function VersionEditor({ language, sample, onChange, disabled }) {
  const version = getVersion(sample, language);

  const update = patch => {
    onChange({
      ...(sample || {}),
      [language]: {
        ...version,
        ...patch
      }
    });
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-white p-3 space-y-3">
      <h4 className="text-sm font-bold text-amber-900">
        {language === 'zh' ? 'Chinese Version / 中文版' : 'English Version'}
      </h4>

      <textarea
        rows={6}
        maxLength={MAX_TEXT_LENGTH}
        disabled={disabled}
        value={version.text}
        onChange={event => update({ text: event.target.value })}
        placeholder={
          language === 'zh'
            ? '在此貼上中文指定範例。也可以附上 PDF。'
            : 'Paste the designated sample here, or attach a PDF below.'
        }
        className="w-full rounded-lg border border-slate-300 p-3 text-sm whitespace-pre-wrap"
      />

      <p className="text-xs text-slate-500">
        Optional PDF — maximum 20 MB. Saved only with Upload Data / Update Archive.
      </p>

      <input
        type="file"
        accept=".pdf,application/pdf"
        disabled={disabled}
        className="block w-full text-xs"
        onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';

          if (!file) return;

          if (
            !/\.pdf$/i.test(file.name) ||
            file.size === 0 ||
            file.size > MAX_FILE_BYTES
          ) {
            window.alert('Choose a non-empty PDF of at most 20 MB.');
            return;
          }

          update({ pendingFile: file });
        }}
      />

      {version.pendingFile ? (
        <div className="space-y-2 text-xs text-amber-900">
          <p>Pending upload: {version.pendingFile.name}</p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => update({ pendingFile: null })}
            className="rounded border border-amber-300 px-2 py-1 font-bold"
          >
            Cancel replacement
          </button>
        </div>
      ) : version.fileUrl ? (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <a
            href={version.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="font-bold text-blue-700 underline"
          >
            View saved PDF
          </a>

          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!window.confirm(
                'Detach this designated-sample PDF?\n\n' +
                'The change is saved only after Upload Data / Update Archive.'
              )) return;

              update({
                fileUrl: '',
                pendingFile: null
              });
            }}
            className="font-bold text-red-700"
          >
            Remove PDF attachment
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-400">No PDF attached.</p>
      )}
    </div>
  );
}

export function DesignatedSampleEditor({
  questions,
  onChange,
  disabled
}) {
  const updateTarget = (questionIndex, subIndex, sample) => {
    onChange(previous =>
      previous.map((question, index) => {
        if (index !== questionIndex) return question;

        if (subIndex === null) {
          return {
            ...question,
            designatedSample: sample
          };
        }

        return {
          ...question,
          subQuestions: question.subQuestions.map((sub, index) =>
            index !== subIndex
              ? sub
              : {
                ...sub,
                designatedSample: sample
              }
          )
        };
      })
    );
  };

  return (
    <section className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 space-y-5">
      <div>
        <h3 className="text-lg font-bold text-amber-950">
          Designated Samples
        </h3>

        <p className="mt-2 text-sm text-amber-900">
          These are teacher-selected examples, not marked student scripts.
          Add a sample for a whole question, an individual part, or both.
          English and Chinese versions are saved together.
        </p>

        <p className="mt-2 text-xs font-bold text-amber-900">
          Nothing is saved until you click Upload Data / Update Archive.
          Clearing both text and PDF removes that language version.
        </p>
      </div>

      {questions.map((question, questionIndex) => {
        const questionTitle = question.originalTitle ||
          `New question set ${questionIndex + 1}`;

        const targets = [
          {
            key: 'whole',
            subIndex: null,
            title: `${questionTitle} — whole question record`,
            sample: question.designatedSample
          },
          ...(question.subQuestions || []).map((sub, subIndex) => ({
            key: `sub-${sub.id}`,
            subIndex,
            title: `${questionTitle} — part / essay ${sub.label}`,
            sample: sub.designatedSample
          }))
        ];

        return (
          <div key={question.id} className="space-y-3">
            <h3 className="border-b border-amber-300 pb-2 font-bold text-amber-950">
              {questionTitle}
            </h3>

            {targets.map(target => (
              <details
                key={target.key}
                className="rounded-lg border border-amber-300 bg-white p-3"
              >
                <summary className="cursor-pointer text-sm font-bold text-amber-950">
                  {target.title}
                </summary>

                <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {['en', 'zh'].map(language => (
                    <VersionEditor
                      key={language}
                      language={language}
                      sample={target.sample}
                      disabled={disabled}
                      onChange={sample =>
                        updateTarget(questionIndex, target.subIndex, sample)
                      }
                    />
                  ))}
                </div>
              </details>
            ))}
          </div>
        );
      })}
    </section>
  );
}

export function getDesignatedSamples(previewItem, language, isAdmin = false) {
  if (!previewItem || previewItem.isDseViewOnly) return [];

  const parent = previewItem.parent;
  const allowWhole = Boolean(previewItem.hasFullAccess || isAdmin);
  const targets = [];

  // Do not expose a whole-question sample through restricted part-only access.
  if (allowWhole) {
    targets.push({
      id: `${parent.id}:whole`,
      title: parent.title,
      sample: parent.designatedSample
    });
  }

  const children = previewItem.isFullPaper
    ? (
      allowWhole
        ? parent.subQuestions || []
        : previewItem.matchedChildren || []
    )
    : (previewItem.child ? [previewItem.child] : []);

  children.forEach(sub => {
    targets.push({
      id: `${parent.id}:part:${sub.id}`,
      title: `${parent.title} — ${sub.label}`,
      sample: sub.designatedSample
    });
  });

  const preferred = language === 'zh' ? 'zh' : 'en';
  const alternative = preferred === 'zh' ? 'en' : 'zh';

  return targets.flatMap(target => {
    const first = getVersion(target.sample, preferred);
    const second = getVersion(target.sample, alternative);

    const firstExists = Boolean(first.text.trim() || first.fileUrl);
    const secondExists = Boolean(second.text.trim() || second.fileUrl);

    if (!firstExists && !secondExists) return [];

    return [{
      id: target.id,
      title: target.title,
      text: firstExists ? first.text : second.text,
      fileUrl: firstExists ? first.fileUrl : second.fileUrl,
      language: firstExists ? preferred : alternative,
      fallback: !firstExists
    }];
  });
}

export function DesignatedSampleList({
  previewItem,
  language,
  isAdmin,
  getPdfUrl,
  PdfViewer,
  onDownload
}) {
  const [openedPdf, setOpenedPdf] = useState(null);
  const samples = getDesignatedSamples(previewItem, language, isAdmin);

  if (!samples.length) return null;

  return (
    <>
      {samples.map(sample => (
        <article
          key={sample.id}
          className="overflow-hidden rounded-lg border-2 border-amber-500 bg-amber-50 shadow-sm"
        >
          <div className="bg-amber-900 px-3 py-2 text-white">
            <h4 className="text-sm font-bold">
              ★ {language === 'zh' ? '指定範例' : 'Designated Sample'}
            </h4>
            <p className="mt-1 text-xs">{sample.title}</p>
          </div>

          <div className="p-3 space-y-3">
            <p className="text-xs font-bold text-amber-950">
              {sample.language === 'zh' ? '中文版' : 'English version'}
            </p>

            {sample.fallback && (
              <p className="rounded border border-amber-300 bg-white p-2 text-xs text-amber-900">
                {language === 'zh'
                  ? '尚未提供中文版，現顯示英文版。'
                  : 'No English version is available; showing Chinese.'}
              </p>
            )}

            {sample.text && (
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-900">
                {sample.text}
              </div>
            )}

            {sample.fileUrl && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setOpenedPdf(sample)}
                  className="hidden md:inline-flex rounded-lg bg-amber-900 px-3 py-2 text-xs font-bold text-white"
                >
                  {language === 'zh' ? '檢視指定範例 PDF' : 'View designated PDF'}
                </button>

                <a
                  href={getPdfUrl(sample.fileUrl)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => onDownload?.('Designated Sample')}
                  className="rounded-lg border border-amber-500 bg-white px-3 py-2 text-xs font-bold text-amber-950"
                >
                  {language === 'zh' ? '開啟 / 下載 PDF' : 'Open / download PDF'}
                </a>
              </div>
            )}
          </div>
        </article>
      ))}

      {openedPdf && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Designated sample PDF"
          className="fixed inset-0 z-[120] flex flex-col bg-slate-950 p-3"
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setOpenedPdf(null);
            }
          }}
        >
          <div className="flex items-center justify-between gap-3 rounded-t-lg bg-amber-900 p-3 text-white">
            <div className="text-sm font-bold">
              ★ {language === 'zh' ? '指定範例' : 'Designated Sample'}
              {' — '}{openedPdf.title}
            </div>

            <button
              type="button"
              autoFocus
              onClick={() => setOpenedPdf(null)}
              className="rounded bg-white px-3 py-2 text-sm font-bold text-amber-950"
            >
              {language === 'zh' ? '關閉' : 'Close'}
            </button>
          </div>

          <div className="relative flex-1 min-h-0 bg-slate-200">
            <PdfViewer fileUrl={getPdfUrl(openedPdf.fileUrl)} />
          </div>
        </div>
      )}
    </>
  );
}