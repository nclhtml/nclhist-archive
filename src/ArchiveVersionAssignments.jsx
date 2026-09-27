import React, { useEffect, useState } from 'react';
import {
  doc,
  getDocFromServer,
  runTransaction
} from 'firebase/firestore';

import { db } from './firebase.js';
import { useAuth } from './main.jsx';
import { loadAccessibleArchives } from './archiveAccessClient.js';
import { loadClassAssessments } from './dashboardData.js';
import { getArchiveVersionLabel } from './archiveWriteSafety.js';

function resolveLink(archives, link) {
  const parent = archives.find(item => item.id === link);
  if (parent) return { parent, child: null };

  for (const item of archives) {
    const child = (item.subQuestions || []).find(
      sub => `${item.id}_${sub.id}` === link
    );

    if (child) return { parent: item, child };
  }

  return null;
}

function getLink(assessment, target) {
  if (!assessment) return '';

  if (target === 'main') return assessment.linkedDocId || '';

  const index = Number(target.slice('section:'.length));
  return assessment.sectionsConfig?.[index]?.linkedDocId || '';
}

export default function ArchiveVersionAssignments() {
  const { user, impersonatedEmail } = useAuth();

  const [classes, setClasses] = useState([]);
  const [className, setClassName] = useState('');
  const [assessments, setAssessments] = useState([]);
  const [archives, setArchives] = useState([]);
  const [assessmentId, setAssessmentId] = useState('');
  const [target, setTarget] = useState('main');
  const [link, setLink] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);

  const permitted = Boolean(
    user?.isAdmin &&
    user?.isAuthorized &&
    !impersonatedEmail
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!permitted) return;

      try {
        const snapshot = await getDocFromServer(
          doc(db, 'settings', 'classes')
        );

        const email = user.email.toLowerCase().trim();
        const owner = email === 'clng@ktls.edu.hk';

        const list = (snapshot.data()?.list || [])
          .map(item => typeof item === 'string'
            ? {
              name: item,
              owner: 'clng@ktls.edu.hk',
              isArchived: false
            }
            : item
          )
          .filter(item =>
            item &&
            typeof item.name === 'string' &&
            !item.isArchived &&
            (owner || item.owner === email)
          );

        if (cancelled) return;

        const names = [...new Set(list.map(item => item.name))];
        setClasses(names);

        const requested = new URLSearchParams(
          window.location.search
        ).get('class');

        setClassName(names.includes(requested) ? requested : (names[0] || ''));
      } catch (error) {
        if (!cancelled) setMessage(error.message);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [permitted, user?.email]);

  useEffect(() => {
    let cancelled = false;

    setAssessmentId('');
    setAssessments([]);
    setArchives([]);
    setTarget('main');
    setLink('');

    if (!permitted || !className) return;

    const load = async () => {
      setBusy(true);

      try {
        const [items, documents] = await Promise.all([
          loadClassAssessments(className),
          loadAccessibleArchives({ effectiveEmail: user.email })
        ]);

        if (cancelled) return;

        setAssessments(items.sort((a, b) =>
          String(a.name || '').localeCompare(
            String(b.name || ''),
            undefined,
            { numeric: true }
          )
        ));

        setArchives(documents);
      } catch (error) {
        if (!cancelled) setMessage(error.message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [permitted, className, user?.email, reload]);

  const assessment = assessments.find(item => item.id === assessmentId);
  const resolved = resolveLink(archives, link);
  const savedLink = getLink(assessment, target);

  const selectAssessment = id => {
    const selected = assessments.find(item => item.id === id);
    setAssessmentId(id);
    setTarget('main');
    setLink(selected?.linkedDocId || '');
    setMessage('');
  };

  const selectTarget = value => {
    setTarget(value);
    setLink(getLink(assessment, value));
    setMessage('');
  };

  const save = async () => {
    if (!permitted || busy || !assessment) return;

    if (link && !resolved) {
      setMessage('Select an existing question record or remove the link.');
      return;
    }

    const description = resolved
      ? `${resolved.parent.title}\n` +
        `Version: ${getArchiveVersionLabel(resolved.parent)}\n` +
        (
          resolved.child
            ? `Part: ${resolved.child.label}`
            : 'Access: whole question record'
        )
      : 'No linked document';

    if (!window.confirm(
      `Change this assessment link?\n\n` +
      `Class: ${className.replace(/\u200B/g, '')}\n` +
      `Assessment: ${assessment.name}\n\n` +
      description +
      '\n\nMarks and other assessment fields will not be changed.'
    )) return;

    setBusy(true);
    setMessage('');

    try {
      const updated = await runTransaction(db, async transaction => {
        const assessmentRef = doc(db, 'assessments', assessment.id);
        const currentSnap = await transaction.get(assessmentRef);

        if (!currentSnap.exists()) {
          throw new Error('This assessment was deleted. Reload the panel.');
        }

        const current = currentSnap.data();

        if (
          !(current.classes || []).includes(className) &&
          current.className !== className
        ) {
          throw new Error('The assessment no longer belongs to this class.');
        }

        if (getLink(current, target) !== savedLink) {
          throw new Error(
            'Another editor changed this link. Reload the panel before saving.'
          );
        }

        if (resolved) {
          const archiveSnap = await transaction.get(
            doc(db, 'archives', resolved.parent.id)
          );

          if (!archiveSnap.exists()) {
            throw new Error('The selected question record was deleted.');
          }

          const currentArchive = archiveSnap.data();

          if (
            (currentArchive.versionId || '') !==
            (resolved.parent.versionId || '')
          ) {
            throw new Error('The selected version changed. Reload the panel.');
          }

          if (
            resolved.child &&
            !(currentArchive.subQuestions || []).some(
              sub => String(sub.id) === String(resolved.child.id)
            )
          ) {
            throw new Error('The selected question part was removed.');
          }
        }

        let patch;

        if (target === 'main') {
          patch = { linkedDocId: link };
        } else {
          const index = Number(target.slice('section:'.length));
          const oldSection = assessment.sectionsConfig?.[index];
          const currentSection = current.sectionsConfig?.[index];

          if (
            !oldSection ||
            !currentSection ||
            oldSection.id !== currentSection.id
          ) {
            throw new Error(
              'The assessment sections changed. Reload the panel.'
            );
          }

          patch = {
            sectionsConfig: current.sectionsConfig.map((section, i) =>
              i === index
                ? { ...section, linkedDocId: link }
                : section
            )
          };
        }

        transaction.update(assessmentRef, patch);

        return {
          ...current,
          ...patch,
          id: assessment.id
        };
      });

      setAssessments(previous => previous.map(item =>
        item.id === updated.id ? updated : item
      ));

      setMessage(
        'Link saved. Refresh the Marks table below and any open student ' +
        'dashboard/search tabs to load the new assignment.'
      );
    } catch (error) {
      setMessage(`Link not saved: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!permitted) return null;

  const selectedId = resolved?.parent.id || '';

  const visibleArchives = archives
    .filter(item =>
      item.id === selectedId ||
      !search.trim() ||
      `${item.title} ${item.year} ${item.versionLabel || ''} ${item.origin}`
        .toLowerCase()
        .includes(search.toLowerCase().trim())
    )
    .sort((a, b) =>
      String(a.title).localeCompare(
        String(b.title),
        undefined,
        { numeric: true }
      ) ||
      Number(b.year) - Number(a.year) ||
      getArchiveVersionLabel(a).localeCompare(getArchiveVersionLabel(b))
    );

  return (
    <section className="m-3 md:m-6 rounded-xl border-2 border-indigo-300 bg-indigo-50 p-4">
      <details>
        <summary className="cursor-pointer font-bold text-indigo-950">
          Document Version Linking — choose the exact version assigned to a class
        </summary>

        <div className="mt-4 space-y-4">
          <p className="text-sm text-indigo-900">
            Existing links are retained unless you explicitly save a change here.
            Use this panel for versioned exercises. For a multi-section assessment,
            select the appropriate section rather than its main link.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm font-bold">
              Class
              <select
                disabled={busy}
                value={className}
                onChange={event => setClassName(event.target.value)}
                className="mt-1 w-full rounded border bg-white p-2"
              >
                <option value="">-- Select class --</option>
                {classes.map(name => (
                  <option key={name} value={name}>
                    {name.replace(/\u200B/g, '')}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-bold">
              Existing assessment
              <select
                disabled={busy}
                value={assessmentId}
                onChange={event => selectAssessment(event.target.value)}
                className="mt-1 w-full rounded border bg-white p-2"
              >
                <option value="">-- Select assessment --</option>
                {assessments.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} — {item.term || ''} — {item.date || ''}
                  </option>
                ))}
              </select>
            </label>

            {assessment && (
              <label className="text-sm font-bold">
                Link to change
                <select
                  disabled={busy}
                  value={target}
                  onChange={event => selectTarget(event.target.value)}
                  className="mt-1 w-full rounded border bg-white p-2"
                >
                  <option value="main">Main assessment link</option>
                  {(assessment.sectionsConfig || []).map((section, index) => (
                    <option key={index} value={`section:${index}`}>
                      Section: {section.name || index + 1}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {assessment && (
            <>
              <input
                type="search"
                value={search}
                disabled={busy}
                onChange={event => setSearch(event.target.value)}
                placeholder="Find title, year or version label…"
                className="w-full rounded border bg-white p-2 text-sm"
              />

              <label className="block text-sm font-bold">
                Question record and version
                <select
                  disabled={busy}
                  value={selectedId}
                  onChange={event => setLink(event.target.value)}
                  className="mt-1 w-full rounded border bg-white p-2"
                >
                  <option value="">-- No linked document --</option>
                  {visibleArchives.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.title} — {getArchiveVersionLabel(item)} — {item.origin}
                    </option>
                  ))}
                </select>
              </label>

              {resolved && (
                <label className="block text-sm font-bold">
                  Whole record or one question part
                  <select
                    disabled={busy}
                    value={link}
                    onChange={event => setLink(event.target.value)}
                    className="mt-1 w-full rounded border bg-white p-2"
                  >
                    <option value={resolved.parent.id}>
                      Whole record — all its questions and attached PDFs
                    </option>
                    {(resolved.parent.subQuestions || []).map(sub => (
                      <option
                        key={sub.id}
                        value={`${resolved.parent.id}_${sub.id}`}
                      >
                        Part {sub.label} only
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <p className="text-xs text-indigo-900">
                Selecting a different record/version resets the selection to its
                whole record. Choose the required part again before saving.
                Part-only access does not include a whole-record PDF that may
                contain other questions.
              </p>

              {savedLink && !resolveLink(archives, savedLink) && (
                <p className="text-sm text-amber-800">
                  The existing link is not in the current catalogue: {savedLink}.
                  It has not been changed.
                </p>
              )}

              <button
                type="button"
                disabled={busy || link === savedLink}
                onClick={save}
                className="rounded bg-indigo-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
              >
                {busy ? 'Working…' : 'Save this document/version link'}
              </button>
            </>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setMessage('');
              setReload(value => value + 1);
            }}
            className="ml-3 text-sm font-bold text-indigo-800 underline disabled:opacity-40"
          >
            Reload panel data
          </button>

          {message && (
            <p role="status" className="rounded border bg-white p-3 text-sm whitespace-pre-wrap">
              {message}
            </p>
          )}
        </div>
      </details>
    </section>
  );
}