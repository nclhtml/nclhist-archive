import React from 'react';

// Change this version string (e.g., to "v1.1") to force the modal to show again for everyone
export const updateVersion = "v1.1";

export const UpdateContent = () => {
  return (
    <div className="space-y-3 text-sm text-slate-700">
      <p className="font-bold text-base text-slate-900">Welcome to the latest version!</p>
      <p>A few things have changed in this update:</p>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong className="text-red-600">Important:</strong> Only one device can be logged in at a time.</li>
        <li>All question sets are now defaulted to be viewed in full-question mode for a more succinct viewing experience.</li>
        <li>You can now save question sets as "Favourite" or "Done" items. You can also manage these in the Dashboard tab.</li>
        <li><strong>New Tab - Saved List:</strong>
          <ul className="list-[circle] pl-5 mt-1 space-y-1 text-slate-600">
            <li><em>DSE List:</em> Full papers are viewable and downloadable (will be unlocked later).</li>
            <li><em>Favourite List:</em> Review your saved favourite items.</li>
            <li><em>Done List:</em> Review your completed items.</li>
          </ul>
        </li>
        <li><strong>Report Function:</strong> If you find any problems in the question sets, answers, or student samples, you can now report the issues directly to the admins.</li>
        <li>Tags for the question sets are now disabled for students to prevent revealing the question types or answers prematurely.</li>
      </ul>
      <p className="pt-2 text-xs text-slate-500 italic">
        Thank you for using the History Archive!
      </p>
    </div>
  );
};