// assessmentScoring.js

const readNumber = value => {
  if (
    value === undefined ||
    value === null ||
    (typeof value !== 'number' && typeof value !== 'string') ||
    String(value).trim() === ''
  ) {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const positiveNumber = value => {
  const number = readNumber(value);
  return number !== null && number > 0 ? number : 0;
};

export const assessmentHasSections = assessment =>
  Array.isArray(assessment?.sectionsConfig) &&
  assessment.sectionsConfig.length > 0;

// An explicitly saved choice always takes priority.
// Legacy assessments without the setting follow their category default.
export const assessmentUsesScaling = assessment => {
  if (typeof assessment?.scaleTotalTo100 === 'boolean') {
    return assessment.scaleTotalTo100;
  }

  return ['Uniform Test', 'Exam'].includes(assessment?.category);
};

// In raw mode, enabled subsections determine their section's maximum.
// Disabled/unused subsections must not affect the maximum.
export const getSectionRawFullMark = section => {
  if (!section) return 0;

  if (section.hasSubSections) {
    return (section.subSections || []).reduce(
      (sum, subsection) => sum + positiveNumber(subsection.fullMark),
      0
    );
  }

  return positiveNumber(section.fullMark);
};

export const getSectionRawTotal = (studentMarks, section) => {
  if (
    !studentMarks ||
    typeof studentMarks !== 'object' ||
    !section
  ) {
    return null;
  }

  if (!section.hasSubSections) {
    return readNumber(studentMarks[section.id]);
  }

  let total = 0;
  let hasMark = false;

  (section.subSections || []).forEach(subsection => {
    const mark = readNumber(studentMarks[subsection.id]);

    if (mark !== null) {
      total += mark;
      hasMark = true;
    }
  });

  return hasMark ? total : null;
};

export const getAssessmentFullMark = assessment => {
  if (!assessment || assessment.designatedPending === true) {
    return 0;
  }

  if (!assessmentHasSections(assessment)) {
    return positiveNumber(assessment.fullMark) || 100;
  }

  if (assessmentUsesScaling(assessment)) {
    return 100;
  }

  return assessment.sectionsConfig.reduce(
    (sum, section) => sum + getSectionRawFullMark(section),
    0
  );
};

// Returns the assessment total BEFORE deduction.
//
// Raw mode:
//   Sum only the currently configured sections/subsections.
//
// Converted mode:
//   Apply section full marks and relative section weights,
//   normalizing the combined result to a maximum of 100.
export const calculateAssessmentTotal = (studentMarks, assessment) => {
  if (assessment?.designatedPending === true) return null;

  if (!assessmentHasSections(assessment)) {
    if (
      studentMarks &&
      typeof studentMarks === 'object'
    ) {
      let total = 0;
      let hasMark = false;

      Object.values(studentMarks).forEach(value => {
        const mark = readNumber(value);

        if (mark !== null) {
          total += mark;
          hasMark = true;
        }
      });

      return hasMark ? total : null;
    }

    return readNumber(studentMarks);
  }

  if (!studentMarks || typeof studentMarks !== 'object') {
    return null;
  }

  const sections = assessment.sectionsConfig;

  if (!assessmentUsesScaling(assessment)) {
    let total = 0;
    let hasMark = false;

    sections.forEach(section => {
      const sectionTotal = getSectionRawTotal(studentMarks, section);

      if (sectionTotal !== null) {
        total += sectionTotal;
        hasMark = true;
      }
    });

    return hasMark ? total : null;
  }

  const totalWeight = sections.reduce(
    (sum, section) => sum + positiveNumber(section.weight),
    0
  );

  if (totalWeight <= 0) return null;

  let total = 0;
  let hasMark = false;

  sections.forEach(section => {
    const sectionTotal = getSectionRawTotal(studentMarks, section);
    const fullMark = positiveNumber(section.fullMark);
    const weight = positiveNumber(section.weight);

    if (sectionTotal !== null && fullMark > 0) {
      total += (sectionTotal / fullMark) * weight;
      hasMark = true;
    }
  });

  return hasMark ? (total / totalWeight) * 100 : null;
};

// Returns the final total AFTER deduction.
// Deduction uses the selected total's units:
// raw marks when conversion is off, points out of 100 when it is on.
export const getAssessmentStudentTotal = (assessment, studentId) => {
  const marks = assessment?.marks || {};
  const total = calculateAssessmentTotal(
    marks[studentId],
    assessment
  );

  if (total === null) return null;

  const deduction = readNumber(marks[`${studentId}_deduction`]) ?? 0;

  return total - deduction;
};

// Up to one decimal place, without unnecessary trailing ".0".
export const formatAssessmentMark = value => {
  const number = readNumber(value);

  return number === null
    ? '-'
    : String(Number(number.toFixed(1)));
};