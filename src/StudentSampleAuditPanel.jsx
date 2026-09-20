import React, { useEffect, useRef, useState } from 'react';
import { collection, getDocsFromServer } from 'firebase/firestore';
import { auth, db } from './firebase.js';

const OWNER_EMAIL = 'clng@ktls.edu.hk';

const isObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeText = value =>
  String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const normalizeLabel = value =>
  String(value ?? '').trim().toLowerCase().replace(/[\s()]/g, '');

const readNumber = value => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const text = String(value).trim();

  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;

  const number = Number(text);
  return Number.isFinite(number) ? number : null;
};

const readColumns = value => {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value !== 'string' && typeof value !== 'number') return [];

  return String(value).split('/').map(readNumber);
};

const hasPositiveMark = value =>
  readColumns(value).some(number => number !== null && number > 0);

const hasRecordedValue = value =>
  value !== undefined &&
  value !== null &&
  String(value).trim() !== '';

function auditSample(sample, archives, expectedEssays) {
  const issues = [];
  const add = (tag, reason) => issues.push({ tag, reason });

  const data = isObject(sample.scoresData) ? sample.scoresData : {};
  const listedTags = Array.isArray(sample.questionTags)
    ? sample.questionTags.filter(tag => typeof tag === 'string')
    : [];

  const tags = [...new Set([...listedTags, ...Object.keys(data)])];
  const positiveEssaysByYear = new Map();

  let checkedQuestions = 0;
  let unmatchedDbqs = 0;
  let skippedTags = 0;

  const registerEssay = (year, number) => {
    if (!positiveEssaysByYear.has(year)) {
      positiveEssaysByYear.set(year, new Set());
    }
    positiveEssaysByYear.get(year).add(Number(number));
  };

  if (!isObject(sample.scoresData)) {
    add('Sample', 'Missing or invalid scoresData object.');
  }

  if (new Set(listedTags).size !== listedTags.length) {
    add('Sample', 'The questionTags list contains duplicate tags.');
  }

  for (const tag of tags) {
    // Modern format: 2024D Q1 or 2024E Q3.
    const individual = String(tag).trim()
      .match(/^(\d{4})([DE])\s+Q([1-9]\d*)$/i);

    // Legacy grouped essay format: 2024E.
    const groupedEssay = String(tag).trim().match(/^(\d{4})E$/i);

    if (!individual && !groupedEssay) {
      skippedTags++;
      continue;
    }

    checkedQuestions++;

    if (!isObject(data[tag])) {
      add(tag, 'This question tag has no valid saved score record.');
      continue;
    }

    const row = data[tag];
    const subMarks = isObject(row.subMarks) ? row.subMarks : {};

    if (
      row.subMarks !== undefined &&
      row.subMarks !== null &&
      !isObject(row.subMarks)
    ) {
      add(tag, 'Component marks are not stored as a valid object.');
    }

    const year = individual ? individual[1] : groupedEssay[1];

    if (
      /^\d{4}$/.test(String(sample.year ?? '')) &&
      String(sample.year) !== year
    ) {
      add(tag, `Question year differs from sample year ${sample.year}.`);
    }

    if (individual) {
      const officialTotal = readNumber(row.mark);

      if (officialTotal === null) {
        add(
          tag,
          'Official question total is blank or is not one non-negative number. ' +
          'Do not replace it with summed components or slash-separated marker totals.'
        );
      }

      if (row.panelId) {
        const expectedPanel =
          `${individual[2].toUpperCase() === 'D' ? '1' : '2'}` +
          individual[3].padStart(2, '0');

        if (String(row.panelId) !== expectedPanel) {
          add(
            tag,
            `Saved panel ${row.panelId} does not match expected panel ${expectedPanel}.`
          );
        }
      }

      if (!listedTags.includes(tag)) {
        add(
          tag,
          'This score exists in scoresData but is missing from questionTags. ' +
          'The normal sample list/editor may omit it.'
        );
      }
    }

    if (groupedEssay) {
      const entries = Object.entries(subMarks);

      if (entries.length === 0) {
        add(
          tag,
          'Legacy grouped essay record has no question-level component scores. ' +
          'The number of positively scored essays cannot be checked.'
        );
      }

      for (const [label, value] of entries) {
        const question = String(label).trim().match(/^(?:Q\s*)?([1-9]\d*)$/i);

        if (!question) {
          if (hasRecordedValue(value)) {
            add(
              tag,
              `Legacy essay component "${label}" is not an identifiable essay number.`
            );
          }
          continue;
        }

        if (hasPositiveMark(value)) {
          registerEssay(year, question[1]);
        }
      }

      continue;
    }

    const isEssay = individual[2].toUpperCase() === 'E';

    if (isEssay) {
      const componentEvidence =
        Object.values(subMarks).some(hasPositiveMark);

      if (
        hasPositiveMark(row.mark) ||
        hasPositiveMark(row.markerMarks) ||
        componentEvidence
      ) {
        registerEssay(year, individual[3]);
      }

      const recordedComponents = Object.entries(subMarks)
        .filter(([, value]) => hasRecordedValue(value));

      if (recordedComponents.length > 0) {
        add(
          tag,
          `This individual essay contains ${recordedComponents.length} saved ` +
          `component field(s): ${recordedComponents.map(([label]) => label).join(', ')}. ` +
          'Your current importer stores one essay per question record, with ' +
          'marker scores separately. Check for old whole-paper paste data.'
        );
      }

      const essayColumns = readColumns(row.markerMarks);

      if (
        hasRecordedValue(row.markerMarks) &&
        (essayColumns.length === 0 || essayColumns.some(value => value === null))
      ) {
        add(tag, 'Some essay marker scores are blank, unreadable or non-numeric.');
      }

      if (
        Array.isArray(row.markerLabels) &&
        row.markerLabels.length > 0 &&
        row.markerLabels.length !== essayColumns.length
      ) {
        add(
          tag,
          'The number of essay marker headings does not match the number of marker scores.'
        );
      }

      if (
        readNumber(row.mark) === 0 &&
        (hasPositiveMark(row.markerMarks) || componentEvidence)
      ) {
        add(
          tag,
          'Official total is zero but positive marking evidence is saved. ' +
          'Check the original summary; this is not automatically an error.'
        );
      }

      continue;
    }

    // DBQ checks.
    const components = Object.entries(subMarks).map(([label, value]) => ({
      label,
      key: normalizeLabel(label),
      value,
      columns: readColumns(value)
    }));

    if (components.length === 0) {
      add(tag, 'No DBQ component marks are saved; component checks were unavailable.');
      continue;
    }

    const keys = components.map(component => component.key);

    if (new Set(keys).size !== keys.length) {
      add(tag, 'Equivalent component labels appear more than once, such as b(i) and bi.');
    }

    const widths = new Set(
      components.filter(component => component.columns.length > 0)
        .map(component => component.columns.length)
    );

    if (widths.size > 1) {
      add(
        tag,
        'DBQ components have different numbers of slash-separated marker values. ' +
        'Marker positions may have been independently collapsed or misaligned.'
      );
    }

    if (components.some(component =>
      component.columns.length === 0 ||
      component.columns.some(value => value === null)
    )) {
      add(
        tag,
        'Some DBQ component marks are missing or unreadable. ' +
        'Blank values and ? are unknown, not zero.'
      );
    }

    if (
      Array.isArray(row.markerLabels) &&
      row.markerLabels.length > 0 &&
      components.some(component =>
        component.columns.length !== row.markerLabels.length
      )
    ) {
      add(tag, 'DBQ component lengths do not match the saved marker headings.');
    }

    // Only exact whole-question title matches are used for mark limits.
    // Never use startsWith(), which can confuse Q1 with Q10 or another DBQ.
    const matches = archives.filter(archive =>
      archive.paperType === 'Paper 1 (DBQ)' &&
      normalizeText(archive.title) === normalizeText(tag)
    );

    if (matches.length === 1 && Array.isArray(matches[0].subQuestions)) {
      const archiveComponents = matches[0].subQuestions;
      const expectedLabels = new Set(
        archiveComponents.map(component => normalizeLabel(component.label))
      );

      const extra = components.filter(component =>
        !expectedLabels.has(component.key)
      );

      const missing = [...expectedLabels].filter(key => !keys.includes(key));

      if (extra.length || missing.length) {
        add(
          tag,
          'Component labels differ from the exact matching question-bank record.' +
          (extra.length
            ? ` Extra: ${extra.map(component => component.label).join(', ')}.`
            : '') +
          (missing.length ? ` Missing: ${missing.join(', ')}.` : '')
        );
      }

      for (const component of components) {
        const allocationMatches = archiveComponents.filter(archiveComponent =>
          normalizeLabel(archiveComponent.label) === component.key
        );

        if (allocationMatches.length !== 1) continue;

        const maximum = readNumber(allocationMatches[0].marks);
        if (maximum === null) continue;

        const excessive = component.columns.filter(value =>
          value !== null && value > maximum
        );

        if (excessive.length) {
          add(
            tag,
            `${component.label} has score(s) ${excessive.join(', ')} above ` +
            `the saved question-bank allocation ${maximum}. ` +
            'Verify both the sample and the question-bank allocation.'
          );
        }
      }
    } else {
      unmatchedDbqs++;
    }

    // A warning heuristic for simple a/b/c-style components.
    // Nested components are not summed or treated as whole long questions.
    const simple = components.every(component => /^[a-z]$/.test(component.key));
    const aligned = widths.size === 1 && components.every(component =>
      component.columns.length > 0
    );

    if (simple && aligned && components.length >= 2) {
      const ordered = [...components].sort((a, b) =>
        a.key.localeCompare(b.key)
      );

      const last = ordered[ordered.length - 1];
      const suspicious = [];

      for (let column = 0; column < last.columns.length; column++) {
        const values = ordered.map(component => component.columns[column]);

        if (values.some(value => value === null)) continue;

        const earlierHighest = Math.max(...values.slice(0, -1));
        const finalValue = values[values.length - 1];

        if (earlierHighest >= 6 && finalValue < earlierHighest) {
          const heading = row.markerLabels?.[column] || `Column ${column + 1}`;
          suspicious.push(
            `${heading}: ` +
            ordered.map((component, index) =>
              `${component.label}=${values[index]}`
            ).join(', ')
          );
        }
      }

      if (suspicious.length) {
        add(
          tag,
          'Possible misplaced DBQ marks: an earlier component scored at least 6 ' +
          'while the final component scored less. ' +
          suspicious.join(' | ') +
          '. A student can legitimately score less on the final question; ' +
          'check the PDF before changing anything.'
        );
      }
    }
  }

  for (const [year, numbers] of positiveEssaysByYear) {
    if (numbers.size > expectedEssays) {
      add(
        `${year}E`,
        `${numbers.size} different essay questions have positive score evidence: ` +
        [...numbers].sort((a, b) => a - b).map(number => `Q${number}`).join(', ') +
        `. Your selected review threshold is ${expectedEssays}. ` +
        'Zero-only records were not counted. Check for whole-paper marks ' +
        'mistakenly attached to one candidate or one essay.'
      );
    }
  }

  return { issues, checkedQuestions, unmatchedDbqs, skippedTags };
}

