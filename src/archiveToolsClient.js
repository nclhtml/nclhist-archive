import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth } from './firebase.js';

const request = httpsCallable(
    getFunctions(auth.app, 'us-central1'),
    'archiveTools',
    { timeout: 120000 }
);

export async function archiveTool(body) {
    const actualUser = auth.currentUser;

    if (!actualUser) {
        throw new Error('Please sign in again.');
    }

    const response = await request(body);

    if (auth.currentUser?.uid !== actualUser.uid) {
        throw new Error('The signed-in account changed. Reload the page.');
    }

    return response.data;
}