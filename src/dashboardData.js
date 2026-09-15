import {
    collection,
    doc,
    getDocFromServer,
    getDocsFromServer,
    query,
    where
} from 'firebase/firestore';

import { db } from './firebase';

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

// Preserve your existing parentId_subQuestionId convention.
function getParentArchiveId(linkedDocId) {
    if (!linkedDocId) return '';
    return String(linkedDocId).split('_')[0];
}

// Load only archives linked to this class's assessments.
export async function loadLinkedArchives(assessments) {
    const parentIds = new Set();

    const addLink = linkedDocId => {
        const parentId = getParentArchiveId(linkedDocId);
        if (parentId) parentIds.add(parentId);
    };

    assessments.forEach(assessment => {
        addLink(assessment.linkedDocId);

        (assessment.sectionsConfig || []).forEach(section => {
            addLink(section.linkedDocId);
        });
    });

    const ids = [...parentIds];
    const archives = [];

    // Avoid starting hundreds of separate document requests at once.
    for (let index = 0; index < ids.length; index += 10) {
        const snapshots = await Promise.all(
            ids.slice(index, index + 10).map(id =>
                getDocFromServer(doc(db, 'archives', id))
            )
        );

        snapshots.forEach(snapshot => {
            if (snapshot.exists()) {
                archives.push({
                    ...snapshot.data(),
                    id: snapshot.id
                });
            }
        });
    }

    return archives;
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

// This broader read is ONLY requested when opening the attachment
// picker or generating recommendations.
export async function loadArchiveCatalogue() {
    const snapshot = await getDocsFromServer(
        collection(db, 'archives')
    );

    return snapshot.docs.map(archive => ({
        ...archive.data(),
        id: archive.id
    }));
}