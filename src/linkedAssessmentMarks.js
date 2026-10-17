import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer
} from 'firebase/firestore';

import { db } from './firebase.js';

// Deliberately strict: blank cells, null, grades and comments are not zero.
function numericMark(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const text = String(value).trim();

  if (!text) return null;

  const number = Number(text);

  return Number.isFinite(number) ? number : null;
}

function rounded(value) {
  return value === null ? null : Number(value.toFixed(1));
}

function sumKnown(values) {
  const numbers = values
    .map(numericMark)
    .filter(value => value !== null);

  return numbers.length
    ? numbers.reduce((sum, value) => sum + value, 0)
    : null;
}

function sectionRawMark(studentMarks, section) {
  if (
    !studentMarks ||
    typeof studentMarks !== 'object' ||
    Array.isArray(studentMarks)
  ) {
    return null;
  }

  if (!section.hasSubSections) {
    return numericMark(studentMarks[section.id]);
  }

  return sumKnown(
    (section.subSections || []).map(sub => studentMarks[sub.id])
  );
}

function assessmentTotal(studentMarks, assessment) {
  const scalar = numericMark(studentMarks);

  // Historical records may contain a total only, even when the
  // assessment now has section configuration. Keep that total visible.
  if (scalar !== null) return scalar;

  if (
    !studentMarks ||
    typeof studentMarks !== 'object' ||
    Array.isArray(studentMarks)
  ) {
    return null;
  }

  const sections = Array.isArray(assessment.sectionsConfig)
    ? assessment.sectionsConfig
    : [];

  if (!sections.length) {
    return sumKnown(Object.values(studentMarks));
  }

  let total = 0;
  let hasMark = false;

  sections.forEach(section => {
    const raw = sectionRawMark(studentMarks, section);
    const maximum = numericMark(section.fullMark);
    const weight = numericMark(section.weight);

    if (
      raw !== null &&
      maximum !== null &&
      maximum > 0 &&
      weight !== null &&
      weight >= 0
    ) {
      total += (raw / maximum) * weight;
      hasMark = true;
    }
  });

  return hasMark ? total : null;
}

function collectLinkedTargets(assessment) {
  const targets = [];

  if (assessment.linkedDocId) {
    targets.push({
      link: assessment.linkedDocId,
      label: 'Main assessment'
    });
  }

  const visit = (sections, prefix = '') => {
    (Array.isArray(sections) ? sections : []).forEach(section => {
      const label = [prefix, section.name || 'Unnamed section']
        .filter(Boolean)
        .join(' / ');

      if (section.linkedDocId) {
        targets.push({
          link: section.linkedDocId,
          label
        });
      }

      visit(section.subSections, label);
    });
  };

  visit(assessment.sectionsConfig);

  return targets;
}

function describeSections(studentMarks, assessment, requestedLinks) {
  return (Array.isArray(assessment.sectionsConfig)
    ? assessment.sectionsConfig
    : []
  ).map(section => {
    const raw = sectionRawMark(studentMarks, section);

    const subSections = section.hasSubSections
      ? (section.subSections || []).map(sub => ({
          label: sub.name || 'Unnamed part',
          mark: numericMark(studentMarks?.[sub.id]),
          fullMark: numericMark(sub.fullMark)
        }))
      : [];

    const sectionLinks = [];

    const collect = current => {
      if (current?.linkedDocId) {
        sectionLinks.push(current.linkedDocId);
      }

      (current?.subSections || []).forEach(collect);
    };

    collect(section);

    return {
      label: section.name || 'Unnamed section',
      mark: rounded(raw),
      fullMark: numericMark(section.fullMark),
      linked: sectionLinks.some(link => requestedLinks.has(link)),
      subSections
    };
  });
}

/**
 * Administrator-only reader.
 *
 * Finds exact archive identities and their actual child identities.
 * Never splits IDs at an arbitrary underscore.
 *
 * Returns one record per assessment/student, even when several
 * sections link to the same archive.
 */
