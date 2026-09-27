import {
    collection,
    getDocsFromServer,
    query,
    where
} from 'firebase/firestore';

import { db } from './firebase';
import { loadAccessibleArchives } from './archiveAccessClient.js';

// Load assessments for ONE teaching group.
// Support both the newer "classes" array and the older "className" field.
export async function loadClassAssessments(className) {
    if (!className) return [];

    const [arraySnapshot, legacySnapshot] = await Promise.all([
        getDocsFromServer(
            query(
                collection(db, 'assessments'),
                where('classes', 'array-contains', className)
            )
        ),
        getDocsFromServer(
            query(
                collection(db, 'assessments'),
                where('className', '==', className)
            )
        )
    ]);

    const assessmentsById = new Map();

    [...arraySnapshot.docs, ...legacySnapshot.docs].forEach(snapshot => {
        assessmentsById.set(snapshot.id, {
            ...snapshot.data(),
            id: snapshot.id
        });
    });

    return [...assessmentsById.values()];
}

// Includes deleted students so Record can still show retained records.
export async function loadClassStudents(className) {
    if (!className) return [];

    const snapshot = await getDocsFromServer(
        query(
            collection(db, 'students'),
            where('className', '==', className)
        )
    );

    return snapshot.docs.map(student => ({
        ...student.data(),
        id: student.id
    }));
}

// Pass exact saved links to the server.
// The server resolves parent/child IDs and applies the same version
// policy as the archive page.
export async function loadLinkedArchives(
    assessments,
    effectiveEmail = ''
) {
    const linkedIds = new Set();

    const addLink = value => {
        if (typeof value === 'string' && value) {
            linkedIds.add(value);
        }
    };

    (assessments || []).forEach(assessment => {
        addLink(assessment.linkedDocId);

        (assessment.sectionsConfig || []).forEach(section => {
            addLink(section.linkedDocId);
        });
    });

    if (linkedIds.size === 0) return [];

    return loadAccessibleArchives({
        effectiveEmail,
        linkedIds: [...linkedIds]
    });
}

export function expandArchiveDocuments(archives) {
    return archives.flatMap(archive => [
        {
            ...archive,
            linkMode: 'full'
        },
        ...(archive.subQuestions || []).map(subQuestion => ({
            ...archive,
            id: `${archive.id}_${subQuestion.id}`,
            title: `${archive.title} Q${subQuestion.label}`,
            linkMode: 'sub'
        }))
    ]);
}

// Requested when opening the attachment picker or recommendations.
// Unlike a direct Firestore collection read, this returns only records
// permitted by the archive access service.
export async function loadArchiveCatalogue(effectiveEmail = '') {
    return loadAccessibleArchives({
        effectiveEmail
    });
}