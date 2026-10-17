import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react';

import {
  Eye,
  Download,
  Link as LinkIcon,
  ExternalLink,
  GripVertical,
  Undo2,
  ChevronUp,
  ChevronDown
} from 'lucide-react';

import { DesignatedPdfUploadButton } from './DesignatedCompactFiles.jsx';
import { useDesignatedLocalFlag } from './DesignatedBrowserState.jsx';
import { resolveDesignatedLink } from './designatedWordExport.js';

const iconClass =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center ' +
  'rounded border border-slate-200 bg-white text-slate-600 ' +
  'hover:bg-blue-50 hover:text-blue-700 disabled:opacity-30';

function Icon({ title, children, ...props }) {
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

function sorted(values) {
  return [...values].sort((a, b) =>
    Number(a.order) - Number(b.order) ||
    String(a.key || a.id).localeCompare(String(b.key || b.id))
  );
}

// All components share the actual provider Context passed by
// DesignatedIncoming.jsx. No additional backend requests are introduced.
export function createDesignatedRowComponents(Context, CategoryControls) {
  const ExpansionContext = createContext(null);

  function useExpansion(identity, initial = false) {
    const [expanded, setExpanded] = useDesignatedLocalFlag(
      identity,
      initial
    );

    const group = useContext(ExpansionContext);
    const lastCommand = useRef(null);
    const command = group?.command;

    useEffect(() => {
      if (!command || lastCommand.current === command.id) return;

      lastCommand.current = command.id;
      setExpanded(command.expanded);
    }, [command, setExpanded]);

    return [expanded, setExpanded];
  }

  function LinkNotice({ record }) {
    const context = useContext(Context);

    if (record.linkedDocId) return null;

    const canRepair =
      context.snapshot.owner ||
      record.uploadAllowed === true;

    return (
      <button
        type="button"
        disabled={context.busy || !canRepair}
        title={
          canRepair
            ? 'Add the missing document link'
            : 'Only the class owner or superadmin can add the link'
        }
        className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-300 bg-amber-100 px-1.5 py-1 text-[10px] font-bold text-amber-950 disabled:opacity-60"
        onClick={() => {
          if (canRepair) context.openLinker(record);
        }}
      >
        <LinkIcon size={11} />
        No link{canRepair ? ' · Add' : ''}
      </button>
    );
  }

  function AssessmentRow({
    record,
    expanded = false,
    orderControls = null
  }) {
    const context = useContext(Context);

    const {
      snapshot,
      archives,
      busy,
      openLinker,
      downloadOne,
      perform,
      onCommonChanged,
      setMessage
    } = context;

    const owner = snapshot.owner;
    const bound = Boolean(record.commonId);
    const canDrag = owner && !busy;

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

    const returnToClass = async () => {
      if (!owner || busy || !bound) return;

      if (!window.confirm(
        `Return "${record.name}" to its class-specific list?\n\n` +
        'Its assessment ID, name, marks, document link and settings will be kept.\n' +
        'It will no longer be Compulsory.\n' +
        'This common item will not automatically recreate that class copy.'
      )) return;

      const result = await perform('detach', { key: record.key });

      if (result) {
        setMessage(
          'Assessment returned to the class-specific list. No marks were deleted.'
        );

        await onCommonChanged?.();
      }
    };

    return (
      <article
        draggable={canDrag}
        onDragStart={event => {
          // Drag the card background/name/handle, not an action control.
          if (
            !canDrag ||
            event.target.closest('button, a, input, select')
          ) {
            event.preventDefault();
            return;
          }

          event.stopPropagation();
          event.dataTransfer.effectAllowed = 'move';

          event.dataTransfer.setData(
            bound
              ? 'application/x-designated-bound'
              : 'application/x-designated-assessment',
            record.key
          );

          // Also supplies a standard drag payload for browsers
          // that require one to initiate a custom drag.
          event.dataTransfer.setData('text/plain', record.name);
        }}
        className={`rounded-md border ${
          !record.linkedDocId
            ? 'border-amber-300 bg-amber-50'
            : 'border-slate-200 bg-white'
        } ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        <div className="flex items-start gap-1.5 p-2">
          {canDrag && (
            <span
              title={
                bound
                  ? 'Drag back onto this class’s class-specific column'
                  : 'Drag onto a common item’s attachment area'
              }
              className="shrink-0 pt-0.5 text-slate-400"
            >
              <GripVertical size={14} />
            </span>
          )}

          <p className="min-w-0 flex-1 break-words text-xs font-semibold text-slate-800">
            {record.name}
          </p>

          {!record.linkedDocId ? (
            <LinkNotice record={record} />
          ) : !expanded && url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              draggable={false}
              title="View PDF"
              aria-label="View PDF"
              className="shrink-0 text-slate-500 hover:text-blue-700"
            >
              <Eye size={14} />
            </a>
          ) : !url ? (
            <span className="shrink-0 rounded bg-amber-100 px-1 text-[9px] text-amber-900">
              {resolved ? 'PDF missing' : 'Check link'}
            </span>
          ) : null}
        </div>

        <div
          hidden={!expanded}
          className="border-t border-slate-100 px-2 pb-2 pt-1"
        >
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
                ? 'Saved link unavailable. Try the refresh button.'
                : 'No question set linked.'}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1">
            {orderControls}

            {owner && record.linkedDocId && (
              <Icon
                title="Change document"
                disabled={busy}
                onClick={() => openLinker(record)}
              >
                <LinkIcon size={13} />
              </Icon>
            )}

            {url && (
              <>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  draggable={false}
                  title="View PDF"
                  aria-label="View PDF"
                  className={iconClass}
                >
                  <Eye size={13} />
                </a>

                <Icon
                  title="Download Word"
                  disabled={busy}
                  onClick={() => downloadOne(url, record.name)}
                >
                  <Download size={13} />
                </Icon>
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

            {(owner || record.uploadAllowed) && (
              <a
                href={`/marks?class=${encodeURIComponent(record.className)}`}
                target="_blank"
                rel="noreferrer"
                draggable={false}
                title="Open this class in Marks"
                aria-label="Open this class in Marks"
                className={iconClass}
              >
                <ExternalLink size={13} />
              </a>
            )}

            {bound && owner && (
              <Icon
                title="Return to class-specific items"
                disabled={busy}
                onClick={returnToClass}
              >
                <Undo2 size={13} />
              </Icon>
            )}
          </div>
        </div>
      </article>
    );
  }

  function ClassList({
    className,
    records,
    bucket,
    category
  }) {
    const context = useContext(Context);
    const {
      snapshot,
      busy,
      perform,
      onCommonChanged,
      setMessage
    } = context;

    const [expanded, setExpanded] = useExpansion(
      JSON.stringify([
        snapshot.level,
        'class-list',
        bucket,
        category,
        className
      ]),
      false
    );

    const [dragOver, setDragOver] = useState(false);

    const list = sorted(records);
    const missing = list.filter(item => !item.linkedDocId).length;
    const language = snapshot.languages[className];

    const returnDropped = async event => {
      const key = event.dataTransfer.getData(
        'application/x-designated-bound'
      );

      if (!key || !snapshot.owner || busy) return;

      const copy = (snapshot.boundCopies || []).find(
        item => item.key === key
      );

      if (
        !copy ||
        copy.className !== className ||
        copy.bucket !== bucket ||
        copy.category !== category
      ) {
        window.alert(
          'Drop the attached assessment into its own class, category and Assignment/Quiz column.'
        );
        return;
      }

      if (!window.confirm(
        `Return "${copy.name}" to this class-specific list?\n\n` +
        'Its name, marks, document link and settings will be kept.'
      )) return;

      const result = await perform('detach', { key });

      if (result) {
        setMessage('Assessment returned. No marks were deleted.');
        await onCommonChanged?.();
      }
    };

    return (
      <section
        onDragOver={event => {
          if (
            snapshot.owner &&
            !busy &&
            Array.from(event.dataTransfer.types).includes(
              'application/x-designated-bound'
            )
          ) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDragOver(true);
          }
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setDragOver(false);
          }
        }}
        onDrop={event => {
          if (!event.dataTransfer.getData('application/x-designated-bound')) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          setDragOver(false);
          returnDropped(event);
        }}
        className={`min-w-0 rounded-md border p-2 ${
          dragOver
            ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-300'
            : 'border-slate-200 bg-white'
        }`}
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}
          className="flex w-full items-start gap-2 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block break-words text-[11px] font-bold text-slate-700">
              {expanded ? '▾ ' : '▸ '}
              {className.replace(/\u200B/g, '')}
            </span>

            <span className="text-[10px] text-slate-400">
              {list.length} items · {expanded ? 'Hide controls' : 'Show controls'}
            </span>
          </span>

          {missing > 0 && (
            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-1 text-[10px] font-bold text-amber-900">
              {missing} unlinked
            </span>
          )}
        </button>

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

        <div className="mt-2 space-y-1">
          {!list.length && (
            <p className="text-[11px] text-slate-400">
              No items.
              {snapshot.owner ? ' Drop an attached class assessment here to return it.' : ''}
            </p>
          )}

          {list.map((record, index) => (
            <AssessmentRow
              key={record.key}
              record={record}
              expanded={expanded}
              orderControls={snapshot.owner ? (
                <>
                  <Icon
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
                  </Icon>

                  <Icon
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
                  </Icon>
                </>
              ) : null}
            />
          ))}
        </div>
      </section>
    );
  }

  function BoundCopies({ item }) {
    const context = useContext(Context);
    const level = context?.snapshot?.level || '';

    const [expanded, setExpanded] = useExpansion(
      JSON.stringify([level, 'common-copies', item.id]),
      false
    );

    if (!context?.snapshot) return null;

    const { snapshot } = context;

    const copies = (snapshot.boundCopies || []).filter(
      copy => copy.commonId === item.id
    );

    if (!copies.length) return null;

    const missing = copies.filter(copy => !copy.linkedDocId).length;

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
                  <AssessmentRow
                    record={copy}
                    expanded={expanded}
                  />
                ) : expanded ? (
                  <p className="text-[11px] text-slate-400">
                    No assessment attached.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  function CategoryFrame({ bucket, label, children }) {
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

    const [command, setCommand] = useState(null);
    const sequence = useRef(0);
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
      ? [...snapshot.records, ...(snapshot.boundCopies || [])]
          .filter(record => record.bucket === bucket)
      : [];

    const missing = records.filter(record => !record.linkedDocId);

    const setAll = value => {
      // Keep the category itself visible. "Collapse all" retains names
      // but hides all document/action detail blocks.
      setExpanded(true);

      setCommand({
        id: ++sequence.current,
        expanded: value
      });
    };

    return (
      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(value => !value)}
            className="min-w-0 flex-1 text-left text-sm font-bold text-slate-800"
          >
            {expanded ? '▾' : '▸'} {label}
          </button>

          {missing.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded border border-amber-300 bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-950"
            >
              {missing.length} unlinked
            </button>
          )}

          <button
            type="button"
            onClick={() => setAll(true)}
            className="rounded border bg-white px-2 py-1 text-[10px] text-slate-600"
          >
            Expand all
          </button>

          <button
            type="button"
            onClick={() => setAll(false)}
            className="rounded border bg-white px-2 py-1 text-[10px] text-slate-600"
          >
            Collapse all
          </button>
        </div>

        <CategoryControls bucket={bucket} label={label} />

        {!expanded && missing.length > 0 && (
          <div className="mt-2 space-y-1">
            {missing.map(record => (
              <div
                key={record.key}
                className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1"
              >
                <span className="min-w-0 flex-1 truncate text-[11px]">
                  {record.name}
                  <span className="ml-1 text-[10px] text-slate-400">
                    {record.className.replace(/\u200B/g, '')}
                  </span>
                </span>

                <LinkNotice record={record} />
              </div>
            ))}
          </div>
        )}

        <ExpansionContext.Provider value={{ command }}>
          <div hidden={!expanded} className="mt-3">
            {children}
          </div>
        </ExpansionContext.Provider>
      </section>
    );
  }

  return {
    AssessmentRow,
    ClassList,
    BoundCopies,
    CategoryFrame
  };
}