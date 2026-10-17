function numericMark(value) {
  if (
    typeof value !== 'string' &&
    typeof value !== 'number'
  ) {
    return null;
  }

  const text = String(value).trim();

  if (!text) return null;

  const number = Number(text);

  return Number.isFinite(number) ? number : null;
}

function positive(value) {
  const number = numericMark(value);
  return number !== null && number > 0;
}

function hasValidConfiguration(item) {
  if (item.designatedPending === true) return false;

  const sections = Array.isArray(item.sectionsConfig)
    ? item.sectionsConfig
    : [];

  if (!sections.length) {
    return positive(item.fullMark);
  }

  if (!positive(item.paperFullMark)) return false;

  return sections.every(section => {
    const weight = numericMark(section.weight);

    if (
      !section.id ||
      !String(section.name || '').trim() ||
      !positive(section.fullMark) ||
      weight === null ||
      weight < 0
    ) {
      return false;
    }

    if (!section.hasSubSections) return true;

    return (
      Array.isArray(section.subSections) &&
      section.subSections.length > 0 &&
      section.subSections.every(sub =>
        sub.id &&
        String(sub.name || '').trim() &&
        positive(sub.fullMark)
      )
    );
  });
}

function containsNumericStudentMark(value, item) {
  // Zero is valid. Blank strings and null are not.
  if (numericMark(value) !== null) return true;

  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return false;
  }

  const sections = Array.isArray(item.sectionsConfig)
    ? item.sectionsConfig
    : [];

  if (!sections.length) {
    return Object.values(value).some(
      mark => numericMark(mark) !== null
    );
  }

  return sections.some(section =>
    section.hasSubSections
      ? (section.subSections || []).some(
          sub => numericMark(value[sub.id]) !== null
        )
      : numericMark(value[section.id]) !== null
  );
}

/**
 * Defensive DISPLAY check only.
 * The backend additionally verifies that marks belong to actual students.
 *
 * There is intentionally no administrator exception.
 */
export function dashboardItemCanAppear(item) {
  if (!item || item.designatedPending === true) return false;

  // Preserve existing behaviour for ordinary, non-common assessments.
  if (!item.designatedSource) return true;

  if (!hasValidConfiguration(item)) return false;

  const marks = item.marks;

  if (
    !marks ||
    typeof marks !== 'object' ||
    Array.isArray(marks)
  ) {
    return false;
  }

  return Object.entries(marks).some(([key, value]) => {
    // Companion metadata is not a student's entered mark.
    if (
      key.endsWith('_comment') ||
      key.endsWith('_deduction')
    ) {
      return false;
    }

    return containsNumericStudentMark(value, item);
  });
}