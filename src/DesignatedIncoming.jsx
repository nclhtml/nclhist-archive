import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react';

import { getFunctions, httpsCallable } from 'firebase/functions';

import {
  Eye,
  Download,
  Link as LinkIcon,
  ExternalLink,
  RefreshCw,
  ChevronUp,
  ChevronDown
} from 'lucide-react';

import { auth } from './firebase.js';
import { useAuth } from './main.jsx';

import { DesignatedDocumentLinker } from './DesignatedItemTools.jsx';
import { DesignatedPdfUploadButton } from './DesignatedCompactFiles.jsx';

import {
  createDesignatedRowComponents
} from './DesignatedRows.jsx';

import {
  useDesignatedLocalFlag
} from './DesignatedBrowserState.jsx';

import {
  downloadAppearanceDocx,
  downloadDesignatedCategoryZip,
  resolveDesignatedLink
} from './designatedWordExport.js';

const api = httpsCallable(
  getFunctions(auth.app, 'us-central1'),
  'designatedIncoming',
  { timeout: 120000 }
);

const Context = createContext(null);

const correctedRows = createDesignatedRowComponents(
  Context,
  DesignatedCategoryControls
);

const AssessmentRow = correctedRows.AssessmentRow;
const ClassList = correctedRows.ClassList;

export const DesignatedBoundCopies = correctedRows.BoundCopies;
export const DesignatedCategoryFrame = correctedRows.CategoryFrame;

const iconClass =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center ' +
  'rounded border border-slate-200 bg-white text-slate-600 ' +
  'hover:bg-blue-50 hover:text-blue-700 disabled:opacity-30';

const textButton =
  'rounded border border-slate-200 bg-white px-2 py-1 ' +
  'text-[11px] font-bold text-slate-600 disabled:opacity-30';

function IconButton({ title, children, ...props }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={iconClass}
      {...props}
    >
      {children}
    </button>
  );
}

function sortedRecords(values) {
  return [...values].sort((a, b) =>
    Number(a.order) - Number(b.order) ||
    String(a.key || a.id).localeCompare(String(b.key || b.id))
  );
}

