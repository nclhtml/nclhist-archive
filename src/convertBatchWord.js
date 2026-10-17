import { auth } from './firebase.js';

export async function convertBatchWord(file) {
  const endpoint = String(
    import.meta.env.VITE_DOCX_CONVERTER_URL || ''
  ).replace(/\/+$/, '');

  if (!endpoint) {
    throw new Error(
      'DOCX conversion is not configured. ' +
      'Set VITE_DOCX_CONVERTER_URL and rebuild the website.'
    );
  }

  if (!endpoint.startsWith('https://')) {
    throw new Error('The Word conversion endpoint must use HTTPS.');
  }

  const user = auth.currentUser;

  if (!user) throw new Error('Please sign in again.');

  if (!file || !/\.docx$/i.test(file.name)) {
    throw new Error('Select a .docx file.');
  }

  if (!file.size || file.size > 20 * 1024 * 1024) {
    throw new Error('The Word file must be non-empty and at most 20 MiB.');
  }

  const body = new FormData();
  body.append('file', file, file.name);

  const token = await user.getIdToken();
  const controller = new AbortController();

  const timer = window.setTimeout(() => controller.abort(), 145000);

  try {
    const response = await fetch(`${endpoint}/convert`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      body,
      signal: controller.signal
    });

    if (!response.ok) {
      let message = `Word conversion failed (${response.status}).`;

      try {
        const result = await response.json();
        message = result.error || message;
      } catch {
        // Keep the HTTP status message.
      }

      throw new Error(message);
    }

    const blob = await response.blob();

    if (
      !blob.size ||
      blob.size > 32 * 1024 * 1024 ||
      !String(blob.type).toLowerCase().includes('application/pdf')
    ) {
      throw new Error('The converter returned an unsupported PDF response.');
    }

    return new File(
      [blob],
      file.name.replace(/\.docx$/i, '') + '.pdf',
      {
        type: 'application/pdf',
        lastModified: Date.now()
      }
    );
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(
        'Word conversion timed out. Try a smaller document or upload a PDF.'
      );
    }

    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}