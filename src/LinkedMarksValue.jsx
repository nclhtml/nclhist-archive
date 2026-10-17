import React from 'react';

function display(value) {
  return value === null || value === undefined
    ? '—'
    : Number(value).toFixed(1);
}

export default function LinkedMarksValue({ record }) {
  const mainLinked = record.matchedLinks?.includes('Main assessment');

  // A section-linked question set must not display other questions
  // or the whole examination total.
  if (!mainLinked) {
    const linkedSections = (record.sections || []).filter(
      section => section.linked
    );

    return (
      <div className="space-y-2 text-left">
        {linkedSections.length ? (
          linkedSections.map((section, index) => (
            <div
              key={index}
              className="rounded border border-teal-300 bg-teal-50 p-2 text-xs"
            >
              <div className="font-bold text-slate-700">
                {section.label}
              </div>

              <div className="mt-1 text-slate-600">
                {display(section.mark)}
                {section.fullMark !== null && (
                  <> / {section.fullMark}</>
                )}
              </div>

              {section.subSections?.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-teal-200 pt-2">
                  {section.subSections.map((sub, subIndex) => (
                    <div key={subIndex} className="text-slate-600">
                      {sub.label}: {display(sub.mark)}
                      {sub.fullMark !== null && (
                        <> / {sub.fullMark}</>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        ) : (
          <span className="text-xs font-normal text-slate-500">
            No marks were recorded for this linked component.
          </span>
        )}
      </div>
    );
  }

  // A genuinely main-linked assessment retains its own total.
  return (
    <div className="font-bold text-teal-700">
      {display(record.mark)}
      {record.fullMark !== null &&
        record.fullMark !== undefined && (
          <> / {record.fullMark}</>
        )}
    </div>
  );
}