import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth } from './firebase.js';

const ACCESS_POLICY_VERSION = 2;

const catalogueRequest = httpsCallable(
  getFunctions(auth.app, 'us-central1'),
  'archiveCatalogue',
  { timeout: 120000 }
);

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

// Returns the documents AND the server's access context.
// No global cache: never reuse another account's permissions.
export async function loadArchiveAccess({
  effectiveEmail = '',
  ids = null,
  linkedIds = null
} = {}) {
  const signedInUser = auth.currentUser;

  if (!signedInUser) {
    throw new Error('Please sign in before loading archive documents.');
  }

  if (ids !== null && linkedIds !== null) {
    throw new Error('Use either ids or linkedIds, not both.');
  }

  const requested = linkedIds !== null ? linkedIds : ids;
  const requestField = linkedIds !== null ? 'linkedIds' : 'ids';

  if (
    requested !== null &&
    (
      !Array.isArray(requested) ||
      requested.some(id => typeof id !== 'string' || !id)
    )
  ) {
    throw new Error('Invalid archive document request.');
  }

  const requestedIds = requested === null
    ? null
    : [...new Set(requested)];

  const expectedEmail = cleanEmail(
    effectiveEmail || signedInUser.email
  );

  const groups = requestedIds === null
    ? [null]
    : requestedIds.length === 0
      ? [[]]
      : Array.from(
        { length: Math.ceil(requestedIds.length / 500) },
        (_, index) => requestedIds.slice(index * 500, (index + 1) * 500)
      );

  const records = new Map();
  let accessContext = null;

  for (const group of groups) {
    const response = await catalogueRequest({
      effectiveEmail: expectedEmail,
      [requestField]: group
    });

    if (auth.currentUser?.uid !== signedInUser.uid) {
      throw new Error('The signed-in account changed. Reload the page.');
    }

    const data = response.data;

    if (data?.policyVersion !== ACCESS_POLICY_VERSION) {
      throw new Error(
        'The archive backend is out of date. ' +
        'Deploy archiveCatalogue and archiveVersionPdf before using this frontend.'
      );
    }

    if (cleanEmail(data.effectiveEmail) !== expectedEmail) {
      throw new Error('The archive response belongs to a different account.');
    }

    if (!Array.isArray(data.archives) || !data.accessContext) {
      throw new Error('The server returned an invalid archive response.');
    }

    accessContext = data.accessContext;

    data.archives.forEach(record => {
      if (
        !record ||
        typeof record.id !== 'string' ||
        !record.id ||
        record.archiveAccess?.policyVersion !== ACCESS_POLICY_VERSION ||
        !Array.isArray(record.archiveAccess.childIds)
      ) {
        throw new Error('The server returned invalid document permissions.');
      }

      records.set(record.id, record);
    });
  }

  return {
    archives: [...records.values()],
    accessContext
  };
}

// Preserve the existing array-returning API for Marks and Dashboard.
export async function loadAccessibleArchives(options = {}) {
  const result = await loadArchiveAccess(options);
  return result.archives;
}

// Presentation helper only.
// Access is calculated by the server, not from URL parameters,
// browser tier calculations, or a manually supplied document ID.
export function getIncomingArchiveAccess({
  parent,
  child = null,
  user
}) {
  const denied = {
    allowed: false,
    hasFullAccess: false,
    isDseViewOnly: false
  };

  if (!parent || !user?.isAuthorized) return denied;

  const access = parent.archiveAccess;

  if (
    access?.policyVersion !== ACCESS_POLICY_VERSION ||
    !Array.isArray(access.childIds)
  ) {
    return denied;
  }

  const childAllowed = child
    ? access.childIds.includes(String(child.id))
    : access.childIds.length > 0;

  return {
    allowed: child
      ? childAllowed
      : access.full === true || childAllowed,
    hasFullAccess: access.full === true,
    isDseViewOnly: access.isDseViewOnly === true
  };
}