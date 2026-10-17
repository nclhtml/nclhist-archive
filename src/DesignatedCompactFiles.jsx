import React, { useRef, useState } from 'react';
import { Eye, Download, Upload } from 'lucide-react';

import { useAuth } from './main.jsx';

import {
    addDesignatedArchiveLanguage
} from './designatedArchiveFiles.js';

import {
    downloadAppearanceDocx
} from './designatedWordExport.js';

const iconButton =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ' +
    'border border-slate-200 bg-white text-slate-600 ' +
    'hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 ' +
    'disabled:cursor-not-allowed disabled:opacity-40';

export function DesignatedPdfUploadButton({
    archiveId,
    language,
    allowed = false,
    disabled = false
}) {
    const { user, impersonatedEmail } = useAuth();

    const inputRef = useRef(null);
    const lock = useRef(false);

    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');

    const canUpload = Boolean(
        allowed &&
        user?.isAdmin &&
        !user?.isImpersonating &&
        !impersonatedEmail
    );

    if (!canUpload || !archiveId) return null;

    const label = language === 'zh' ? '中文 PDF' : 'English PDF';

    const upload = async event => {
        const file = event.target.files?.[0];
        event.target.value = '';

        if (!file || lock.current) return;

        if (!/\.pdf$/i.test(file.name)) {
            setMessage('Select a PDF file.');
            return;
        }

        if (!window.confirm(
            `Add the missing ${label}?\n\n` +
            'This adds a PDF to the existing question set. ' +
            'It does not rename the assessment or change its marking settings.'
        )) return;

        lock.current = true;
        setBusy(true);
        setMessage('Uploading…');

        try {
            await addDesignatedArchiveLanguage({
                archiveId,
                language,
                file,
                email: user.email
            });

            setMessage('PDF added.');

            // Existing archive-write listeners refresh the catalogue.
            window.dispatchEvent(
                new CustomEvent('designated-pdf-uploaded')
            );
        } catch (error) {
            setMessage(error.message || 'The upload failed.');
        } finally {
            lock.current = false;
            setBusy(false);
        }
    };

    return (
        <span className="inline-flex max-w-full flex-wrap items-center gap-1">
            <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                disabled={disabled || busy}
                onChange={upload}
            />

            <button
                type="button"
                disabled={disabled || busy}
                onClick={() => inputRef.current?.click()}
                title={`Upload missing ${label}`}
                aria-label={`Upload missing ${label}`}
                className={`${iconButton} !border-amber-200 !bg-amber-50 !text-amber-800`}
            >
                <Upload size={14} />
            </button>

            {message && (
                <span
                    role="status"
                    className="max-w-full break-words text-[10px] font-normal text-slate-600"
                >
                    {message}
                </span>
            )}
        </span>
    );
}

export default function DesignatedCompactFiles({
    item,
    archives,
    loading = false,
    disabled = false,
    uploadAllowed = false
}) {
    const [downloading, setDownloading] = useState('');
    const [message, setMessage] = useState('');
    const lock = useRef(false);

if (!item.archiveId || !item.linkedDocId) {
    return null;
  }

    const archive = archives.find(
        value => value.id === item.archiveId
    );

    if (!archive) {
        return (
            <p className="mt-2 text-[11px] text-amber-700">
                {loading ? 'Loading document…' : 'Linked document unavailable.'}
            </p>
        );
    }

    return (
        <div className="mt-2">
            <p
                title={archive.title}
                className="truncate text-[11px] text-slate-500"
            >
                {archive.title}
            </p>

            <div className="mt-1 grid grid-cols-2 gap-2">
                {[
                    ['zh', '中文', archive.fileUrlChi],
                    ['en', 'EN', archive.fileUrl]
                ].map(([language, label, url]) => (
                    <div
                        key={language}
                        className="flex min-w-0 flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-1.5"
                    >
                        <span className="mr-auto text-[11px] font-bold text-slate-600">
                            {label}
                        </span>

                        {url ? (
                            <>
                                <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    title={`View ${label} PDF`}
                                    aria-label={`View ${label} PDF`}
                                    className={iconButton}
                                >
                                    <Eye size={14} />
                                </a>

                                <button
                                    type="button"
                                    disabled={disabled || Boolean(downloading)}
                                    title={`Download ${label} Word file`}
                                    aria-label={`Download ${label} Word file`}
                                    className={iconButton}
                                    onClick={async () => {
                                        if (lock.current) return;

                                        lock.current = true;
                                        setDownloading(language);
                                        setMessage('Preparing Word file…');

                                        try {
                                            await downloadAppearanceDocx(
                                                url,
                                                `${archive.title} ${language}`,
                                                setMessage
                                            );

                                            setMessage('');
                                        } catch (error) {
                                            setMessage(error.message || 'Download failed.');
                                        } finally {
                                            lock.current = false;
                                            setDownloading('');
                                        }
                                    }}
                                >
                                    <Download size={14} />
                                </button>
                            </>
                        ) : (
                            <>
                                <span className="text-[10px] text-slate-400">
                                    Missing
                                </span>

                                <DesignatedPdfUploadButton
                                    archiveId={archive.id}
                                    language={language}
                                    allowed={uploadAllowed}
                                    disabled={disabled}
                                />
                            </>
                        )}
                    </div>
                ))}
            </div>

            {message && (
                <p
                    role="status"
                    className="mt-1 break-words text-[10px] text-slate-600"
                >
                    {message}
                </p>
            )}
        </div>
    );
}