export async function loadLinkedAssessmentMarks(archiveId) {
  if (typeof archiveId !== 'string' || !archiveId) {
    throw new Error('A valid archive record is required.');
  }

  const [
    archiveSnapshot,
    assessmentsSnapshot,
    studentsSnapshot
  ] = await Promise.all([
    getDocFromServer(doc(db, 'archives', archiveId)),
    getDocsFromServer(collection(db, 'assessments')),
    getDocsFromServer(collection(db, 'students'))
  ]);

  if (!archiveSnapshot.exists()) {
    throw new Error('This archive record no longer exists.');
  }

  const archive = archiveSnapshot.data();

  const requestedLinks = new Set([
    archiveId,
    ...(archive.subQuestions || []).map(
      child => `${archiveId}_${child.id}`
    )
  ]);

  const students = new Map(
    studentsSnapshot.docs.map(snapshot => [
      snapshot.id,
      {
        ...snapshot.data(),
        id: snapshot.id
      }
    ])
  );

  const records = [];

  assessmentsSnapshot.docs.forEach(snapshot => {
    const assessment = snapshot.data();

    const matchedTargets = collectLinkedTargets(assessment).filter(
      target => requestedLinks.has(target.link)
    );

    if (!matchedTargets.length) return;

    const marks = assessment.marks;

    if (
      !marks ||
      typeof marks !== 'object' ||
      Array.isArray(marks)
    ) {
      return;
    }

    const hasSections =
      Array.isArray(assessment.sectionsConfig) &&
      assessment.sectionsConfig.length > 0;

    const maximum = hasSections
      ? 100
      : numericMark(assessment.fullMark);

    const assignedClasses = Array.isArray(assessment.classes)
      ? assessment.classes
      : assessment.className
        ? [assessment.className]
        : [];

    Object.entries(marks).forEach(([studentId, studentMarks]) => {
      // These are companion fields, not student mark records.
      if (
        studentId.endsWith('_deduction') ||
        studentId.endsWith('_comment')
      ) {
        return;
      }

      const total = assessmentTotal(studentMarks, assessment);

      const sections = describeSections(
        studentMarks,
        assessment,
        requestedLinks
      );

      const hasSectionMark = sections.some(
        section => section.mark !== null
      );

      if (total === null && !hasSectionMark) return;

      const deduction =
        numericMark(marks[`${studentId}_deduction`]) ?? 0;

      const student = students.get(studentId);

      // Do not silently discard a historical mark merely because
      // its student profile was subsequently removed.
      const className = student?.className || (
        assignedClasses.length === 1
          ? assignedClasses[0]
          : assignedClasses.join(', ') || 'Unknown historical class'
      );

      records.push({
        id: `${snapshot.id}:${studentId}`,
        assessmentId: snapshot.id,
        studentId,
        assessmentName: assessment.name || 'Unnamed assessment',
        term: assessment.term || '',
        category: assessment.category || '',
        className,
        classNumber: student?.classNumber ?? '',
        studentName:
          student?.englishName ||
          student?.chineseName ||
          `Historical student: ${studentId}`,
        missingStudentProfile: !student,
        mark: total === null
          ? null
          : rounded(total - deduction),
        fullMark: maximum,
        deduction,
        hasSections,
        totalOnly:
          hasSections &&
          numericMark(studentMarks) !== null,
        matchedLinks: [...new Set(
          matchedTargets.map(target => target.label)
        )],
        sections
      });
    });
  });

  records.sort((a, b) =>
    String(a.className).localeCompare(String(b.className)) ||
    String(a.classNumber).localeCompare(
      String(b.classNumber),
      undefined,
      { numeric: true }
    ) ||
    String(a.studentName).localeCompare(String(b.studentName)) ||
    String(a.term).localeCompare(String(b.term)) ||
    String(a.assessmentName).localeCompare(String(b.assessmentName))
  );

  return records;
}