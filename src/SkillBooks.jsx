import React, {
    useCallback,
    useEffect,
    useRef,
    useState
} from 'react';
import { createPortal } from 'react-dom';
import {
    BookOpen,
    Sparkles,
    Settings,
    X,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Plus,
    Trash2
} from 'lucide-react';
import { ref, uploadBytes } from 'firebase/storage';
import { auth, storage } from './firebase.js';

const API_URL =
    'https://us-central1-nclhist.cloudfunctions.net/skillsApi';

const SUPERADMIN = 'clng@ktls.edu.hk';

const buttonStyle =
    'inline-flex min-h-[42px] items-center justify-center gap-2 ' +
    'rounded-lg border border-slate-300 bg-white px-3 py-2 ' +
    'text-sm font-bold text-slate-700 hover:bg-slate-100 ' +
    'disabled:cursor-not-allowed disabled:opacity-40';

const inputStyle =
    'w-full min-w-0 rounded-lg border border-slate-300 ' +
    'bg-white p-2 text-sm text-slate-800';

function SkillsModal({ title, onClose, children, reader = false }) {
    const boxRef = useRef(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        const previousFocus = document.activeElement;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        boxRef.current?.focus();

        const handleKey = event => {
            const dialogs = document.querySelectorAll('[data-skills-dialog]');
            const top = dialogs[dialogs.length - 1];

            if (top !== boxRef.current) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeRef.current();
            }

            if (event.key === 'Tab') {
                const controls = Array.from(
                    boxRef.current.querySelectorAll(
                        'button:not([disabled]), input:not([disabled]), ' +
                        'select:not([disabled]), textarea:not([disabled]), ' +
                        'a[href], [tabindex="0"]'
                    )
                ).filter(element => element.getClientRects().length > 0);

                if (!controls.length) {
                    event.preventDefault();
                    return;
                }

                const first = controls[0];
                const last = controls[controls.length - 1];

                if (
                    event.shiftKey &&
                    (document.activeElement === first ||
                        document.activeElement === boxRef.current)
                ) {
                    event.preventDefault();
                    last.focus();
                } else if (
                    !event.shiftKey &&
                    (document.activeElement === last ||
                        document.activeElement === boxRef.current)
                ) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };

        document.addEventListener('keydown', handleKey, true);

        return () => {
            document.removeEventListener('keydown', handleKey, true);
            document.body.style.overflow = previousOverflow;

            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, []);

    return createPortal(
        <div
            className="fixed inset-0 flex items-center justify-center bg-black/80 p-2 sm:p-4"
            style={{ zIndex: reader ? 190 : 170 }}
        >
            <section
                ref={boxRef}
                data-skills-dialog
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className="flex h-[95dvh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl outline-none"
            >
                <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 p-3">
                    <h2 className="text-base font-bold text-slate-900">
                        {title}
                    </h2>

                    <button
                        type="button"
                        aria-label="Close / 關閉"
                        onClick={onClose}
                        className={buttonStyle}
                    >
                        <X size={18} />
                    </button>
                </header>

                {children}
            </section>

            <style>{`
        @media print {
          body {
            display: none !important;
          }
        }
      `}</style>
        </div>,
        document.body
    );
}

function SkillsReader({ session, api, language, onClose }) {
    const zh = language === 'zh';
    const [page, setPage] = useState(1);
    const [zoom, setZoom] = useState(100);
    const [image, setImage] = useState('');
    const [busy, setBusy] = useState(true);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const [expired, setExpired] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            setExpired(true);
            setImage('');
        }, Math.max(0, session.expiresAt - Date.now()));

        return () => clearTimeout(timer);
    }, [session.expiresAt]);

    useEffect(() => {
        if (expired) return undefined;

        let active = true;
        let objectUrl = '';
        const controller = new AbortController();

        setBusy(true);
        setError('');
        setImage('');

        api(
            { action: 'page', id: session.id, page },
            { image: true, signal: controller.signal }
        )
            .then(blob => {
                if (!active) return;
                objectUrl = URL.createObjectURL(blob);
                setImage(objectUrl);
            })
            .catch(problem => {
                if (active && problem.name !== 'AbortError') {
                    setError(problem.message);
                }
            })
            .finally(() => {
                if (active) setBusy(false);
            });

        return () => {
            active = false;
            controller.abort();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [api, session.id, page, retry, expired]);

    // Close the server session only when the user explicitly closes
    // this reader. Do not delete it from an effect cleanup.
    //
    // Abandoned sessions remain subject to the backend expiry
    // and scheduled cleanup.
    const handleReaderClose = () => {
        void api({
            action: 'close',
            id: session.id
        }).catch(error => {
            console.warn(
                'Could not immediately close the skills session:',
                error.message
            );
        });

        onClose();
    };

    return (
        <SkillsModal
            title={session.title}
            onClose={handleReaderClose}
            reader
        >
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white p-2">
                <button
                    type="button"
                    className={buttonStyle}
                    disabled={page <= 1 || expired}
                    onClick={() => setPage(value => value - 1)}
                    aria-label={zh ? '上一頁' : 'Previous page'}
                >
                    <ChevronLeft size={18} />
                </button>

                <select
                    className="min-h-[42px] rounded-lg border border-slate-300 p-2 text-sm"
                    value={page}
                    disabled={expired}
                    onChange={event => setPage(Number(event.target.value))}
                    aria-label={zh ? '頁碼' : 'Page'}
                >
                    {Array.from(
                        { length: session.pageCount },
                        (_, index) => (
                            <option key={index + 1} value={index + 1}>
                                {index + 1} / {session.pageCount}
                            </option>
                        )
                    )}
                </select>

                <button
                    type="button"
                    className={buttonStyle}
                    disabled={page >= session.pageCount || expired}
                    onClick={() => setPage(value => value + 1)}
                    aria-label={zh ? '下一頁' : 'Next page'}
                >
                    <ChevronRight size={18} />
                </button>

                <select
                    className="min-h-[42px] rounded-lg border border-slate-300 p-2 text-sm"
                    value={zoom}
                    onChange={event => setZoom(Number(event.target.value))}
                    aria-label={zh ? '縮放' : 'Zoom'}
                >
                    {[75, 100, 125, 150, 200].map(value => (
                        <option key={value} value={value}>{value}%</option>
                    ))}
                </select>

                <span className="text-xs text-slate-500">
                    {zh
                        ? '只供網上閱讀 · 閱讀時段為 30 分鐘'
                        : 'Online reading · 30-minute session'}
                </span>
            </div>

            {(session.entries?.length > 0 || session.warnings?.length > 0) && (
                <details className="shrink-0 border-b border-amber-200 bg-amber-50 p-2 text-sm">
                    <summary className="cursor-pointer font-bold text-amber-900">
                        {zh ? '題目與技巧目錄 / 未連結項目' : 'Question skills / Unlinked items'}
                    </summary>

                    <div className="max-h-40 space-y-2 overflow-auto p-2">
                        {session.entries?.map((entry, index) => (
                            <button
                                key={index}
                                type="button"
                                onClick={() => setPage(entry.page)}
                                className="block text-left text-sm text-blue-800 underline"
                            >
                                {entry.question} — {entry.title}
                                {' '}({zh ? '頁' : 'p.'} {entry.page})
                            </button>
                        ))}

                        {session.warnings?.map((warning, index) => (
                            <p key={index} className="text-xs text-amber-900">
                                {warning}
                            </p>
                        ))}
                    </div>
                </details>
            )}

            <div
                className="min-h-0 flex-1 overflow-auto bg-slate-300 p-2 sm:p-4"
                onContextMenu={event => event.preventDefault()}
            >
                {expired ? (
                    <p role="alert" className="rounded-lg bg-white p-5 text-center">
                        {zh
                            ? '閱讀時段已到期。請關閉並重新開啟。'
                            : 'This session expired. Close and reopen the reader.'}
                    </p>
                ) : busy ? (
                    <div role="status" className="flex justify-center p-10">
                        <Loader2 className="animate-spin text-indigo-700" size={32} />
                    </div>
                ) : error ? (
                    <div role="alert" className="space-y-3 rounded-lg bg-white p-5">
                        <p className="text-red-700">{error}</p>
                        <button
                            type="button"
                            className={buttonStyle}
                            onClick={() => setRetry(value => value + 1)}
                        >
                            {zh ? '重試' : 'Retry'}
                        </button>
                    </div>
                ) : image ? (
                    <div
                        className="mx-auto"
                        style={{
                            width: `${zoom}%`,
                            maxWidth: `${1100 * zoom / 100}px`
                        }}
                    >
                        <img
                            src={image}
                            alt={`${session.title} — ${zh ? '第' : 'page'} ${page}`}
                            draggable={false}
                            className="block h-auto w-full select-none bg-white shadow-xl"
                            onDragStart={event => event.preventDefault()}
                        />
                    </div>
                ) : null}
            </div>
        </SkillsModal>
    );
}

function SkillsManager({
    api,
    language,
    questionTypes,
    onClose,
    onPreview,
    onSaved
}) {
    const zh = language === 'zh';
    const [draft, setDraft] = useState(null);
    const [kind, setKind] = useState('dbq');
    const [busy, setBusy] = useState(true);
    const [message, setMessage] = useState('');
    const [dirty, setDirty] = useState(false);
    const [reviewed, setReviewed] = useState(false);
    const lock = useRef(false);
    const alive = useRef(true);

    useEffect(() => {
        alive.current = true;

        api({ action: 'adminConfig' })
            .then(config => {
                if (alive.current) setDraft(config);
            })
            .catch(error => {
                if (alive.current) setMessage(error.message);
            })
            .finally(() => {
                if (alive.current) setBusy(false);
            });

        return () => {
            alive.current = false;
        };
    }, [api]);

    const change = updater => {
        setDraft(updater);
        setDirty(true);
        setReviewed(false);
    };

    const close = () => {
        if (lock.current) return;

        if (
            dirty &&
            !window.confirm(
                zh
                    ? '放棄尚未發佈的修改？已處理的 PDF 會保留，但不會自動發佈。'
                    : 'Discard unpublished changes? Processed PDFs are retained but will not be published automatically.'
            )
        ) return;

        onClose();
    };

    const updateSection = (id, field, value) => {
        change(previous => ({
            ...previous,
            sections: {
                ...previous.sections,
                [kind]: previous.sections[kind].map(section =>
                    section.id === id
                        ? { ...section, [field]: value }
                        : section
                )
            }
        }));
    };

    const upload = async (file, selectedLanguage) => {
        if (!file || lock.current) return;

        if (
            !file.name.toLowerCase().endsWith('.pdf') ||
            file.size > 30 * 1024 * 1024
        ) {
            setMessage('Select a PDF no larger than 30 MB.');
            return;
        }

        if (
            !window.confirm(
                zh
                    ? '此操作會重設這個語言版本的技巧頁碼。其他語言及標籤連結會保留。繼續？'
                    : 'This resets the skills page ranges for this language. Other languages and label mappings are retained. Continue?'
            )
        ) return;

        const selectedKind = kind;

        lock.current = true;
        setBusy(true);
        setMessage(
            zh
                ? '正在上載及辨認標題，請勿關閉此視窗。'
                : 'Uploading and checking headings. Keep this window open.'
        );

        try {
            const prepared = await api({
                action: 'prepareUpload',
                kind: selectedKind,
                language: selectedLanguage,
                name: file.name
            });

            await uploadBytes(
                ref(storage, prepared.path),
                file,
                { contentType: 'application/pdf' }
            );

            const result = await api({
                action: 'finishUpload',
                id: prepared.id
            });

            if (!alive.current) return;

            change(previous => ({
                ...previous,
                books: {
                    ...previous.books,
                    [selectedKind]: {
                        ...previous.books[selectedKind],
                        [selectedLanguage]: result.asset
                    }
                },
                sections: {
                    ...previous.sections,
                    [selectedKind]: previous.sections[selectedKind].map(section => ({
                        ...section,
                        [selectedLanguage]: result.ranges[section.id] || ''
                    }))
                }
            }));

            setMessage(
                `${file.name}: ${result.asset.pageCount} physical PDF pages. ` +
                `${Object.keys(result.ranges).length} DBQ heading suggestions. ` +
                'Preview and check every range before publishing. ' +
                'Unrecognized headings and Essay sections require manual page ranges.'
            );
        } catch (error) {
            if (alive.current) setMessage(error.message);
        } finally {
            lock.current = false;
            if (alive.current) setBusy(false);
        }
    };

    const save = async () => {
        if (lock.current || !draft || !reviewed) return;

        lock.current = true;
        setBusy(true);
        setMessage('');

        try {
            const saved = await api({
                action: 'saveConfig',
                config: draft,
                reviewed: true
            });

            if (!alive.current) return;

            setDraft(saved);
            setDirty(false);
            setReviewed(false);
            setMessage(
                zh
                    ? '已發佈。已開啟的舊閱讀時段需要重新開啟。'
                    : 'Published. Existing readers must reopen to use the new settings.'
            );
            onSaved();
        } catch (error) {
            if (alive.current) setMessage(error.message);
        } finally {
            lock.current = false;
            if (alive.current) setBusy(false);
        }
    };

    const paperType = kind === 'dbq'
        ? 'Paper 1 (DBQ)'
        : 'Paper 2 (Essay)';

    return (
        <SkillsModal
            title={zh ? '管理技巧筆記' : 'Manage Skills Books'}
            onClose={close}
        >
            <div className="flex shrink-0 gap-2 border-b p-3">
                {['dbq', 'essay'].map(value => (
                    <button
                        key={value}
                        type="button"
                        disabled={busy}
                        onClick={() => setKind(value)}
                        className={
                            buttonStyle +
                            (kind === value ? ' ring-2 ring-indigo-500' : '')
                        }
                    >
                        {value === 'dbq' ? 'DBQ' : 'Essay'}
                    </button>
                ))}
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-auto p-3 sm:p-5">
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    {zh
                        ? '頁碼必須是 PDF 的實際位置，包括封面。中英文獨立設定。標題辨認只提供建議；不確定的標籤或頁碼可留空。'
                        : 'Use physical PDF page positions, including the cover. English and Chinese are independent. Heading detection only provides suggestions. Leave uncertain labels or ranges empty.'}
                </p>

                {message && (
                    <div
                        role="status"
                        className="whitespace-pre-wrap rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"
                    >
                        {message}
                    </div>
                )}

                {busy && (
                    <div className="flex items-center gap-2 text-sm text-indigo-700">
                        <Loader2 className="animate-spin" size={18} />
                        {zh ? '處理中…' : 'Processing…'}
                    </div>
                )}

                {draft && (
                    <>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {['en', 'zh'].map(selectedLanguage => {
                                const asset = draft.books[kind][selectedLanguage];

                                return (
                                    <div
                                        key={`${kind}-${selectedLanguage}`}
                                        className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
                                    >
                                        <h3 className="font-bold text-slate-800">
                                            {kind.toUpperCase()} — {selectedLanguage === 'en'
                                                ? 'English'
                                                : '中文'}
                                        </h3>

                                        <p className="break-all text-xs text-slate-600">
                                            {asset
                                                ? `${asset.name} — ${asset.pageCount} pages`
                                                : zh ? '尚未上載' : 'Not uploaded'}
                                        </p>

                                        <input
                                            type="file"
                                            accept=".pdf,application/pdf"
                                            disabled={busy}
                                            className="block w-full text-xs"
                                            onChange={event => {
                                                const file = event.target.files?.[0];
                                                event.target.value = '';
                                                upload(file, selectedLanguage);
                                            }}
                                        />

                                        {asset && (
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    className={buttonStyle}
                                                    onClick={() => onPreview(asset.id, '')}
                                                >
                                                    {zh ? '預覽整本' : 'Preview book'}
                                                </button>

                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    className={buttonStyle}
                                                    onClick={() => {
                                                        if (!window.confirm(
                                                            'Unpublish this language version and clear its page mappings?'
                                                        )) return;

                                                        change(previous => ({
                                                            ...previous,
                                                            books: {
                                                                ...previous.books,
                                                                [kind]: {
                                                                    ...previous.books[kind],
                                                                    [selectedLanguage]: null
                                                                }
                                                            },
                                                            sections: {
                                                                ...previous.sections,
                                                                [kind]: previous.sections[kind].map(section => ({
                                                                    ...section,
                                                                    [selectedLanguage]: ''
                                                                }))
                                                            }
                                                        }));
                                                    }}
                                                >
                                                    {zh ? '取消發佈' : 'Unpublish'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        <div className="flex items-center justify-between gap-2">
                            <h3 className="font-bold text-slate-900">
                                {zh ? '技巧章節及題型標籤' : 'Skills sections and question labels'}
                            </h3>

                            <button
                                type="button"
                                disabled={busy}
                                className={buttonStyle}
                                onClick={() => {
                                    change(previous => ({
                                        ...previous,
                                        sections: {
                                            ...previous.sections,
                                            [kind]: [
                                                ...previous.sections[kind],
                                                {
                                                    id: crypto.randomUUID(),
                                                    titleEn: 'New skill',
                                                    titleZh: '新技巧',
                                                    en: '',
                                                    zh: '',
                                                    tags: []
                                                }
                                            ]
                                        }
                                    }));
                                }}
                            >
                                <Plus size={16} />
                                {zh ? '新增章節' : 'Add section'}
                            </button>
                        </div>

                        {!draft.sections[kind].length && (
                            <p className="text-sm text-slate-500">
                                {zh
                                    ? '目前沒有章節。Essay PDF 上載後，可新增章節及設定頁碼。'
                                    : 'No sections yet. After uploading the Essay book, add sections and their page ranges.'}
                            </p>
                        )}

                        {draft.sections[kind].map(section => {
                            const options = [...new Set([
                                ...(questionTypes[paperType] || []),
                                ...section.tags
                            ])].sort();

                            return (
                                <div
                                    key={section.id}
                                    className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
                                >
                                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                                        <input
                                            aria-label="English section title"
                                            disabled={busy}
                                            className={inputStyle}
                                            value={section.titleEn}
                                            onChange={event =>
                                                updateSection(section.id, 'titleEn', event.target.value)
                                            }
                                        />

                                        <input
                                            aria-label="中文章節標題"
                                            disabled={busy}
                                            className={inputStyle}
                                            value={section.titleZh}
                                            onChange={event =>
                                                updateSection(section.id, 'titleZh', event.target.value)
                                            }
                                        />

                                        <button
                                            type="button"
                                            aria-label="Remove section"
                                            disabled={busy}
                                            className={buttonStyle}
                                            onClick={() => {
                                                if (!window.confirm('Remove this skills section?')) return;

                                                change(previous => ({
                                                    ...previous,
                                                    sections: {
                                                        ...previous.sections,
                                                        [kind]: previous.sections[kind].filter(
                                                            item => item.id !== section.id
                                                        )
                                                    }
                                                }));
                                            }}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>

                                    <div className="grid gap-3 sm:grid-cols-2">
                                        {['en', 'zh'].map(selectedLanguage => {
                                            const asset = draft.books[kind][selectedLanguage];

                                            return (
                                                <label
                                                    key={selectedLanguage}
                                                    className="space-y-1 text-xs font-bold text-slate-600"
                                                >
                                                    <span>
                                                        {selectedLanguage === 'en'
                                                            ? 'English PDF pages'
                                                            : '中文 PDF 頁碼'}
                                                    </span>

                                                    <div className="flex gap-2">
                                                        <input
                                                            disabled={busy || !asset}
                                                            placeholder="13 / 26-28 / 13, 16"
                                                            className={inputStyle}
                                                            value={section[selectedLanguage]}
                                                            onChange={event =>
                                                                updateSection(
                                                                    section.id,
                                                                    selectedLanguage,
                                                                    event.target.value
                                                                )
                                                            }
                                                        />

                                                        <button
                                                            type="button"
                                                            disabled={
                                                                busy ||
                                                                !asset ||
                                                                !section[selectedLanguage].trim()
                                                            }
                                                            className={buttonStyle}
                                                            onClick={() =>
                                                                onPreview(
                                                                    asset.id,
                                                                    section[selectedLanguage]
                                                                )
                                                            }
                                                        >
                                                            {zh ? '預覽' : 'Preview'}
                                                        </button>
                                                    </div>
                                                </label>
                                            );
                                        })}
                                    </div>

                                    <details className="rounded-lg bg-slate-50 p-3">
                                        <summary className="cursor-pointer text-sm font-bold text-indigo-800">
                                            {zh ? '連結題型標籤' : 'Link question-type labels'}
                                            {' '}({section.tags.length})
                                        </summary>

                                        <div className="mt-3 grid max-h-64 gap-2 overflow-auto sm:grid-cols-2">
                                            {options.map(tag => (
                                                <label
                                                    key={tag}
                                                    className="flex items-start gap-2 text-xs text-slate-700"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        disabled={busy}
                                                        checked={section.tags.includes(tag)}
                                                        onChange={event => {
                                                            updateSection(
                                                                section.id,
                                                                'tags',
                                                                event.target.checked
                                                                    ? [...section.tags, tag]
                                                                    : section.tags.filter(value => value !== tag)
                                                            );
                                                        }}
                                                    />
                                                    <span>{tag}</span>
                                                </label>
                                            ))}

                                            {!options.length && (
                                                <p className="text-xs text-slate-500">
                                                    {zh
                                                        ? '目前未有此試卷類別的題型標籤。'
                                                        : 'No question-type labels exist for this paper yet.'}
                                                </p>
                                            )}
                                        </div>
                                    </details>
                                </div>
                            );
                        })}
                    </>
                )}
            </div>

            <footer className="shrink-0 space-y-3 border-t border-slate-200 bg-slate-50 p-3">
                <label className="flex items-start gap-2 text-sm text-slate-700">
                    <input
                        type="checkbox"
                        checked={reviewed}
                        disabled={busy || !draft}
                        onChange={event => setReviewed(event.target.checked)}
                    />

                    <span>
                        {zh
                            ? '我已核對已上載的語言版本、實際 PDF 頁碼，以及標籤連結。空白項目是刻意保留。'
                            : 'I checked the uploaded language versions, physical PDF page ranges, and label mappings. Blank entries are intentional.'}
                    </span>
                </label>

                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        disabled={busy}
                        className={buttonStyle}
                        onClick={close}
                    >
                        {zh ? '關閉' : 'Close'}
                    </button>

                    <button
                        type="button"
                        disabled={busy || !reviewed || !draft}
                        onClick={save}
                        className="min-h-[42px] rounded-lg bg-indigo-700 px-5 py-2 text-sm font-bold text-white disabled:opacity-40"
                    >
                        {zh ? '儲存並發佈' : 'Save and publish'}
                    </button>
                </div>
            </footer>
        </SkillsModal>
    );
}

export function useSkillBooks({
    user,
    realUser,
    language,
    previewItem,
    questionTypes
}) {
    const zh = language === 'zh';
    const allowed = Boolean(
        user?.isAuthorized &&
        user?.role &&
        user.role !== 'dse_only'
    );

    const manager = Boolean(
        allowed &&
        realUser?.email === SUPERADMIN &&
        user?.email === SUPERADMIN &&
        !user?.isImpersonating
    );

    const actingAs = user?.isImpersonating ? user.email : '';

    const [catalog, setCatalog] = useState(null);
    const [showManager, setShowManager] = useState(false);
    const [session, setSession] = useState(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const job = useRef(false);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;

        return () => {
            mounted.current = false;
        };
    }, []);

    const api = useCallback(async (body, options = {}) => {
        const firebaseUser = auth.currentUser;

        if (!firebaseUser) {
            throw new Error('Please sign in again.');
        }

        const token = await firebaseUser.getIdToken();

        const response = await fetch(API_URL, {
            method: 'POST',
            cache: 'no-store',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                ...(actingAs ? { 'X-Skills-Act-As': actingAs } : {})
            },
            body: JSON.stringify(body),
            signal: options.signal
        });

        if (!response.ok) {
            const problem = await response.json().catch(() => ({}));
            throw new Error(
                problem.error ||
                `Skills request failed (${response.status}).`
            );
        }

        return options.image ? response.blob() : response.json();
    }, [actingAs]);

    const refresh = useCallback(() => {
        if (!allowed) return;

        api({ action: 'catalog' })
            .then(result => {
                if (mounted.current) setCatalog(result);
            })
            .catch(error => {
                if (mounted.current) setMessage(error.message);
            });
    }, [api, allowed]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // Switching the website language closes the old-language reader.
    useEffect(() => {
        setSession(null);
    }, [language]);

    useEffect(() => {
        if (!allowed) {
            setSession(null);
            setShowManager(false);
            setCatalog(null);
        }
    }, [allowed]);

    const openReader = useCallback(async body => {
        if (!allowed || job.current) return;

        job.current = true;
        setBusy(true);
        setMessage('');

        try {
            const next = await api(body);

            if (mounted.current) {
                setSession(next);
            } else {
                api({ action: 'close', id: next.id }).catch(() => { });
            }
        } catch (error) {
            if (mounted.current) {
                setMessage(error.message);
                window.alert(error.message);
            }
        } finally {
            job.current = false;
            if (mounted.current) setBusy(false);
        }
    }, [api, allowed]);

    const openRecall = () => {
        if (!previewItem) return;

        const selected = previewItem.isFullPaper
            ? previewItem.hasFullAccess
                ? previewItem.parent.subQuestions || []
                : previewItem.matchedChildren || []
            : previewItem.child
                ? [previewItem.child]
                : [];

        openReader({
            action: 'open',
            mode: 'recall',
            archiveId: previewItem.parent.id,
            childIds: selected.map(question => String(question.id)),
            language
        });
    };

    const launchBar = allowed ? (
        <section className="mb-5 space-y-2">
            <div className="flex flex-wrap gap-3">
                {['dbq', 'essay'].map(kind => {
                    const available = catalog?.[kind]?.[language];
                    const title = zh
                        ? kind === 'dbq' ? 'DBQ 答題技巧' : '論述題答題技巧'
                        : kind === 'dbq' ? 'DBQ Skills Book' : 'Essay Skills Book';

                    return (
                        <button
                            key={kind}
                            type="button"
                            disabled={busy}
                            onClick={() => openReader({
                                action: 'open',
                                mode: 'book',
                                kind,
                                language
                            })}
                            className={
                                'flex min-h-[76px] flex-1 items-center justify-center gap-3 ' +
                                'rounded-xl border-2 px-4 py-3 text-white shadow-lg ' +
                                'transition-transform hover:-translate-y-0.5 ' +
                                'focus-visible:outline-none focus-visible:ring-4 ' +
                                'focus-visible:ring-amber-300 disabled:opacity-50 ' +
                                (kind === 'dbq'
                                    ? 'border-indigo-300 bg-gradient-to-r from-indigo-700 to-violet-600'
                                    : 'border-amber-200 bg-gradient-to-r from-amber-600 to-orange-600')
                            }
                        >
                            <BookOpen size={25} />

                            <span className="text-left">
                                <span className="block text-sm font-extrabold sm:text-lg">
                                    {title}
                                </span>
                                <span className="block text-xs text-white/90">
                                    {available
                                        ? zh ? '開啟網上閱讀' : 'Open online reader'
                                        : catalog
                                            ? zh ? '尚未上載' : 'Not uploaded yet'
                                            : zh ? '技巧筆記' : 'Skills library'}
                                </span>
                            </span>

                            <Sparkles size={19} />
                        </button>
                    );
                })}

                {manager && (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => setShowManager(true)}
                        className={buttonStyle}
                    >
                        <Settings size={18} />
                        {zh ? '管理技巧筆記' : 'Manage Skills Books'}
                    </button>
                )}
            </div>

            {message && (
                <p role="status" className="text-xs text-amber-800">
                    {message}
                </p>
            )}
        </section>
    ) : null;

    const recallButton = allowed && previewItem ? (
        <button
            type="button"
            disabled={busy}
            onClick={openRecall}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-400 px-3 py-1.5 text-xs font-extrabold text-slate-900 shadow-sm hover:bg-amber-300 disabled:opacity-40 md:text-sm"
        >
            <Sparkles size={15} />
            {zh ? '技巧重溫' : 'Skill Recall'}
        </button>
    ) : null;

    const dialogs = (
        <>
            {showManager && manager && (
                <SkillsManager
                    api={api}
                    language={language}
                    questionTypes={questionTypes}
                    onClose={() => setShowManager(false)}
                    onSaved={refresh}
                    onPreview={(assetId, pages) => openReader({
                        action: 'preview',
                        assetId,
                        pages
                    })}
                />
            )}

            {session && allowed && (
                <SkillsReader
                    key={session.id}
                    session={session}
                    api={api}
                    language={language}
                    onClose={() => setSession(null)}
                />
            )}

            {busy && allowed && createPortal(
                <div
                    role="status"
                    aria-live="polite"
                    className="fixed inset-0 flex items-center justify-center bg-black/70 p-5"
                    style={{ zIndex: 210 }}
                >
                    <div className="flex max-w-md flex-col items-center gap-4 rounded-xl bg-white p-6 text-center shadow-2xl">
                        <Loader2 className="animate-spin text-indigo-700" size={32} />
                        <p className="font-bold text-slate-800">
                            {zh ? '正在準備技巧頁面…' : 'Preparing skills pages…'}
                        </p>
                        <p className="text-sm text-slate-600">
                            {zh ? '請稍候，並保持此頁開啟。' : 'Please wait and keep this page open.'}
                        </p>
                    </div>
                </div>,
                document.body
            )}
        </>
    );

    return { launchBar, recallButton, dialogs };
}