export default function StudentSampleAuditPanel({
  allowed,
  disabled = false,
  onEdit
}) {
  const [expectedEssays, setExpectedEssays] = useState(2);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');

  const mounted = useRef(false);
  const running = useRef(false);
  const latestAllowed = useRef(allowed);
  latestAllowed.current = allowed;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const runCheck = async () => {
    if (!allowed || disabled || running.current) return;

    const actualUser = auth.currentUser;

    if (
      !actualUser?.emailVerified ||
      normalizeText(actualUser.email) !== OWNER_EMAIL
    ) {
      setError('Use the real verified superadmin account.');
      return;
    }

    running.current = true;
    setBusy(true);
    setReport(null);
    setError('');

    try {
      const [sampleSnapshot, archiveSnapshot] = await Promise.all([
        getDocsFromServer(collection(db, 'student_samples')),
        getDocsFromServer(collection(db, 'archives'))
      ]);

      if (
        !mounted.current ||
        !latestAllowed.current ||
        auth.currentUser?.uid !== actualUser.uid
      ) return;

      const samples = sampleSnapshot.docs.map(snapshot => ({
        ...snapshot.data(),
        id: snapshot.id
      }));

      const archives = archiveSnapshot.docs.map(snapshot => ({
        ...snapshot.data(),
        id: snapshot.id
      }));

      const results = samples.map(sample => ({
        sample,
        ...auditSample(sample, archives, expectedEssays)
      }));

      setReport({
        checkedAt: new Date().toLocaleString(),
        sampleCount: samples.length,
        checkedQuestions: results.reduce(
          (sum, result) => sum + result.checkedQuestions, 0
        ),
        unmatchedDbqs: results.reduce(
          (sum, result) => sum + result.unmatchedDbqs, 0
        ),
        skippedTags: results.reduce(
          (sum, result) => sum + result.skippedTags, 0
        ),
        flagged: results.filter(result => result.issues.length > 0)
      });
    } catch (failure) {
      if (mounted.current) {
        setError(
          'The scan did not complete. No records were changed. ' +
          (failure.message || 'Could not read the database.')
        );
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  if (!allowed) return null;

  return (
    <section className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
      <h3 className="text-sm font-bold text-amber-950">
        Superadmin — sample marks review
      </h3>

      <p className="text-xs text-amber-900">
        Read-only database check. No Poe request, PDF inspection, automatic
        correction or email. Warnings identify records to review, not proven errors.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-slate-700">
          Flag more than this many positively scored essays per candidate/year:
          <select
            value={expectedEssays}
            disabled={busy || disabled}
            onChange={event => {
              setExpectedEssays(Number(event.target.value));
              setReport(null);
            }}
            className="ml-2 rounded border border-amber-300 bg-white p-2"
          >
            {[1, 2, 3, 4, 5, 6, 7].map(number => (
              <option key={number} value={number}>{number}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={busy || disabled}
          onClick={runCheck}
          className="rounded-lg bg-amber-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          {busy ? 'Checking saved records…' : 'Check sample marks'}
        </button>
      </div>

      <p className="text-xs text-slate-600">
        Zero-only essays are excluded; blanks remain unknown. Fewer than the
        selected number is not flagged because a saved sample may be partial.
        Multiple marker columns do not count as multiple essays.
      </p>

      {error && (
        <p role="alert" className="text-xs text-red-800 whitespace-pre-wrap">
          {error}
        </p>
      )}

      {report && (
        <div className="space-y-3">
          <div role="status" className="text-xs text-slate-800 space-y-1">
            <p>
              Checked {report.sampleCount} sample documents and{' '}
              {report.checkedQuestions} recognized DSE score records.
              {' '}Flagged samples: <strong>{report.flagged.length}</strong>.
            </p>
            <p>Snapshot taken: {report.checkedAt}. Rerun after editing.</p>
            <p>
              DBQs without an unambiguous exact-title question-bank match:
              {' '}{report.unmatchedDbqs}. Their allocation-limit checks were skipped.
            </p>
            <p>
              Custom/unrecognized tags skipped: {report.skippedTags}.
              Nested DBQ parts are not included in the final-component
              ordering heuristic.
            </p>
          </div>

          {report.flagged.length === 0 ? (
            <p className="rounded-lg bg-white p-3 text-xs text-green-800">
              No warnings from these checks. This does not verify the PDFs,
              page ranges or completeness of the extraction.
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-3">
              {report.flagged.map(({ sample, issues }) => (
                <div
                  key={sample.id}
                  className="rounded-lg border border-amber-200 bg-white p-3 space-y-2"
                >
                  <div className="text-xs font-bold text-slate-800">
                    {String(sample.year ?? '')} — {String(sample.language ?? '')}
                    {' '}— Grade {String(sample.overallGrade ?? '')}
                  </div>

                  <div className="text-xs text-slate-500 break-all">
                    Sample ID: {sample.id}
                  </div>

                  <ul className="list-disc pl-5 space-y-2 text-xs text-slate-700">
                    {issues.map((issue, index) => (
                      <li key={index}>
                        <strong>{issue.tag}:</strong> {issue.reason}
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    disabled={busy || disabled}
                    onClick={() => onEdit(sample)}
                    className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 disabled:opacity-50"
                  >
                    Edit this sample
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}