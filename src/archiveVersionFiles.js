import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase.js';

// Kept below the first-generation HTTP response limit.
// This applies to each finished split PDF, not the full source exam.
export const MAX_VERSION_PDF_BYTES = 8 * 1024 * 1024;

export async function saveArchivePdf(
  bytes,
  ordinaryPath,
  privateArchiveId = ''
) {
  if (!privateArchiveId) {
    const target = ref(storage, ordinaryPath);

    await uploadBytes(target, bytes, {
      contentType: 'application/pdf'
    });

    return getDownloadURL(target);
  }

  const size = bytes instanceof Blob
    ? bytes.size
    : bytes.byteLength;

  if (!size || size > MAX_VERSION_PDF_BYTES) {
    throw new Error(
      'Each protected version PDF must be non-empty and at most 8 MiB. ' +
      'Reduce the PDF size or select a smaller page range.'
    );
  }

  const target = ref(
    storage,
    `archive_versions/${privateArchiveId}/${crypto.randomUUID()}.pdf`
  );

  await uploadBytes(target, bytes, {
    contentType: 'application/pdf'
  });

  // Store an application route, NOT a Firebase download-token URL.
  const params = new URLSearchParams({
    bucket: target.bucket,
    path: target.fullPath
  });

  return `/archive-pdf?${params.toString()}`;
}