import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { auth } from './firebase.js';
import { useAuth } from './main.jsx';

function useVersionPdf(fileUrl) {
  const { user, authLoading } = useAuth();
  const [result, setResult] = useState({
    key: '',
    url: '',
    error: ''
  });

  const key = JSON.stringify([
    fileUrl,
    user?.email || '',
    Boolean(user?.isAuthorized)
  ]);

  useEffect(() => {
    let cancelled = false;
    let blobUrl = '';
    const controller = new AbortController();

    setResult({ key, url: '', error: '' });

    if (authLoading) return;

    if (!user?.isAuthorized || !auth.currentUser) {
      setResult({
        key,
        url: '',
        error: 'Please sign in with an authorized account.'
      });
      return;
    }

    const load = async () => {
      try {
        const actualUser = auth.currentUser;
        const params = new URLSearchParams(
          String(fileUrl).split('?')[1] || ''
        );

        const token = await actualUser.getIdToken();

        // The backend permits another effective email only for the owner.
        params.set('as', user.email);

        const projectId = auth.app.options.projectId;
        const endpoint =
          `https://us-central1-${projectId}.cloudfunctions.net/archiveVersionPdf`;

        const response = await fetch(
          `${endpoint}?${params.toString()}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal: controller.signal
          }
        );

        if (!response.ok) {
          throw new Error(
            await response.text() || 'The PDF could not be loaded.'
          );
        }

        const blob = await response.blob();

        if (cancelled || auth.currentUser?.uid !== actualUser.uid) return;

        blobUrl = URL.createObjectURL(blob);
        setResult({ key, url: blobUrl, error: '' });
      } catch (error) {
        if (cancelled || error.name === 'AbortError') return;

        setResult({
          key,
          url: '',
          error: error.message || 'The PDF could not be loaded.'
        });
      }
    };

    load();

    return () => {
      cancelled = true;
      controller.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [key, authLoading]);

  return result.key === key
    ? result
    : { url: '', error: '' };
}

export function VersionPdfInline({ fileUrl, renderViewer }) {
  const { url, error } = useVersionPdf(fileUrl);

  if (error) {
    return (
      <div role="alert" className="p-6 text-sm text-red-700 bg-white">
        {error}
      </div>
    );
  }

  if (!url) {
    return (
      <div role="status" className="p-6 text-sm text-slate-600">
        Checking assignment and loading PDF…
      </div>
    );
  }

  return renderViewer(url);
}

export default function VersionPdfPage() {
  const location = useLocation();
  const fileUrl = `/archive-pdf${location.search}`;
  const { url, error } = useVersionPdf(fileUrl);

  return (
    <main className="flex flex-col min-h-[85vh] p-3 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-bold text-slate-800">Assigned document PDF</h1>

        {url && (
          <a
            href={url}
            download="archive-version.pdf"
            className="rounded-lg bg-blue-700 px-4 py-2 text-white font-bold"
          >
            Download PDF
          </a>
        )}
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">
          {error}
        </p>
      ) : url ? (
        <>
          <p className="text-xs text-slate-500">
            If your device does not display the PDF below, use Download PDF.
          </p>
          <iframe
            title="Assigned archive PDF"
            src={url}
            className="w-full flex-1 min-h-[75vh] border rounded-lg bg-white"
          />
        </>
      ) : (
        <p role="status">Checking assignment and loading PDF…</p>
      )}
    </main>
  );
}