export function DesignatedIncomingProvider({
  data,
  archives,
  onCommonChanged,
  children
}) {
  const { user } = useAuth();

  const [storedSnapshot, setStoredSnapshot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState(null);

  const identity = JSON.stringify([
    user?.email || '',
    data?.level || ''
  ]);

  const live = useRef({});
  const lock = useRef(false);
  const requestSequence = useRef(0);

  const snapshot = storedSnapshot?.identity === identity
    ? storedSnapshot.value
    : null;

  live.current = {
    identity,
    data,
    user,
    snapshot,
    onCommonChanged
  };

  const perform = useCallback(async (
    action = 'load',
    values = {}
  ) => {
    const current = live.current;

    if (
      lock.current ||
      !current.data?.level ||
      !current.data?.levels?.length
    ) return null;

    const requestIdentity = current.identity;
    const sequence = ++requestSequence.current;

    lock.current = true;
    setBusy(true);
    setError('');

    try {
      const response = await api({
        action,
        level: current.data.level,
        revision: current.snapshot?.revision || 0,
        groupRevision:
          current.snapshot?.groupRevision ??
          current.data.revision,
        ...values
      });

      if (
        live.current.identity !== requestIdentity ||
        sequence !== requestSequence.current
      ) return null;

      setStoredSnapshot({
        identity: requestIdentity,
        value: response.data
      });

      return response.data;
    } catch (failure) {
      if (live.current.identity === requestIdentity) {
        setError(
          failure.message ||
          'Could not load designated class assessments.'
        );
      }

      return null;
    } finally {
      lock.current = false;

      if (live.current.identity === requestIdentity) {
        setBusy(false);
      }
    }
  }, []);

  // Load on entering/changing level, or after an actual common-list save.
  // There is deliberately no polling, focus refresh or assessment listener.
  const sourceSignature = JSON.stringify([
    identity,
    data?.revision ?? null,
    data?.config || null
  ]);

  useEffect(() => {
    setTarget(null);

    let cancelled = false;
    let timer;

    const loadWhenIdle = () => {
      if (cancelled) return;

      if (lock.current) {
        timer = window.setTimeout(loadWhenIdle, 150);
        return;
      }

      perform('load');
    };

    loadWhenIdle();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sourceSignature, perform]);

  const refresh = async () => {
    if (lock.current) return;

    const result = await perform('load');

    if (result) {
      setMessage('Class assessments refreshed.');
      window.dispatchEvent(
        new Event('designated-refresh-archives')
      );
    }
  };

  const downloadOne = async (url, name) => {
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setError('');

    try {
      await downloadAppearanceDocx(url, name, setMessage);
      setMessage('Word download prepared.');
    } catch (failure) {
      setError(failure.message || 'Download failed.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const exportZip = async (bucket, label) => {
    if (lock.current) return;

    const current = await perform('load');
    if (!current) return;

    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('Preparing ZIP…');

    try {
      const missing = await downloadDesignatedCategoryZip({
        snapshot: current,
        bucket,
        label,
        email: live.current.user.email,
        onProgress: setMessage
      });

      setMessage(
        'ZIP prepared.' +
        (missing.length
          ? ` ${missing.length} missing-file notice(s) included.`
          : '')
      );
    } catch (failure) {
      setError(
        (failure.message || 'ZIP export failed.') +
        '\nNo Firebase files were changed.'
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <Context.Provider value={{
      snapshot,
      busy,
      perform,
      archives,
      exportZip,
      downloadOne,
      refresh,
      onCommonChanged,
      openLinker: record => setTarget(record),
      setMessage
    }}>
      {children}

      {(busy || error || message) && (
        <aside className="fixed bottom-3 right-3 z-[110] max-h-[25dvh] w-[min(92vw,420px)] overflow-auto rounded-lg border bg-white p-3 shadow-lg">
          {busy && (
            <p className="text-xs font-bold text-blue-700">
              Working… current lists remain visible.
            </p>
          )}

          {message && (
            <p role="status" className="mt-1 whitespace-pre-wrap text-xs text-slate-600">
              {message}
            </p>
          )}

          {error && (
            <p role="alert" className="mt-1 whitespace-pre-wrap text-xs text-red-700">
              {error}
            </p>
          )}

          {!busy && (
            <button
              type="button"
              className={`${textButton} mt-2`}
              onClick={() => {
                setError('');
                setMessage('');
              }}
            >
              Dismiss
            </button>
          )}
        </aside>
      )}

      {target && (
        <DesignatedDocumentLinker
          archives={archives}
          loading={busy}
          error=""
          selectedId={target.linkedDocId}
          onClose={() => setTarget(null)}
          onSelect={async selection => {
            const result = await perform('link', {
              key: target.key,
              expectedLink: target.linkedDocId || '',
              ...selection
            });

            if (result) {
              setTarget(null);

              setMessage(
                'Document linked to the original Marks assessment. ' +
                'Its name, marks and settings were kept.'
              );
            }
          }}
        />
      )}
    </Context.Provider>
  );
}

function MissingLinkButton({ record }) {
  const context = useContext(Context);

  if (!context || record.linkedDocId) return null;

  const canRepair =
    context.snapshot?.owner ||
    record.uploadAllowed === true;

  return (
    <button
      type="button"
      disabled={context.busy || !canRepair}
      title={
        canRepair
          ? 'Select the missing question-set document'
          : 'Only the class owner or superadmin can add this link'
      }
      onClick={event => {
        event.stopPropagation();

        if (canRepair) context.openLinker(record);
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-300 bg-amber-100 px-1.5 py-1 text-[10px] font-bold text-amber-950 disabled:opacity-60"
    >
      <LinkIcon size={11} />
      No link
      {canRepair ? ' · Add' : ''}
    </button>
  );
}

function LegacyAssessmentRow({ record, orderControls = null }) {
  const context = useContext(Context);

  const { snapshot, archives, busy, openLinker, downloadOne } = context;

  const [expanded, setExpanded] = useDesignatedLocalFlag(
    JSON.stringify([
      snapshot.level,
      'assessment',
      record.key
    ]),
    false
  );

  const language = snapshot.languages[record.className];

  const resolved = resolveDesignatedLink(
    archives,
    record.linkedDocId
  );

  const url = resolved
    ? language === 'zh'
      ? resolved.parent.fileUrlChi
      : language === 'en'
        ? resolved.parent.fileUrl
        : ''
    : '';

  const missing = !record.linkedDocId;

  return (
    <article
      draggable={Boolean(snapshot.owner && !busy && !record.commonId)}
      onDragStart={event => {
        if (!snapshot.owner || busy || record.commonId) {
          event.preventDefault();
          return;
        }

        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(
          'application/x-designated-assessment',
          record.key
        );
      }}
      className={`rounded-md border ${
        missing
          ? 'border-amber-300 bg-amber-50'
          : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-start gap-1.5 p-2">
        <button
          type="button"
          title={expanded ? 'Hide item details' : 'Show item details'}
          aria-label={expanded ? 'Hide item details' : 'Show item details'}
          aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}
          className="shrink-0 pt-0.5 text-[10px] text-slate-500"
        >
          {expanded ? '▾' : '▸'}
        </button>

        <p className="min-w-0 flex-1 break-words text-xs font-semibold text-slate-800">
          {record.name}
        </p>

        {missing ? (
          <MissingLinkButton record={record} />
        ) : url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            title="View linked PDF"
            aria-label="View linked PDF"
            className="shrink-0 text-slate-500 hover:text-blue-700"
          >
            <Eye size={14} />
          </a>
        ) : (
          <span
            title={
              resolved
                ? 'The class-language PDF is missing'
                : 'The saved link is not in the loaded archive catalogue'
            }
            className="shrink-0 rounded bg-amber-100 px-1 text-[9px] text-amber-900"
          >
            {resolved ? 'PDF missing' : 'Check link'}
          </span>
        )}
      </div>

      <div hidden={!expanded} className="border-t border-slate-100 px-2 pb-2 pt-1">
        <p className="text-[10px] text-slate-400">
          {record.term}
          {record.date ? ` · ${record.date}` : ''}
          {record.pending ? ' · Configuration required' : ''}
        </p>

        <p className="mt-1 break-words text-[10px] text-slate-500">
          {resolved
            ? `${resolved.parent.title}${
                resolved.child ? ` Q${resolved.child.label}` : ''
              }`
            : record.linkedDocId
              ? 'Saved link unavailable in this catalogue. Try Refresh.'
              : 'No question set has been linked.'}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-1">
          {orderControls}

          {snapshot.owner && record.linkedDocId && (
            <IconButton
              title="Change document"
              disabled={busy}
              onClick={() => openLinker(record)}
            >
              <LinkIcon size={13} />
            </IconButton>
          )}

          {url && (
            <>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                title="View PDF"
                aria-label="View PDF"
                className={iconClass}
              >
                <Eye size={13} />
              </a>

              <IconButton
                title="Download Word"
                disabled={busy}
                onClick={() => downloadOne(url, record.name)}
              >
                <Download size={13} />
              </IconButton>
            </>
          )}

          {resolved &&
            !url &&
            ['zh', 'en'].includes(language) && (
              <DesignatedPdfUploadButton
                archiveId={resolved.parent.id}
                language={language}
                allowed={record.uploadAllowed}
                disabled={busy}
              />
            )}

          {snapshot.owner && (
            <a
              href={`/marks?class=${encodeURIComponent(record.className)}`}
              target="_blank"
              rel="noreferrer"
              title="Open Marks"
              aria-label="Open Marks"
              className={iconClass}
            >
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function LegacyClassList({ className, records, bucket, category }) {
  const context = useContext(Context);

  const { snapshot, busy, perform } = context;

  const [expanded, setExpanded] = useDesignatedLocalFlag(
    JSON.stringify([
      snapshot.level,
      'class-list',
      bucket,
      category,
      className
    ]),
    false
  );

  const list = sortedRecords(records);
  const missing = list.filter(item => !item.linkedDocId).length;
  const language = snapshot.languages[className];

  return (
    <section className="min-w-0 rounded-md border border-slate-200 bg-white p-2">
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block break-words text-[11px] font-bold text-slate-700">
            {expanded ? '▾ ' : '▸ '}
            {className.replace(/\u200B/g, '')}
          </span>

          <span className="text-[10px] text-slate-400">
            {list.length} items
          </span>
        </button>

        {missing > 0 && (
          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-1 text-[10px] font-bold text-amber-900">
            {missing} unlinked
          </span>
        )}
      </div>

      <div hidden={!expanded} className="mt-2">
        <label className="text-[10px] text-slate-500">
          Class PDF language
          <select
            disabled={busy || !snapshot.owner}
            value={language || ''}
            onChange={event =>
              perform('language', {
                className,
                language: event.target.value
              })
            }
            className="mt-1 w-full rounded border bg-white p-1.5 text-xs"
          >
            <option value="" disabled>Select language</option>
            <option value="zh">CMI · 中文</option>
            <option value="en">EMI · English</option>
          </select>
        </label>
      </div>

      {/* Names remain visible even when this class list is collapsed. */}
      <div className="mt-2 space-y-1">
        {!list.length && (
          <p className="text-[11px] text-slate-400">No items.</p>
        )}

        {list.map((record, index) => (
          <AssessmentRow
            key={record.key}
            record={record}
            orderControls={snapshot.owner ? (
              <>
                <IconButton
                  title="Move up"
                  disabled={busy || index === 0}
                  onClick={() =>
                    perform('reorder', {
                      key: record.key,
                      direction: 'up'
                    })
                  }
                >
                  <ChevronUp size={13} />
                </IconButton>

                <IconButton
                  title="Move down"
                  disabled={busy || index === list.length - 1}
                  onClick={() =>
                    perform('reorder', {
                      key: record.key,
                      direction: 'down'
                    })
                  }
                >
                  <ChevronDown size={13} />
                </IconButton>
              </>
            ) : null}
          />
        ))}
      </div>
    </section>
  );
}

export function DesignatedClassColumns({ bucket, category }) {
  const context = useContext(Context);

  if (!context?.snapshot) {
    return <p className="mt-2 text-xs text-slate-400">Loading class items…</p>;
  }

  const { snapshot } = context;

  return (
    <section className="mt-3 border-t border-slate-200 pt-2">
      <h4 className="mb-2 text-[11px] font-bold text-slate-500">
        Class-specific · Marks
      </h4>

      <div className="grid gap-2 xl:grid-cols-2">
        {snapshot.classes.map(className => (
          <ClassList
            key={className}
            className={className}
            bucket={bucket}
            category={category}
            records={snapshot.records.filter(record =>
              record.className === className &&
              record.bucket === bucket &&
              record.category === category
            )}
          />
        ))}
      </div>
    </section>
  );
}

function LegacyDesignatedBoundCopies({ item }) {
  const context = useContext(Context);

  const level = context?.snapshot?.level || '';

  const [expanded, setExpanded] = useDesignatedLocalFlag(
    JSON.stringify([level, 'common-copies', item.id]),
    false
  );

  if (!context?.snapshot) return null;

  const { snapshot } = context;

  const copies = (snapshot.boundCopies || []).filter(
    record => record.commonId === item.id
  );

  if (!copies.length) return null;

  const missing = copies.filter(record => !record.linkedDocId).length;

  return (
    <section className="mt-2 rounded-md border border-yellow-200 bg-yellow-50 p-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
        className="flex w-full items-center gap-2 text-left text-[11px]"
      >
        <span className="flex-1 font-bold text-yellow-950">
          {expanded ? '▾' : '▸'} Class assessments
          {' '}{copies.length}/{snapshot.classes.length}
        </span>

        {missing > 0 && (
          <span className="rounded bg-amber-200 px-1.5 py-0.5 font-bold text-amber-950">
            {missing} unlinked
          </span>
        )}
      </button>

      <div className={`mt-2 grid gap-2 ${expanded ? 'xl:grid-cols-2' : ''}`}>
        {snapshot.classes.map(className => {
          const copy = copies.find(
            record => record.className === className
          );

          return (
            <div key={className} className="min-w-0">
              {expanded && (
                <p className="mb-1 break-words text-[10px] text-slate-500">
                  {className.replace(/\u200B/g, '')}
                </p>
              )}

              {copy ? (
                <AssessmentRow record={copy} />
              ) : expanded ? (
                <p className="text-[11px] text-slate-400">
                  No class assessment attached.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DesignatedCommonOrder({ item }) {
  const context = useContext(Context);

  if (!context?.snapshot?.owner) return null;

  const { snapshot, busy, perform, onCommonChanged } = context;

  const list = sortedRecords(snapshot.common.filter(value =>
    value.bucket === item.bucket &&
    value.category === item.category
  ));

  const index = list.findIndex(value => value.id === item.id);

  return (
    <span className="mt-1 inline-flex items-center gap-1">
      <span className="mr-1 text-[10px] text-amber-800">Common</span>

      {['up', 'down'].map(direction => (
        <IconButton
          key={direction}
          title={`Move common item ${direction}`}
          disabled={
            busy ||
            index < 0 ||
            (direction === 'up'
              ? index === 0
              : index === list.length - 1)
          }
          onClick={async () => {
            const result = await perform('commonOrder', {
              id: item.id,
              direction
            });

            if (result) await onCommonChanged?.();
          }}
        >
          {direction === 'up'
            ? <ChevronUp size={12} />
            : <ChevronDown size={12} />}
        </IconButton>
      ))}
    </span>
  );
}

export function DesignatedCommonDropTarget({ item }) {
  const context = useContext(Context);
  const [selectedKey, setSelectedKey] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const [expanded, setExpanded] = useDesignatedLocalFlag(
    JSON.stringify([
      context?.snapshot?.level || '',
      'attach-existing',
      item.id
    ]),
    false
  );

  if (!context?.snapshot?.owner) return null;

  const { snapshot, busy, perform, onCommonChanged, setMessage } = context;

  const attached = new Set(
    (snapshot.boundCopies || [])
      .filter(copy => copy.commonId === item.id)
      .map(copy => copy.className)
  );

  if (
    snapshot.classes.length &&
    snapshot.classes.every(name => attached.has(name))
  ) return null;

  const candidates = snapshot.records.filter(record =>
    !attached.has(record.className) &&
    record.bucket === item.bucket &&
    record.category === item.category
  );

  const attach = async key => {
    const record = candidates.find(value => value.key === key);
    if (!record || busy) return;

    if (!window.confirm(
      `Attach "${record.name}" to "${item.name}"?\n\n` +
      'Its name, marks and settings will be kept. ' +
      'An existing generated copy can be replaced only if it has no student data.'
    )) return;

    const result = await perform('adopt', {
      key,
      commonId: item.id
    });

    if (result) {
      setSelectedKey('');
      setMessage('Existing Marks assessment attached; name and marks preserved.');
      await onCommonChanged?.();
    }
  };

  return (
    <div
      onDragOver={event => {
        if (
          !busy &&
          Array.from(event.dataTransfer.types).includes(
            'application/x-designated-assessment'
          )
        ) {
          event.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={event => {
        event.preventDefault();
        setDragOver(false);

        attach(event.dataTransfer.getData(
          'application/x-designated-assessment'
        ));
      }}
      className={`mt-2 rounded border border-dashed px-2 py-1 ${
        dragOver
          ? 'border-indigo-500 bg-indigo-100'
          : 'border-slate-200'
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded(value => !value)}
        className="text-[10px] text-indigo-700"
      >
        {expanded ? '▾' : '▸'} Attach existing / drop here
      </button>

      <div hidden={!expanded} className="mt-2 flex gap-1">
        <select
          value={selectedKey}
          disabled={busy}
          onChange={event => setSelectedKey(event.target.value)}
          className="min-w-0 flex-1 rounded border p-1.5 text-xs"
        >
          <option value="">Select class assessment</option>

          {candidates.map(record => (
            <option key={record.key} value={record.key}>
              {record.className.replace(/\u200B/g, '')}
              {' — '}{record.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={busy || !selectedKey}
          className={textButton}
          onClick={() => attach(selectedKey)}
        >
          Attach
        </button>
      </div>
    </div>
  );
}

export function DesignatedCategoryControls({ bucket, label }) {
  const context = useContext(Context);

  if (!context?.snapshot) return null;

  const { snapshot, busy, perform, refresh, exportZip } = context;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="mr-auto flex items-center gap-1 text-[10px] text-slate-500">
        <input
          type="checkbox"
          disabled={busy || !snapshot.owner}
          checked={snapshot.closed[bucket] === true}
          onChange={event =>
            perform('stop', {
              bucket,
              closed: event.target.checked
            })
          }
        />
        Stop new Marks items
      </label>

      <IconButton
        title="Refresh class assessments and archive catalogue"
        disabled={busy}
        onClick={refresh}
      >
        <RefreshCw size={13} />
      </IconButton>

      <IconButton
        title="Download category ZIP of Word files"
        disabled={busy}
        onClick={() => exportZip(bucket, label)}
      >
        <Download size={13} />
      </IconButton>
    </div>
  );
}

function LegacyDesignatedCategoryFrame({
  bucket,
  label,
  children
}) {
  const context = useContext(Context);
  const snapshot = context?.snapshot;

  const [expanded, setExpanded] = useDesignatedLocalFlag(
    JSON.stringify([
      snapshot?.level || '',
      'category',
      bucket
    ]),
    true
  );

  const previousClosed = useRef(null);
  const closed = snapshot?.closed?.[bucket] === true;

  useEffect(() => {
    if (!snapshot) return;

    const key = `${snapshot.level}:${bucket}`;

    if (previousClosed.current?.key !== key) {
      previousClosed.current = { key, value: closed };
      return;
    }

    if (previousClosed.current.value !== closed) {
      previousClosed.current = { key, value: closed };
      setExpanded(!closed);
    }
  }, [snapshot?.level, bucket, closed, Boolean(snapshot), setExpanded]);

  const records = snapshot
    ? [
        ...snapshot.records,
        ...(snapshot.boundCopies || [])
      ].filter(record => record.bucket === bucket)
    : [];

  const missingRecords = records.filter(record => !record.linkedDocId);

  const commonMissing = snapshot
    ? snapshot.common.filter(item =>
        item.bucket === bucket && !item.linkedDocId
      )
    : [];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="text-xs text-slate-400">
            {expanded ? '▾' : '▸'}
          </span>

          <span className="text-sm font-bold text-slate-800">
            {label}
          </span>
        </button>

        {(missingRecords.length + commonMissing.length) > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            title="Expand to inspect missing document links"
            className="rounded border border-amber-300 bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-950"
          >
            {missingRecords.length} class links missing
            {commonMissing.length > 0
              ? ` · ${commonMissing.length} reference links missing`
              : ''}
          </button>
        )}
      </div>

      <DesignatedCategoryControls bucket={bucket} label={label} />

      {!expanded && missingRecords.length > 0 && (
        <div className="mt-2 space-y-1">
          {missingRecords.map(record => (
            <div
              key={record.key}
              className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1"
            >
              <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700">
                {record.name}
                <span className="ml-1 text-[10px] text-slate-400">
                  {record.className.replace(/\u200B/g, '')}
                </span>
              </span>

              <MissingLinkButton record={record} />
            </div>
          ))}
        </div>
      )}

      <div hidden={!expanded} className="mt-3">
        {children}
      </div>
    </section>
  );
}