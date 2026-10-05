import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { archiveTool } from './archiveToolsClient.js';

export default function ReportResolutionNotice({
    enabled,
    accountKey,
    language,
    onOpen
}) {
    const [notification, setNotification] = useState(null);
    const [opening, setOpening] = useState(false);
    const [error, setError] = useState('');
    const claimBusy = useRef(false);

    useEffect(() => {
        setNotification(null);
        setError('');
        setOpening(false);
    }, [accountKey, enabled]);

    useEffect(() => {
        if (!enabled || notification) return undefined;

        let active = true;

        const poll = async () => {
            if (
                !active ||
                document.visibilityState !== 'visible' ||
                claimBusy.current
            ) return;

            claimBusy.current = true;

            try {
                const result = await archiveTool({
                    action: 'claimNotification'
                });

                if (active && result.notification) {
                    setNotification(result.notification);
                }
            } catch (problem) {
                // Do not interrupt normal viewing with polling failures.
                console.warn(
                    'Report notification check failed:',
                    problem.message
                );
            } finally {
                claimBusy.current = false;
            }
        };

        // A small initial delay avoids an immediate Strict Mode
        // mount/cleanup claim during development.
        const initial = window.setTimeout(poll, 1200);
        const interval = window.setInterval(poll, 30000);

        document.addEventListener('visibilitychange', poll);

        return () => {
            active = false;
            window.clearTimeout(initial);
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', poll);
        };
    }, [enabled, accountKey, notification]);

    if (!enabled || !notification) return null;

    const zh = language === 'zh';

    const open = async () => {
        if (opening) return;

        setOpening(true);
        setError('');

        try {
            await onOpen(notification);
            setNotification(null);
        } catch (problem) {
            setError(problem.message);
        } finally {
            setOpening(false);
        }
    };

    return createPortal(
        <div
            style={{
                position: 'fixed',
                right: 16,
                bottom: 48,
                zIndex: 11000,
                width: 'min(360px, calc(100vw - 32px))',
                pointerEvents: 'none'
            }}
        >
            <section
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="rounded-xl border border-green-300 bg-white p-4 text-left shadow-xl"
                style={{ pointerEvents: 'auto' }}
            >
                <div className="flex items-start justify-between gap-3">
                    <h2 className="text-sm font-bold text-green-800">
                        {zh ? '你的報告已處理' : 'Your report has been resolved'}
                    </h2>

                    <button
                        type="button"
                        disabled={opening}
                        aria-label={zh ? '關閉通知' : 'Dismiss notification'}
                        onClick={() => setNotification(null)}
                        className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100"
                    >
                        ×
                    </button>
                </div>

                <p className="mt-2 text-sm text-slate-700">
                    {zh
                        ? '管理員已完成處理你提交的問題。'
                        : 'An administrator has finished addressing the issue you reported.'}
                </p>

                <p className="mt-2 break-words text-xs font-bold text-slate-600">
                    {notification.documentName}
                </p>

                <button
                    type="button"
                    disabled={opening}
                    onClick={open}
                    className="mt-3 rounded-lg bg-green-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                    {opening
                        ? zh ? '正在開啟…' : 'Opening…'
                        : zh ? '查看已處理文件' : 'View resolved document'}
                </button>

                {error && (
                    <p className="mt-2 whitespace-pre-wrap text-xs text-red-700">
                        {error}
                    </p>
                )}
            </section>
        </div>,
        document.body
    );
}