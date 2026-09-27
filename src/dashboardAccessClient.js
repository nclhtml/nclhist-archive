import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth } from './firebase.js';

const classRequest = httpsCallable(
  getFunctions(auth.app, 'us-central1'),
  'archiveClassAssessments',
  { timeout: 120000 }
);

export async function loadAssignedClassAssessments(
  className,
  effectiveEmail
) {
  const signedInUser = auth.currentUser;

  if (!signedInUser) {
    throw new Error('Please sign in before loading the dashboard.');
  }

  const expectedEmail = String(
    effectiveEmail || signedInUser.email || ''
  ).trim().toLowerCase();

  const response = await classRequest({
    effectiveEmail: expectedEmail,
    className
  });

  if (auth.currentUser?.uid !== signedInUser.uid) {
    throw new Error('The signed-in account changed. Reload the dashboard.');
  }

  const data = response.data;

  if (
    data?.effectiveEmail !== expectedEmail ||
    data?.className !== className ||
    !Array.isArray(data?.assessments)
  ) {
    throw new Error('The server returned an invalid class response.');
  }

  return data.assessments;
}