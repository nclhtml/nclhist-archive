import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BookOpen, Plus, Save, Calendar, Users,
  Loader2, FileText, CheckCircle,
  PlusCircle, Trash2, ClipboardPaste, FormInput, Calculator,
  Layers, X, BarChart2, Copy, Eye, EyeOff, Settings, Edit2, Edit,
  ChevronUp, ChevronDown, MinusCircle, Percent, Info,
  Link as LinkIcon, ExternalLink, Download, ArrowLeft, Tag, Edit3,
  LayoutGrid, GripVertical, AlertTriangle, ChevronLeft
} from 'lucide-react';
import {
  collection, getDocs, doc, setDoc, updateDoc,
  addDoc, deleteDoc, query, where, getDoc,
  getDocsFromServer, getDocFromServer, onSnapshot, runTransaction
} from 'firebase/firestore';
import { db } from './firebase';
import { loadAccessibleArchives } from './archiveAccessClient.js';
import { useAuth } from './main.jsx';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import { VersionPdfInline } from './VersionPdf.jsx';
import { loadLinkedAssessmentMarks } from './linkedAssessmentMarks.js';
import LinkedMarksValue from './LinkedMarksValue.jsx';
import useMarksTermPreference from './useMarksTermPreference.js';
import { DesignatedDocumentLinker } from './DesignatedItemTools.jsx';
import {
  assessmentUsesScaling,
  getSectionRawFullMark,
  getAssessmentFullMark,
  calculateAssessmentTotal
} from './assessmentScoring.js';

// ============================================================================
// SMALL HELPERS
// ============================================================================
function getMarksAttachmentUrl(parent, isAnswer, language) {
  if (!parent) return '';

  const english = isAnswer
    ? parent.answerFileUrl || ''
    : parent.fileUrl || '';

  const chinese = isAnswer
    ? parent.answerFileUrlChi || ''
    : parent.fileUrlChi || '';

  return language === 'zh'
    ? chinese || english
    : english || chinese;
}

function MarksPdfAttachment({ fileUrl, title }) {
  if (!fileUrl) {
    return (
      <div className="flex items-center justify-center h-full p-6 text-slate-500">
        No PDF attached for this view.
      </div>
    );
  }

  const renderPdf = url => (
    <iframe
      src={`${url}#view=Fit&pagemode=thumbs&page=1&zoom=page-fit`}
      className="w-full h-full border-0"
      title={title}
    />
  );

  if (fileUrl.startsWith('/archive-pdf?')) {
    return (
      <VersionPdfInline
        key={fileUrl}
        fileUrl={fileUrl}
        renderViewer={renderPdf}
      />
    );
  }

  return renderPdf(fileUrl);
}

const generateId = () => Math.random().toString(36).substr(2, 9);

// Reveal the highest two positions, including ties at the cutoff.
const marksIsTopTwo = (value, values) => {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    !Number.isFinite(Number(value))
  ) {
    return false;
  }

  const scores = values
    .filter(score =>
      score !== null &&
      score !== undefined &&
      score !== '' &&
      Number.isFinite(Number(score))
    )
    .map(Number)
    .sort((a, b) => b - a);

  if (!scores.length) return false;

  const cutoff = scores[Math.min(1, scores.length - 1)];

  return Number(value) >= cutoff;
};

const MARKS_DEFAULT_CATEGORIES = [
  'Assignments',
  'Quizzes',
  'Uniform Test',
  'Exam',
  'RAC',
  'Others'
];

const MARKS_DEFAULT_MULTI_CATEGORIES = [
  'Uniform Test',
  'Exam'
];

const SUPER_ADMIN_EMAIL = 'clng@ktls.edu.hk';

const marksUniqueNames = values =>
  [...new Set(
    (Array.isArray(values) ? values : [])
      .filter(value => typeof value === 'string' && value.trim() !== '')
  )];

// Do not trim or remove invisible characters from class identities.
const marksClassCategoryKey = className =>
  `class:${encodeURIComponent(className)}`;

const marksAssessmentBelongsToClass = (assessment, className) =>
  Array.isArray(assessment.classes)
    ? assessment.classes.includes(className)
    : assessment.className === className;

const cleanClassName = name => String(name || '').replace(/\u200B/g, '');

const marksValueFilled = value =>
  value !== undefined && value !== null && String(value).trim() !== '';

const marksCountEntered = (marks, studentIds) =>
  studentIds.filter(id => {
    const value = marks?.[id];
    if (value && typeof value === 'object') {
      return Object.values(value).some(marksValueFilled);
    }
    return marksValueFilled(value);
  }).length;

const sortMarksAssessments = (a, b) => {
  const difference = (a.order ?? -1) - (b.order ?? -1);
  if (difference) return difference;
  return (Date.parse(b.date || '') || 0) - (Date.parse(a.date || '') || 0);
};

// Learning Attitude calculations are now separate buttons, not presets.
const LEGACY_LA_PRESET_IDS = ['la-hw-preset', 'la-lesson-preset'];

const isLegacyLearningAttitudePreset = preset =>
  LEGACY_LA_PRESET_IDS.includes(preset?.id) ||
  String(preset?.name || '').startsWith('Learning Attitude');

const marksVisiblePresets = (allPresets, email) =>
  (Array.isArray(allPresets) ? allPresets : [])
    .filter(preset => !isLegacyLearningAttitudePreset(preset))
    .filter(preset =>
      email === SUPER_ADMIN_EMAIL ||
      preset.isShared ||
      preset.owner === email
    );

const describePresetFormula = preset => {
  if (!preset) return '';
  if (preset.name === 'JS Geography') {
    return 'Score = (Assignments + Quizzes) ÷ their full marks × 50 + Uniform Test ÷ full mark × 50';
  }
  const parts = Object.entries(preset.weights || {})
    .filter(([, weight]) => Number(weight) > 0)
    .map(([category, weight]) => `${category} × ${weight}%`);
  return parts.length ? `Score = ${parts.join(' + ')}` : 'No weights configured.';
};

const LA_HOMEWORK_FORMULA =
  'Learning Attitude (Homework) = round( total Assignments ÷ total full marks × 5 )';
const LA_LESSON_FORMULA =
  'Learning Attitude (Lesson) = 4 + 1 (if Assignments > 90%) − floor(records ÷ 2); max 3 if Assignments < 60%; range 0–5';

// Quick section presets for multi-section items.
const buildDbq = (number, weight) => ({
  id: generateId(),
  name: `DBQ ${number}`,
  groupName: 'DBQ',
  fullMark: 15,
  weight,
  hasSubSections: true,
  subSections: [
    { id: generateId(), name: 'a', fullMark: '' },
    { id: generateId(), name: 'b', fullMark: '' },
    { id: generateId(), name: 'c', fullMark: 8 }
  ]
});

const buildEssay = (count, fullMark, weight) => ({
  id: generateId(),
  name: 'Essay',
  groupName: 'Essay',
  fullMark,
  weight,
  hasSubSections: true,
  subSections: Array.from({ length: count }, (_, index) => ({
    id: generateId(),
    name: String(index + 1),
    fullMark: 25
  }))
});

const SECTION_PRESETS = [
  {
    label: '2 DBQ',
    paperFullMark: 30,
    build: () => [buildDbq(1, 50), buildDbq(2, 50)]
  },
  {
    label: '2 DBQ + 1 Essay',
    paperFullMark: 55,
    build: () => [buildDbq(1, 30), buildDbq(2, 30), buildEssay(2, 25, 40)]
  },
  {
    label: '4 DBQ + 2 Essay',
    paperFullMark: 110,
    build: () => [
      buildDbq(1, 15),
      buildDbq(2, 15),
      buildDbq(3, 15),
      buildDbq(4, 15),
      buildEssay(5, 50, 40)
    ]
  }
];

const newDefaultSection = () => ({
  id: generateId(),
  name: 'Paper 1',
  fullMark: 100,
  weight: 100,
  hasSubSections: false,
  subSections: []
});

// Read every term for ONE class, supporting both current and legacy records.
async function readMarksClassAssessments(className) {
  const [sharedSnapshot, legacySnapshot] = await Promise.all([
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

  const records = new Map();

  [...sharedSnapshot.docs, ...legacySnapshot.docs].forEach(snapshot => {
    const assessment = {
      ...snapshot.data(),
      id: snapshot.id
    };

    if (marksAssessmentBelongsToClass(assessment, className)) {
      records.set(snapshot.id, assessment);
    }
  });

  return [...records.values()];
}

function getMarksClassCategoryConfig(
  settings,
  className,
  classAssessments,
  keepSavedEmptyCategories = true
) {
  const saved =
    settings?.byClass?.[marksClassCategoryKey(className)] || {};

  const usedCategories = marksUniqueNames(
    classAssessments.map(assessment => assessment.category)
  );

  const list = marksUniqueNames([
    ...MARKS_DEFAULT_CATEGORIES,
    ...(keepSavedEmptyCategories
      ? marksUniqueNames(saved.list)
      : []),
    ...usedCategories
  ]);

  const savedMulti = Array.isArray(saved.multiSection)
    ? saved.multiSection
    : (
      Array.isArray(settings?.multiSection)
        ? settings.multiSection
        : MARKS_DEFAULT_MULTI_CATEGORIES
    );

  const multiSection = marksUniqueNames([
    ...MARKS_DEFAULT_MULTI_CATEGORIES,
    ...savedMulti
  ]).filter(category => list.includes(category));

  return {
    className,
    list,
    multiSection
  };
}

const getDefaultTerms = (className) => {
  if (!className) return ['Term 1', 'Term 2'];
  if (className.includes('HIST EMI') || className.includes('HIST CMI')) {
    return ['S4 Term 1', 'S4 Term 2', 'S5 Term 1', 'S5 Term 2', 'S6'];
  }
  return ['Term 1', 'Term 2'];
};

// ============================================================================
// SHARED STYLES
// ============================================================================
const MARKS_CSS = `
.marks-page { box-sizing: border-box; font-size: 14px; }
.marks-page *, .marks-page *::before, .marks-page *::after { box-sizing: border-box; }
.marks-page button { touch-action: manipulation; }
.marks-page button:focus-visible, .marks-page select:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }

.mk-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mk-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #64748b; }
.mk-input { height: 34px; min-width: 0; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; padding: 0 10px; font-size: 13px; color: #0f172a; }
.mk-input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.15); }
.mk-input:disabled { background: #f1f5f9; color: #94a3b8; }
textarea.mk-input { height: auto; padding: 8px 10px; }

.mk-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 34px; padding: 0 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; color: #334155; font-size: 13px; font-weight: 600; line-height: 1; white-space: nowrap; transition: background-color .15s, border-color .15s, color .15s; }
.mk-btn:hover:not(:disabled) { background: #f8fafc; border-color: #cbd5e1; }
.mk-btn:disabled { opacity: .45; cursor: not-allowed; }
.mk-btn svg { width: 16px; height: 16px; flex-shrink: 0; }
.mk-btn-sm { height: 28px; padding: 0 9px; font-size: 12px; border-radius: 7px; }
.mk-btn-sm svg { width: 14px; height: 14px; }
.mk-btn-icon { width: 34px; padding: 0; }
.mk-btn-sm.mk-btn-icon { width: 28px; }
.mk-btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.mk-btn-primary:hover:not(:disabled) { background: #1d4ed8; border-color: #1d4ed8; }
.mk-btn-purple { background: #7c3aed; border-color: #7c3aed; color: #fff; }
.mk-btn-purple:hover:not(:disabled) { background: #6d28d9; border-color: #6d28d9; }
.mk-btn-emerald { background: #059669; border-color: #059669; color: #fff; }
.mk-btn-emerald:hover:not(:disabled) { background: #047857; border-color: #047857; }
.mk-btn-orange { background: #ea580c; border-color: #ea580c; color: #fff; }
.mk-btn-orange:hover:not(:disabled) { background: #c2410c; border-color: #c2410c; }
.mk-btn-soft { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
.mk-btn-soft:hover:not(:disabled) { background: #dbeafe; border-color: #93c5fd; }
.mk-btn-soft-purple { background: #f5f3ff; border-color: #ddd6fe; color: #6d28d9; }
.mk-btn-soft-purple:hover:not(:disabled) { background: #ede9fe; border-color: #c4b5fd; }
.mk-btn-warn { background: #fffbeb; border-color: #fcd34d; color: #92400e; }
.mk-btn-warn:hover:not(:disabled) { background: #fef3c7; border-color: #fbbf24; }
.mk-btn-ok { background: #f0fdf4; border-color: #86efac; color: #166534; }
.mk-btn-ok:hover:not(:disabled) { background: #dcfce7; border-color: #4ade80; }
.mk-btn-danger { color: #dc2626; }
.mk-btn-danger:hover:not(:disabled) { background: #fef2f2; border-color: #fecaca; }
.mk-btn-ghost { border-color: transparent; background: transparent; }

.mk-seg { display: inline-flex; padding: 2px; gap: 2px; border: 1px solid #e2e8f0; border-radius: 9px; background: #f1f5f9; }
.mk-seg button { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 7px; font-size: 12px; font-weight: 600; color: #64748b; white-space: nowrap; }
.mk-seg button svg { width: 14px; height: 14px; }
.mk-seg button.is-active { background: #fff; color: #1d4ed8; box-shadow: 0 1px 2px rgba(15,23,42,.1); }
.mk-seg button:disabled { opacity: .55; cursor: not-allowed; }

.mk-divider { width: 1px; height: 22px; background: #e2e8f0; margin: 0 2px; }
.mk-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; }
.mk-section-title { font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
.mk-help { font-size: 12px; color: #64748b; line-height: 1.5; }

.mk-chip { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 999px; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 600; white-space: nowrap; }
.mk-chip svg { width: 12px; height: 12px; }
.mk-chip-blue { background: #eff6ff; color: #1d4ed8; }
.mk-chip-purple { background: #f5f3ff; color: #6d28d9; }
.mk-chip-yellow { background: #fef9c3; color: #854d0e; }
.mk-chip-green { background: #dcfce7; color: #166534; }
.mk-chip-red { background: #fee2e2; color: #991b1b; }
.mk-count { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: #e2e8f0; color: #475569; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }

.mk-dot { width: 9px; height: 9px; border-radius: 999px; flex-shrink: 0; background: #cbd5e1; display: inline-block; }
.mk-dot-done { background: #22c55e; }
.mk-dot-pending { background: #eab308; }

.mk-item { display: block; width: 100%; text-align: left; padding: 10px 12px; border: 1px solid #e2e8f0; border-left-width: 4px; border-radius: 10px; background: #fff; transition: box-shadow .15s, border-color .15s; }
.mk-item:hover { box-shadow: 0 2px 8px rgba(15,23,42,.08); }
.mk-item.is-done { border-left-color: #22c55e; }
.mk-item.is-pending { border-left-color: #eab308; }
.mk-item.is-empty { border-left-color: #cbd5e1; }
.mk-item.is-compulsory.is-pending { background: #fefce8; border-color: #fde047; border-left-color: #eab308; }
.mk-item.is-compulsory.is-done { background: #f0fdf4; border-color: #bbf7d0; border-left-color: #22c55e; }

.mk-rail-item { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; padding: 7px 8px; border-radius: 8px; border: 1px solid transparent; }
.mk-rail-item:hover { background: #f8fafc; }
.mk-rail-item.is-compulsory.is-pending { background: #fefce8; }
.mk-rail-item.is-compulsory.is-done { background: #f0fdf4; }
.mk-rail-item.is-active { background: #eff6ff; border-color: #93c5fd; }
.mk-grip { width: 14px; height: 14px; color: #cbd5e1; flex-shrink: 0; cursor: grab; }
.mk-drop-target { box-shadow: inset 0 2px 0 #3b82f6; border-radius: 8px; }

.mk-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
.mk-table thead { position: sticky; top: 0; z-index: 3; }
.mk-table th { background: #f8fafc; color: #475569; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; white-space: nowrap; text-align: center; vertical-align: bottom; }
.mk-table th .mk-sub { display: block; margin-top: 2px; font-size: 10px; font-weight: 500; text-transform: none; letter-spacing: 0; color: #94a3b8; }
.mk-table td { padding: 6px 10px; border-bottom: 1px solid #f1f5f9; white-space: nowrap; text-align: center; color: #334155; }
.mk-table tbody tr { background: #fff; }
.mk-table tbody tr:hover { background: #f8fafc; }
.mk-table .mk-left { text-align: left; }
.mk-table .mk-sticky-no { position: sticky; left: 0; z-index: 1; width: 52px; min-width: 52px; background: inherit; }
.mk-table .mk-sticky-name { position: sticky; left: 52px; z-index: 1; min-width: 190px; text-align: left; background: inherit; border-right: 1px solid #e2e8f0; }
.mk-table thead .mk-sticky-no, .mk-table thead .mk-sticky-name { z-index: 4; background: #f8fafc; }
.mk-table .mk-sep { border-left: 1px solid #e2e8f0; }
.mk-table .mk-group-row th { background: #f1f5f9; color: #334155; font-size: 12px; }
.mk-table tfoot td { position: sticky; bottom: 0; z-index: 2; background: #eff6ff; border-top: 2px solid #bfdbfe; border-bottom: 0; font-size: 11px; vertical-align: top; }
.mk-table tfoot .mk-sticky-no, .mk-table tfoot .mk-sticky-name { z-index: 3; background: #eff6ff; }
.mk-table .mk-final { font-weight: 700; color: #1d4ed8; background: rgba(239,246,255,.7); }
.mk-table .mk-top { background: #fef08a; color: #713f12; font-weight: 700; }
.mk-table .mk-gap { color: #cbd5e1; }
.mk-table .mk-missing-cell { background: #fff7f7; }

.mk-cell-input { width: 64px; height: 30px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; text-align: center; font-size: 13px; color: #0f172a; }
.mk-cell-input.is-wide { width: 150px; }
.mk-cell-input.is-text { text-align: left; padding: 0 8px; }
.mk-cell-input.is-missing { background: #fff5f5; border-color: #fca5a5; border-style: dashed; }
.mk-cell-input:disabled { background: #f8fafc; color: #94a3b8; }
.mk-cell-input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.15); }

.mk-backdrop { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(15,23,42,.55); }
.mk-modal { display: flex; flex-direction: column; width: 100%; max-height: calc(100dvh - 32px); background: #fff; border-radius: 14px; box-shadow: 0 25px 50px -12px rgba(15,23,42,.35); overflow: hidden; }
.mk-modal-head { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 20px; border-bottom: 1px solid #e2e8f0; background: #fff; }
.mk-modal-head h2 { font-size: 16px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 8px; min-width: 0; }
.mk-modal-head h2 svg { width: 18px; height: 18px; flex-shrink: 0; }
.mk-modal-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 20px; }
.mk-modal-foot { flex-shrink: 0; display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; padding: 12px 20px; border-top: 1px solid #e2e8f0; background: #f8fafc; }

.mk-section-grid { display: grid; gap: 12px; grid-template-columns: minmax(0,2fr) minmax(0,1.5fr) 110px 110px; }
@media (max-width: 640px) { .mk-section-grid { grid-template-columns: minmax(0,1fr) minmax(0,1fr); } }

.mk-step { width: 26px; height: 26px; border-radius: 6px; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.mk-step-minus { background: #fee2e2; color: #b91c1c; }
.mk-step-minus:hover { background: #fecaca; }
.mk-step-plus { background: #dcfce7; color: #15803d; }
.mk-step-plus:hover { background: #bbf7d0; }

.mk-reveal-title { font-size: clamp(1.75rem, 4vw, 3.25rem); line-height: 1.15; font-weight: 800; color: #3730a3; }
.mk-reveal-card { width: min(100%, 22rem); background: #fff; border-radius: 24px; padding: 28px; box-shadow: 0 20px 40px rgba(49,46,129,.15); border: 1px solid #e0e7ff; }
.mk-reveal-num { font-size: clamp(3rem, 8vw, 5.5rem); line-height: 1; font-weight: 800; }
.mk-reveal-btn { padding: 14px 32px; border-radius: 999px; background: #4f46e5; color: #fff; font-size: clamp(1rem, 2vw, 1.3rem); font-weight: 700; box-shadow: 0 12px 24px rgba(79,70,229,.3); transition: transform .2s, background-color .2s; }
.mk-reveal-btn:hover { background: #4338ca; transform: scale(1.04); }

.mk-tab { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; border-radius: 8px; font-size: 13px; font-weight: 600; color: #475569; text-align: left; white-space: nowrap; }
.mk-tab svg { width: 16px; height: 16px; flex-shrink: 0; }
.mk-tab:hover { background: #eef2f7; }
.mk-tab.is-active { background: #fff; color: #1d4ed8; box-shadow: 0 1px 2px rgba(15,23,42,.1); }

@media (max-width: 767px) {
  .marks-page input:not([type="checkbox"]):not([type="radio"]), .marks-page select, .marks-page textarea { font-size: 16px; }
  .mk-backdrop { padding: 8px; }
  .mk-modal { max-height: calc(100dvh - 16px); }
  .mk-modal-body { padding: 14px; }
}
`;

// ============================================================================
// COMPONENT
// ============================================================================
export default function Marks() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [termCopySuccess, setTermCopySuccess] = useState(false);

  // Data State
  const [classes, setClasses] = useState([]);
  const [archivedClasses, setArchivedClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [categorySettingsState, setCategorySettingsState] = useState({
    identity: '',
    data: {},
    ready: false,
    error: ''
  });

  const [classCategoryState, setClassCategoryState] = useState({
    key: '',
    items: [],
    ready: false,
    error: ''
  });

  const [isCategorySaving, setIsCategorySaving] = useState(false);
  const categoryOperationLock = useRef(false);
  const selectedCategoryClassRef = useRef('');

  const [archives, setArchives] = useState([]);

  // Terms State
  const [termsMap, setTermsMap] = useState({});
  const [terms, setTerms] = useState([]);
  const [assessments, setAssessments] = useState([]);

  // Selection State
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Assignments');
  const [selectedAssessment, setSelectedAssessment] = useState(null);

  // 'home' = all items board, 'overview' = category table, 'item' = marks entry
  const [view, setView] = useState('home');
  const pendingSelectRef = useRef('');
  const dragIndexRef = useRef(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const [isAssessmentsLoading, setIsAssessmentsLoading] = useState(false);
  const [assessmentsError, setAssessmentsError] = useState('');
  const [isSavingAssessment, setIsSavingAssessment] = useState(false);

  // Firebase-backed preference: remembers the last viewed term per class.
  const {
    selectedTerm,
    setSelectedTerm,
    termPreferenceError
  } = useMarksTermPreference({
    user,
    selectedClass,
    availableTerms: Array.isArray(termsMap[selectedClass])
      ? termsMap[selectedClass]
      : getDefaultTerms(selectedClass),
    enabled: !isLoading && Boolean(user?.email && selectedClass)
  });

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState('general');
  const [newTermName, setNewTermName] = useState('');
  const [editingTerm, setEditingTerm] = useState(null);
  const [editTermName, setEditTermName] = useState('');

  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIsMulti, setNewCategoryIsMulti] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [editCategoryName, setEditCategoryName] = useState('');

  const categoryIdentity = JSON.stringify([
    user?.email || '',
    user?.role || ''
  ]);

  const categoryRequestKey = JSON.stringify([
    categoryIdentity,
    selectedClass
  ]);

  const categoryStateMatches =
    categorySettingsState.identity === categoryIdentity &&
    classCategoryState.key === categoryRequestKey;

  const categoryLoadError =
    (
      categorySettingsState.identity === categoryIdentity
        ? categorySettingsState.error
        : ''
    ) ||
    (
      classCategoryState.key === categoryRequestKey
        ? classCategoryState.error
        : ''
    );

  const categoriesReady = Boolean(
    selectedClass &&
    categoryStateMatches &&
    categorySettingsState.ready &&
    classCategoryState.ready &&
    !categoryLoadError
  );

  const classItemsAllTerms =
    classCategoryState.key === categoryRequestKey
      ? classCategoryState.items
      : [];

  const classCategoryConfig = useMemo(() => {
    const settings =
      categorySettingsState.identity === categoryIdentity
        ? categorySettingsState.data
        : {};

    return getMarksClassCategoryConfig(
      settings,
      selectedClass,
      classItemsAllTerms
    );
  }, [
    categorySettingsState,
    categoryIdentity,
    classItemsAllTerms,
    selectedClass
  ]);

  const categories = classCategoryConfig.list;
  const multiSectionCategories = classCategoryConfig.multiSection;

  const selectedClassInfo = [...classes, ...archivedClasses].find(
    classInfo => classInfo.name === selectedClass
  );

  const canManageClassCategories = Boolean(
    user?.isAdmin &&
    selectedClassInfo &&
    (
      user.email === SUPER_ADMIN_EMAIL ||
      selectedClassInfo.owner === user.email
    )
  );

  // Shared category settings for every administrator.
  useEffect(() => {
    if (!user?.email) return;

    setCategorySettingsState({
      identity: categoryIdentity,
      data: {},
      ready: false,
      error: ''
    });

    return onSnapshot(
      doc(db, 'settings', 'categories'),
      snapshot => {
        setCategorySettingsState({
          identity: categoryIdentity,
          data: snapshot.data() || {},
          ready: true,
          error: ''
        });
      },
      error => {
        console.error('Could not load category settings:', error);

        setCategorySettingsState({
          identity: categoryIdentity,
          data: {},
          ready: false,
          error: 'Could not load category settings. Check your connection and permissions.'
        });
      }
    );
  }, [categoryIdentity]);

  // Live list of ALL items (every term) for the selected class.
  useEffect(() => {
    let cancelled = false;

    setClassCategoryState({
      key: categoryRequestKey,
      items: [],
      ready: false,
      error: ''
    });

    if (!selectedClass || !user?.email) {
      return () => {
        cancelled = true;
      };
    }

    const results = [null, null];
    let failed = false;

    const publish = () => {
      if (
        cancelled ||
        failed ||
        results.some(result => result === null)
      ) {
        return;
      }

      const records = new Map();

      results.flat().forEach(assessment => {
        if (marksAssessmentBelongsToClass(assessment, selectedClass)) {
          records.set(assessment.id, assessment);
        }
      });

      setClassCategoryState({
        key: categoryRequestKey,
        items: [...records.values()],
        ready: true,
        error: ''
      });
    };

    const handleError = error => {
      if (cancelled) return;

      failed = true;
      console.error('Could not discover class categories:', error);

      setClassCategoryState({
        key: categoryRequestKey,
        items: [],
        ready: false,
        error: 'Could not load this class’s items. Refresh after checking your connection and permissions.'
      });
    };

    const queries = [
      query(
        collection(db, 'assessments'),
        where('classes', 'array-contains', selectedClass)
      ),
      query(
        collection(db, 'assessments'),
        where('className', '==', selectedClass)
      )
    ];

    const unsubscribe = queries.map((classQuery, index) =>
      onSnapshot(
        classQuery,
        snapshot => {
          if (cancelled) return;

          results[index] = snapshot.docs.map(item => ({
            ...item.data(),
            id: item.id
          }));

          publish();
        },
        handleError
      )
    );

    return () => {
      cancelled = true;
      unsubscribe.forEach(stop => stop());
    };
  }, [categoryRequestKey, selectedClass, user?.email]);

  useEffect(() => {
    selectedCategoryClassRef.current = selectedClass;
    pendingSelectRef.current = '';

    setSelectedCategory('Assignments');
    setEditingCategory(null);
    setNewCategoryName('');
    setNewCategoryIsMulti(false);
    setView('home');
  }, [selectedClass]);

  useEffect(() => {
    if (categoriesReady && !categories.includes(selectedCategory)) {
      setSelectedCategory('Assignments');
    }
  }, [categoriesReady, categories, selectedCategory]);

  // Add/Edit form state
  const [showAddAssessment, setShowAddAssessment] = useState(false);
  const [isEditingAssessment, setIsEditingAssessment] = useState(false);
  const [formCategory, setFormCategory] = useState('Assignments');
  const [newAssessmentName, setNewAssessmentName] = useState('');
  const [newAssessmentDate, setNewAssessmentDate] = useState(new Date().toISOString().split('T')[0]);
  const [fullMark, setFullMark] = useState(100);
  const [paperFullMark, setPaperFullMark] = useState(100);
  const [scaleTotalTo100, setScaleTotalTo100] = useState(false);
  const [formTerm, setFormTerm] = useState('');
  const [linkedDocId, setLinkedDocId] = useState('');
  const [forceMultiSection, setForceMultiSection] = useState(false);
  const [sectionsConfig, setSectionsConfig] = useState([newDefaultSection()]);
  const [selectedClassesForNew, setSelectedClassesForNew] = useState([]);

  // Marks State
  const [marksData, setMarksData] = useState({});
  const [inputMethod, setInputMethod] = useState('individual');
  const [bulkText, setBulkText] = useState('');

  // Overview & Graph Modal
  const [showOverviewModal, setShowOverviewModal] = useState(false);
  const [revealStep, setRevealStep] = useState(0);
  const [classPresetsMap, setClassPresetsMap] = useState({});

  // All Classes Modal
  const [showAllClassesModal, setShowAllClassesModal] = useState(false);
  const [allClassesStudentView, setAllClassesStudentView] = useState(true);

  // Amend Modal
  const [showAmendModal, setShowAmendModal] = useState(false);
  const [amendRows, setAmendRows] = useState([]);
  const [hasUnsavedAmendments, setHasUnsavedAmendments] = useState(false);

  // Student View
  const [studentView, setStudentView] = useState(false);
  const [showDeduct, setShowDeduct] = useState(false);

  // Term Score Calculator
  const [showTermScoreModal, setShowTermScoreModal] = useState(false);
  const [presets, setPresets] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [termScoresData, setTermScoresData] = useState([]);
  const [termResultMode, setTermResultMode] = useState('');
  const [calculatingMode, setCalculatingMode] = useState('');
  const [classPickerOpen, setClassPickerOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetWeights, setNewPresetWeights] = useState({});
  const [isSharedPreset, setIsSharedPreset] = useState(false);
  const [modalClasses, setModalClasses] = useState([]);
  const [modalTerm, setModalTerm] = useState('');

  // Document Linker
  const [showDocLinker, setShowDocLinker] = useState(false);
  const [docLinkerTarget, setDocLinkerTarget] = useState(null);
  const [docCatalogueLoading, setDocCatalogueLoading] = useState(false);
  const [docCatalogueError, setDocCatalogueError] = useState('');

  useEffect(() => {
    if (!showDocLinker || !user?.isAuthorized || !user?.email) {
      return;
    }

    let cancelled = false;
    let running = false;
    let rerun = false;

    const refresh = async () => {
      if (cancelled) return;

      if (running) {
        rerun = true;
        return;
      }

      running = true;
      setDocCatalogueLoading(true);
      setDocCatalogueError('');

      try {
        do {
          rerun = false;

          const documents = await loadAccessibleArchives({
            effectiveEmail: user.email
          });

          if (cancelled) return;

          if (!rerun) {
            setArchives(documents);
          }
        } while (rerun && !cancelled);
      } catch (error) {
        if (!cancelled) {
          console.error('Could not refresh the archive linker:', error);

          setDocCatalogueError(
            'Could not refresh the document catalogue. ' +
            (error.message || 'Check your connection and reopen this window.')
          );
        }
      } finally {
        running = false;

        if (!cancelled) {
          setDocCatalogueLoading(false);

          if (rerun) {
            rerun = false;
            refresh();
          }
        }
      }
    };

    const stopRevisionListener = onSnapshot(
      doc(db, 'system_settings', 'archive_write_guard'),
      () => {
        refresh();
      },
      error => {
        if (cancelled) return;

        console.error('Could not watch archive revisions:', error);

        setDocCatalogueError(
          'Automatic archive updates could not be started. ' +
          'Close and reopen this window after checking your connection.'
        );
      }
    );

    const handleFocus = () => {
      refresh();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      stopRevisionListener();
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [
    showDocLinker,
    user?.email,
    user?.role,
    user?.isAuthorized
  ]);

  // Preview Modal
  const [previewItem, setPreviewItem] = useState(null);
  const [viewingAnswer, setViewingAnswer] = useState(false);
  const [previewLanguage, setPreviewLanguage] = useState('en');

  const previewPdfUrl = getMarksAttachmentUrl(
    previewItem?.parent,
    viewingAnswer,
    previewLanguage
  );

  // Linked Marks Modal
  const [showMarksModal, setShowMarksModal] = useState(false);
  const [linkedMarksData, setLinkedMarksData] = useState([]);
  const [isLoadingMarks, setIsLoadingMarks] = useState(false);
  const [currentMarksDocTitle, setCurrentMarksDocTitle] = useState('');
  const [linkedMarksError, setLinkedMarksError] = useState('');
  const [linkedMarksMode, setLinkedMarksMode] = useState('total');
  const linkedMarksRequestRef = useRef(0);

  // Export
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportPresetId, setExportPresetId] = useState('');
  const [exportAssessmentsMap, setExportAssessmentsMap] = useState({});

  // Comparison
  const [selectedCompareId, setSelectedCompareId] = useState('');

  const categoryDefaultsToMultiSection =
    multiSectionCategories.includes(selectedCategory);

  const selectedAssessmentHasSections =
    Array.isArray(selectedAssessment?.sectionsConfig) &&
    selectedAssessment.sectionsConfig.length > 0;

  const isMultiSectionCategory = selectedAssessment
    ? selectedAssessmentHasSections
    : categoryDefaultsToMultiSection;

  const isMultiSectionForm = forceMultiSection;

  // Students of the selected class
  const currentClassStudents = useMemo(() => {
    return students
      .filter(s => s.className === selectedClass)
      .sort((a, b) => String(a.classNumber).localeCompare(String(b.classNumber), undefined, { numeric: true }));
  }, [students, selectedClass]);

  const currentStudentIds = useMemo(
    () => currentClassStudents.map(student => student.id),
    [currentClassStudents]
  );

  const firstTerm = terms[0] || '';

  // All items of the selected term grouped by category (main board)
  const termBoard = useMemo(() => {
    if (!categoriesReady || !selectedTerm) return null;

    const termItems = classItemsAllTerms.filter(item =>
      item.term === selectedTerm ||
      (!item.term && selectedTerm === firstTerm)
    );

    const boardCategories = marksUniqueNames([
      ...categories,
      ...termItems.map(item => item.category)
    ]);

    return boardCategories.map(category => ({
      category,
      items: termItems
        .filter(item => item.category === category)
        .sort(sortMarksAssessments)
    }));
  }, [
    categoriesReady,
    selectedTerm,
    firstTerm,
    classItemsAllTerms,
    categories
  ]);

  const termCountByCategory = useMemo(() => {
    const counts = {};
    (termBoard || []).forEach(group => {
      counts[group.category] = group.items.length;
    });
    return counts;
  }, [termBoard]);

  const allTermCountByCategory = useMemo(() => {
    const counts = {};
    classItemsAllTerms.forEach(item => {
      counts[item.category] = (counts[item.category] || 0) + 1;
    });
    return counts;
  }, [classItemsAllTerms]);

  // Comparison candidates come from the live class list (no extra reads)
  const compareAssessmentsList = useMemo(() => {
    if (!selectedAssessment || !isMultiSectionCategory) return [];
    return classItemsAllTerms.filter(item =>
      ['Uniform Test', 'Exam'].includes(item.category) &&
      item.id !== selectedAssessment.id &&
      !item.designatedPending
    );
  }, [classItemsAllTerms, selectedAssessment, isMultiSectionCategory]);

  // ============================================================================
  // 1. INITIAL DATA FETCH
  // ============================================================================
  useEffect(() => {
    const fetchInitialData = async () => {
      setIsLoading(true);
      try {
        const configSnap = await getDoc(doc(db, "system_settings", "config"));
        const roleClasses = configSnap.exists() ? (configSnap.data().roleClasses || {}) : {};

        const classDocSnap = await getDoc(doc(db, "settings", "classes"));
        let loadedClasses = [];
        let loadedArchivedClasses = [];
        if (classDocSnap.exists()) {
          const rawList = classDocSnap.data().list || [];
          const classObjects = rawList
            .map(c =>
              typeof c === 'string'
                ? { name: c, owner: SUPER_ADMIN_EMAIL, isArchived: false }
                : c
            )
            .filter(c => c && typeof c.name === 'string');

          let currentUserRole = user?.role;
          if (!currentUserRole && user?.email) {
            const userDocSnap = await getDoc(doc(db, "user_roles", user.email));
            if (userDocSnap.exists()) {
              currentUserRole = userDocSnap.data().role;
            } else if (user?.isAdmin) {
              currentUserRole = 'admin';
            }
          }

          let visibleClasses = classObjects;
          if (user?.email !== SUPER_ADMIN_EMAIL) {
            if (user?.isAdmin || currentUserRole === 'admin') {
              visibleClasses = classObjects.filter(c => c.owner === user?.email);
            } else {
              const allowed = roleClasses[currentUserRole] || [];
              visibleClasses = classObjects.filter(c => allowed.includes(c.name));
            }
          }

          loadedClasses = visibleClasses.filter(c => !c.isArchived);
          loadedArchivedClasses = visibleClasses.filter(c => c.isArchived);

          loadedClasses.sort((a, b) => a.name.localeCompare(b.name));
          loadedArchivedClasses.sort((a, b) => a.name.localeCompare(b.name));

          setClasses(loadedClasses);
          setArchivedClasses(loadedArchivedClasses);

          const urlParams = new URLSearchParams(window.location.search);
          const classFromUrl = urlParams.get('class');

          if (urlParams.get('studentView') === 'true') {
            setStudentView(true);
          }

          let defaultClass = null;
          if (classFromUrl && loadedClasses.some(c => c.name.replace(/\u200B/g, '') === classFromUrl)) {
            defaultClass = loadedClasses.find(c => c.name.replace(/\u200B/g, '') === classFromUrl).name;
          } else if (loadedClasses.length > 0) {
            defaultClass = loadedClasses[0].name;
          } else if (loadedArchivedClasses.length > 0) {
            defaultClass = loadedArchivedClasses[0].name;
          }

          if (defaultClass) {
            setSelectedClass(defaultClass);
            setSelectedClassesForNew([defaultClass]);
            setModalClasses([defaultClass]);
          }
        }

        const termDocSnap = await getDoc(doc(db, "settings", "terms"));
        let loadedTermsMap = {};
        if (termDocSnap.exists()) {
          if (termDocSnap.data().map) {
            loadedTermsMap = termDocSnap.data().map;
          } else if (termDocSnap.data().list) {
            [...loadedClasses, ...loadedArchivedClasses].forEach(c => {
              loadedTermsMap[c.name] = termDocSnap.data().list;
            });
          }
        }
        setTermsMap(loadedTermsMap);

        const presetsSnap = await getDoc(doc(db, "settings", "presets"));
        let allPresets = [];
        if (presetsSnap.exists() && presetsSnap.data().list) {
          allPresets = presetsSnap.data().list;
        }

        const classPresetsSnap = await getDoc(doc(db, "settings", "classPresets"));
        if (classPresetsSnap.exists() && classPresetsSnap.data().map) {
          setClassPresetsMap(classPresetsSnap.data().map);
        }

        if (!allPresets.some(p => p.name === 'JS Geography')) {
          allPresets.push({
            id: 'js-geog-preset',
            name: 'JS Geography',
            weights: { 'Assignments': 0, 'Quizzes': 0, 'Uniform Test': 50 },
            isCustom: true,
            isShared: true,
            owner: SUPER_ADMIN_EMAIL
          });
          await setDoc(doc(db, "settings", "presets"), { list: allPresets }, { merge: true });
        }

        // Learning Attitude is now calculated with its own buttons,
        // so old Learning Attitude presets are hidden (not deleted).
        const visiblePresets = marksVisiblePresets(allPresets, user?.email);
        setPresets(visiblePresets);

        if (visiblePresets.length > 0) {
          setSelectedPresetId(visiblePresets.find(p => p.name === 'JS Geography')?.id || visiblePresets[0].id);
        }

        const querySnapshot = await getDocs(collection(db, "students"));
        const studentsList = querySnapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(student => !student.isDummy && !student.isDeleted);
        setStudents(studentsList);

        const archivesList = await loadAccessibleArchives({
          effectiveEmail: user.email
        });

        setArchives(archivesList);
      } catch (error) {
        console.error("Error fetching initial data:", error);
      }
      setIsLoading(false);
    };

    if (user) {
      fetchInitialData();
    }
  }, [user]);

  useEffect(() => {
    if (isLoading) return;

    if (!selectedClass) {
      setTerms([]);
      return;
    }

    setSelectedClassesForNew([selectedClass]);

    const classTerms = Array.isArray(termsMap[selectedClass])
      ? termsMap[selectedClass]
      : getDefaultTerms(selectedClass);

    setTerms(classTerms);
  }, [isLoading, selectedClass, termsMap]);

  useEffect(() => {
    if (selectedTerm) {
      setFormTerm(selectedTerm);
    }
  }, [selectedTerm]);

  // ============================================================================
  // 2. LIVE ITEMS OF THE SELECTED CATEGORY
  // ============================================================================
  useEffect(() => {
    setAssessments([]);
    setSelectedAssessment(null);
    setMarksData({});
    setBulkText('');
    setSelectedCompareId('');
    setAssessmentsError('');

    if (
      isLoading ||
      !selectedClass ||
      !selectedCategory ||
      !selectedTerm
    ) {
      setIsAssessmentsLoading(false);
      return;
    }

    setIsAssessmentsLoading(true);

    const assessmentQuery = query(
      collection(db, 'assessments'),
      where('category', '==', selectedCategory)
    );

    return onSnapshot(
      assessmentQuery,
      snapshot => {
        const loaded = snapshot.docs
          .map(document => ({
            ...document.data(),
            id: document.id
          }))
          .filter(assessment => {
            const matchesClass = Array.isArray(assessment.classes)
              ? assessment.classes.includes(selectedClass)
              : assessment.className === selectedClass;

            const matchesTerm =
              assessment.term === selectedTerm ||
              (!assessment.term && selectedTerm === firstTerm);

            return matchesClass && matchesTerm;
          })
          .sort(sortMarksAssessments);

        // An item chosen from another category waits for this list.
        const wantedId = pendingSelectRef.current;
        const wantedItem = wantedId
          ? loaded.find(item => item.id === wantedId) || null
          : null;
        if (wantedId) pendingSelectRef.current = '';

        setAssessments(loaded);
        setAssessmentsError('');
        setIsAssessmentsLoading(false);

        setSelectedAssessment(previous => {
          if (wantedItem) return wantedItem;
          if (!previous) return null;

          const current = loaded.find(item => item.id === previous.id);

          if (!current) return null;

          const sameMarks =
            JSON.stringify(current.marks || {}) ===
            JSON.stringify(previous.marks || {});

          return {
            ...current,
            marks: sameMarks ? previous.marks : current.marks
          };
        });
      },
      error => {
        console.error('Could not listen to assessments:', error);

        setAssessmentsError(
          'Could not load assessment updates. Check your connection and permissions.'
        );

        setIsAssessmentsLoading(false);
      }
    );
  }, [
    isLoading,
    selectedClass,
    selectedCategory,
    selectedTerm,
    firstTerm
  ]);

  // If the open item disappears (deleted / moved), go back to the board.
  useEffect(() => {
    if (
      view === 'item' &&
      !selectedAssessment &&
      !isAssessmentsLoading &&
      !pendingSelectRef.current
    ) {
      setView('home');
    }
  }, [view, selectedAssessment, isAssessmentsLoading]);

  const selectedAssessmentId = selectedAssessment?.id || '';
  const selectedAssessmentMarks = selectedAssessment?.marks;

  useEffect(() => {
    setMarksData(selectedAssessmentMarks || {});
    setBulkText('');
  }, [selectedAssessmentId, selectedAssessmentMarks]);

  const marksDirty =
    view === 'item' &&
    Boolean(selectedAssessment) &&
    !selectedAssessment.designatedPending &&
    JSON.stringify(marksData || {}) !== JSON.stringify(selectedAssessment.marks || {});

  const guardUnsaved = () =>
    !marksDirty ||
    window.confirm('You have unsaved marks for this item. Leave without saving?');

  // ============================================================================
  // NAVIGATION
  // ============================================================================
  const goHome = () => {
    if (!guardUnsaved()) return;
    pendingSelectRef.current = '';
    setSelectedAssessment(null);
    setView('home');
  };

  const openItem = item => {
    if (view === 'item' && selectedAssessment?.id === item.id) return;
    if (!guardUnsaved()) return;

    const category = item.category || selectedCategory;
    setView('item');

    if (category !== selectedCategory) {
      pendingSelectRef.current = item.id;
      setSelectedCategory(category);
    } else {
      pendingSelectRef.current = '';
      setSelectedAssessment(assessments.find(a => a.id === item.id) || item);
    }
  };

  const openOverview = (category = selectedCategory) => {
    if (!guardUnsaved()) return;
    pendingSelectRef.current = '';
    setSelectedAssessment(null);
    if (category !== selectedCategory) setSelectedCategory(category);
    setView('overview');
  };

  const reorderAssessments = async (from, to) => {
    if (from === null || to === null || from === undefined || to === undefined || from === to) return;

    const next = [...assessments];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const withOrder = next.map((item, index) => ({ ...item, order: index }));
    setAssessments(withOrder);

    try {
      await Promise.all(
        withOrder.map(item =>
          updateDoc(doc(db, 'assessments', item.id), { order: item.order })
        )
      );
    } catch (error) {
      console.error('Error updating order', error);
      alert('Could not save the new order.');
    }
  };

  // ============================================================================
  // 3. TERM & CATEGORY MANAGEMENT
  // ============================================================================
  const saveTerms = async (newTermsList) => {
    try {
      const updatedMap = { ...termsMap, [selectedClass]: newTermsList };
      await setDoc(doc(db, "settings", "terms"), { map: updatedMap }, { merge: true });
      setTermsMap(updatedMap);
      setTerms(newTermsList);
    } catch (error) {
      console.error("Error saving terms:", error);
      alert("Failed to save terms.");
    }
  };

  const handleAddTerm = (e) => {
    e.preventDefault();
    const tName = newTermName.trim();
    if (tName && !terms.includes(tName)) {
      const updated = [...terms, tName];
      saveTerms(updated);
      setNewTermName('');
      if (!selectedTerm) setSelectedTerm(tName);
    }
  };

  const handleDeleteTerm = (tName) => {
    if (!window.confirm(`Are you sure you want to delete "${tName}" for ${cleanClassName(selectedClass)}?`)) return;
    const updated = terms.filter(t => t !== tName);
    saveTerms(updated);
    if (selectedTerm === tName) {
      setSelectedTerm(updated.length > 0 ? updated[0] : '');
    }
  };

  const handleUpdateTerm = (oldName) => {
    const tName = editTermName.trim();
    if (tName && tName !== oldName && !terms.includes(tName)) {
      const updated = terms.map(t => t === oldName ? tName : t);
      saveTerms(updated);
      if (selectedTerm === oldName) setSelectedTerm(tName);
    }
    setEditingTerm(null);
  };

  const handleMoveTerm = (index, direction) => {
    const newTerms = [...terms];
    if (direction === 'up' && index > 0) {
      [newTerms[index - 1], newTerms[index]] = [newTerms[index], newTerms[index - 1]];
    } else if (direction === 'down' && index < newTerms.length - 1) {
      [newTerms[index + 1], newTerms[index]] = [newTerms[index], newTerms[index + 1]];
    } else {
      return;
    }
    saveTerms(newTerms);
  };

  const validateMarksCategoryName = name => {
    if (!name) {
      throw new Error('Enter a category name.');
    }

    if (name.length > 80) {
      throw new Error('Use a category name of 80 characters or fewer.');
    }

    if (
      [
        '__proto__',
        'prototype',
        'constructor',
        'Empty',
        'Total Term Score'
      ].includes(name)
    ) {
      throw new Error('That name is reserved. Please choose another name.');
    }
  };

  const changeCurrentClassCategories = async (transform, onSuccess) => {
    if (categoryOperationLock.current) return;

    if (!categoriesReady || !canManageClassCategories) {
      alert('Category settings are not ready, or you cannot edit this class.');
      return;
    }

    const targetClass = selectedClass;

    categoryOperationLock.current = true;
    setIsCategorySaving(true);

    try {
      const classItems = await readMarksClassAssessments(targetClass);
      const settingsRef = doc(db, 'settings', 'categories');

      const nextConfig = await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(settingsRef);
        const data = snapshot.data() || {};

        const currentConfig = getMarksClassCategoryConfig(
          data,
          targetClass,
          classItems
        );

        const transformed = transform(currentConfig, classItems);

        const next = {
          className: targetClass,
          list: marksUniqueNames([
            ...MARKS_DEFAULT_CATEGORIES,
            ...transformed.list
          ]),
          multiSection: marksUniqueNames([
            ...MARKS_DEFAULT_MULTI_CATEGORIES,
            ...transformed.multiSection
          ])
        };

        next.multiSection = next.multiSection.filter(category =>
          next.list.includes(category)
        );

        transaction.set(
          settingsRef,
          {
            schemaVersion: 2,
            byClass: {
              [marksClassCategoryKey(targetClass)]: next
            }
          },
          { merge: true }
        );

        return next;
      });

      setCategorySettingsState(previous => {
        if (previous.identity !== categoryIdentity) return previous;

        return {
          ...previous,
          data: {
            ...previous.data,
            byClass: {
              ...(previous.data.byClass || {}),
              [marksClassCategoryKey(targetClass)]: nextConfig
            }
          }
        };
      });

      if (selectedCategoryClassRef.current === targetClass) {
        onSuccess?.();
      }
    } catch (error) {
      console.error('Category change failed:', error);
      alert(error.message || 'Could not save category settings.');
    } finally {
      categoryOperationLock.current = false;
      setIsCategorySaving(false);
    }
  };

  const handleAddCategory = async event => {
    event.preventDefault();

    const name = newCategoryName.trim();
    const useMultiSection = newCategoryIsMulti;

    try {
      validateMarksCategoryName(name);
    } catch (error) {
      alert(error.message);
      return;
    }

    await changeCurrentClassCategories(
      current => {
        if (current.list.includes(name)) {
          throw new Error('This class already has that category.');
        }

        return {
          ...current,
          list: [...current.list, name],
          multiSection: useMultiSection
            ? [...current.multiSection, name]
            : current.multiSection
        };
      },
      () => {
        setNewCategoryName('');
        setNewCategoryIsMulti(false);
      }
    );
  };

  const handleDeleteCategory = async (name, event) => {
    event?.stopPropagation();

    if (MARKS_DEFAULT_CATEGORIES.includes(name)) {
      alert('The six default categories are kept in every class.');
      return;
    }

    if (!window.confirm(
      `Remove the empty category "${name}" from ` +
      `${cleanClassName(selectedClass)} only?\n\n` +
      'A category with assessments in any term cannot be removed.'
    )) return;

    await changeCurrentClassCategories(
      (current, classItems) => {
        if (classItems.some(item => item.category === name)) {
          throw new Error(
            'This category contains assessments in this class. ' +
            'It has been kept, including items in other terms.'
          );
        }

        return {
          ...current,
          list: current.list.filter(category => category !== name),
          multiSection: current.multiSection.filter(
            category => category !== name
          )
        };
      },
      () => {
        if (selectedCategory === name) {
          setSelectedCategory('Assignments');
        }
        setEditingCategory(null);
      }
    );
  };

  const handleUpdateCategory = async oldName => {
    const name = editCategoryName.trim();

    if (name === oldName) {
      setEditingCategory(null);
      return;
    }

    if (MARKS_DEFAULT_CATEGORIES.includes(oldName)) {
      alert('The six default categories cannot be renamed.');
      return;
    }

    try {
      validateMarksCategoryName(name);
    } catch (error) {
      alert(error.message);
      return;
    }

    await changeCurrentClassCategories(
      (current, classItems) => {
        if (current.list.includes(name)) {
          throw new Error('This class already has that category.');
        }

        if (classItems.some(item => item.category === oldName)) {
          throw new Error(
            'Only empty custom categories can be renamed here. ' +
            'This protects existing assessments, shared classes and calculation presets.'
          );
        }

        return {
          ...current,
          list: current.list.map(
            category => category === oldName ? name : category
          ),
          multiSection: current.multiSection.map(
            category => category === oldName ? name : category
          )
        };
      },
      () => {
        if (selectedCategory === oldName) {
          setSelectedCategory(name);
        }
        setEditingCategory(null);
      }
    );
  };

  const handleCleanClassCategories = async () => {
    if (!window.confirm(
      `Remove empty custom categories from ` +
      `${cleanClassName(selectedClass)}?\n\n` +
      'The six defaults and every category with an assessment in ANY term will remain.\n' +
      'No assessments or marks will be deleted.'
    )) return;

    await changeCurrentClassCategories(
      (current, classItems) => {
        const used = new Set(classItems.map(item => item.category));

        return {
          ...current,
          list: current.list.filter(category =>
            MARKS_DEFAULT_CATEGORIES.includes(category) ||
            used.has(category)
          ),
          multiSection: current.multiSection.filter(category =>
            MARKS_DEFAULT_CATEGORIES.includes(category) ||
            used.has(category)
          )
        };
      },
      () => {
        setEditingCategory(null);
        alert('Empty custom categories removed from this class.');
      }
    );
  };

  const handleCleanAllClassCategories = async () => {
    if (user?.email !== SUPER_ADMIN_EMAIL) return;
    if (categoryOperationLock.current) return;

    if (!window.confirm(
      'Clean category settings for ALL saved classes, including archived classes?\n\n' +
      'Keep: the six default categories and custom categories with assessments in any term.\n' +
      'Remove: empty custom category settings.\n\n' +
      'No assessments, marks or calculation presets will be deleted.\n' +
      'Ask other administrators to finish category editing before continuing.'
    )) return;

    categoryOperationLock.current = true;
    setIsCategorySaving(true);

    try {
      const [classesSnapshot, assessmentsSnapshot] = await Promise.all([
        getDocFromServer(doc(db, 'settings', 'classes')),
        getDocsFromServer(collection(db, 'assessments'))
      ]);

      const classNames = marksUniqueNames(
        (classesSnapshot.data()?.list || []).map(classInfo =>
          typeof classInfo === 'string'
            ? classInfo
            : classInfo?.name
        )
      );

      const itemsByClass = new Map(
        classNames.map(className => [className, []])
      );

      assessmentsSnapshot.docs.forEach(snapshot => {
        const item = snapshot.data();

        const linkedClasses = Array.isArray(item.classes)
          ? item.classes
          : [item.className];

        [...new Set(linkedClasses)].forEach(className => {
          itemsByClass.get(className)?.push(item);
        });
      });

      const settingsRef = doc(db, 'settings', 'categories');

      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(settingsRef);
        const settings = snapshot.data() || {};

        const byClass = { ...(settings.byClass || {}) };

        classNames.forEach(className => {
          byClass[marksClassCategoryKey(className)] =
            getMarksClassCategoryConfig(
              settings,
              className,
              itemsByClass.get(className) || [],
              false
            );
        });

        transaction.set(settingsRef, {
          ...settings,
          schemaVersion: 2,
          byClass
        });
      });

      setEditingCategory(null);

      alert(
        `Category cleanup completed for ${classNames.length} classes.\n\n` +
        'The six defaults and used custom categories were kept.\n' +
        'No assessments or marks were deleted.'
      );
    } catch (error) {
      console.error('All-class category cleanup failed:', error);

      alert(
        'Could not complete category cleanup.\n\n' +
        (error.message || 'Check your connection and permissions.')
      );
    } finally {
      categoryOperationLock.current = false;
      setIsCategorySaving(false);
    }
  };

  const handleRevealAllClasses = async () => {
    if (!window.confirm("Are you sure you want to GLOBALLY disclose ALL hidden assessments across ALL classes and terms?")) return;
    try {
      const q = query(collection(db, "assessments"), where("isDisclosed", "==", false));
      const snap = await getDocs(q);
      if (snap.empty) {
        alert("No hidden assessments found.");
        return;
      }
      await Promise.all(snap.docs.map(d => updateDoc(doc(db, "assessments", d.id), { isDisclosed: true })));
      setAssessments(previous => previous.map(a => a.isDisclosed === false ? { ...a, isDisclosed: true } : a));
      alert(`Successfully disclosed ${snap.docs.length} hidden assessments globally.`);
    } catch (e) {
      console.error(e);
      alert("Failed to disclose assessments.");
    }
  };

  const handleSaveDefaultPreset = async value => {
    const newMap = { ...classPresetsMap, [selectedClass]: value };
    setClassPresetsMap(newMap);
    try {
      await setDoc(doc(db, "settings", "classPresets"), { map: newMap }, { merge: true });
    } catch (error) {
      console.error(error);
      alert('Could not save the default term score method.');
    }
  };

  const openSettings = (tab = 'general') => {
    setSettingsTab(tab);
    setShowSettings(true);
  };

  // ============================================================================
  // 4. ASSESSMENT MANAGEMENT & CONFIG
  // ============================================================================
  const openAddModal = (category = selectedCategory) => {
    if (!selectedClass || !selectedTerm || !category) {
      alert('Please select a class and term first.');
      return;
    }

    setFormCategory(category);
    setNewAssessmentName('');
    setNewAssessmentDate(new Date().toISOString().split('T')[0]);
    setFullMark(100);
    setPaperFullMark(100);
    setLinkedDocId('');
    setForceMultiSection(multiSectionCategories.includes(category));
    setScaleTotalTo100(['Uniform Test', 'Exam'].includes(category));
    setSectionsConfig([newDefaultSection()]);
    setSelectedClassesForNew([selectedClass]);
    setFormTerm(selectedTerm);
    setIsEditingAssessment(false);
    setShowAddAssessment(true);
  };

  const openEditModal = () => {
    if (!selectedAssessment) return;

    const existingSections = Array.isArray(selectedAssessment.sectionsConfig)
      ? selectedAssessment.sectionsConfig
      : [];

    setFormCategory(selectedAssessment.category || selectedCategory);
    setNewAssessmentName(selectedAssessment.name || '');
    setNewAssessmentDate(
      selectedAssessment.date || new Date().toISOString().split('T')[0]
    );

    setFullMark(
      selectedAssessment.fullMark ??
      (selectedAssessment.designatedPending ? '' : 100)
    );

    setPaperFullMark(
      selectedAssessment.paperFullMark ??
      (selectedAssessment.designatedPending ? '' : 100)
    );

    setLinkedDocId(selectedAssessment.linkedDocId || '');
    setScaleTotalTo100(assessmentUsesScaling(selectedAssessment));

    setForceMultiSection(
      existingSections.length > 0 ||
      (
        selectedAssessment.designatedPending &&
        multiSectionCategories.includes(selectedAssessment.category)
      )
    );

    setSectionsConfig(
      existingSections.length > 0
        ? existingSections.map(section => ({
          ...section,
          subSections: (section.subSections || []).map(sub => ({ ...sub }))
        }))
        : [newDefaultSection()]
    );

    setSelectedClassesForNew(
      Array.isArray(selectedAssessment.classes)
        ? [...selectedAssessment.classes]
        : [selectedAssessment.className || selectedClass]
    );

    setFormTerm(selectedAssessment.term || selectedTerm);
    setIsEditingAssessment(true);
    setShowAddAssessment(true);
  };

  const toggleClassForNew = (className) => {
    setSelectedClassesForNew(prev =>
      prev.includes(className)
        ? prev.filter(c => c !== className)
        : [...prev, className]
    );
  };

  const handleAddSection = () => {
    setSectionsConfig(prev => [
      ...prev,
      {
        id: generateId(),
        name: `Paper ${prev.length + 1}`,
        fullMark: 100,
        weight: 0,
        hasSubSections: false,
        subSections: []
      }
    ]);
  };

  const handleRemoveSection = (secId) => {
    setSectionsConfig(prev => prev.filter(s => s.id !== secId));
  };

  const toggleSubSections = (secId) => {
    setSectionsConfig(prev => prev.map(sec => {
      if (sec.id === secId) {
        const willHaveSubSections = !sec.hasSubSections;
        return {
          ...sec,
          hasSubSections: willHaveSubSections,
          subSections: willHaveSubSections && sec.subSections.length === 0
            ? [
              { id: generateId(), name: 'Section A', fullMark: 50 },
              { id: generateId(), name: 'Section B', fullMark: 50 }
            ]
            : sec.subSections
        };
      }
      return sec;
    }));
  };

  const handleAddSubSection = (secId) => {
    setSectionsConfig(prev => prev.map(sec => {
      if (sec.id === secId) {
        return {
          ...sec,
          subSections: [...sec.subSections, { id: generateId(), name: `Part ${sec.subSections.length + 1}`, fullMark: 50 }]
        };
      }
      return sec;
    }));
  };

  const handleRemoveSubSection = (secId, subId) => {
    setSectionsConfig(prev => prev.map(sec => {
      if (sec.id === secId) {
        return {
          ...sec,
          subSections: sec.subSections.filter(sub => sub.id !== subId)
        };
      }
      return sec;
    }));
  };

  const updateSection = (secId, field, value) => {
    setSectionsConfig(prev => prev.map(sec => sec.id === secId ? { ...sec, [field]: value } : sec));
  };

  const updateSubSection = (secId, subId, field, value) => {
    setSectionsConfig(prev => prev.map(sec => {
      if (sec.id === secId) {
        return {
          ...sec,
          subSections: sec.subSections.map(sub => sub.id === subId ? { ...sub, [field]: value } : sub)
        };
      }
      return sec;
    }));
  };

  const autoCalculateWeights = () => {
    const totalPaperMark = parseFloat(paperFullMark) || 0;
    if (totalPaperMark > 0) {
      setSectionsConfig(prev => prev.map(sec => {
        const weight = (((parseFloat(sec.fullMark) || 0) / totalPaperMark) * 100).toFixed(1);
        return { ...sec, weight: parseFloat(weight) };
      }));
    } else {
      alert("Please set a valid Paper Full Mark first.");
    }
  };

  const handleSaveAssessment = async (e) => {
    e.preventDefault();
    if (isSavingAssessment) return;

    const useSections = isMultiSectionForm;
    const category = formCategory;

    const finalName =
      newAssessmentName.trim() ||
      (useSections ? `${formTerm} ${category}` : '');

    if (
      !finalName ||
      selectedClassesForNew.length === 0 ||
      !category ||
      !formTerm ||
      !newAssessmentDate
    ) {
      alert('Please complete the required fields and select at least one class.');
      return;
    }

    if (isEditingAssessment && !selectedAssessment) {
      alert('Please close this form and select the assessment again.');
      return;
    }

    if (
      isEditingAssessment &&
      !selectedAssessment?.designatedPending &&
      useSections !== selectedAssessmentHasSections
    ) {
      alert(
        'The layout of an existing assessment cannot be changed here. ' +
        'Please create a separate assessment if you need a different layout.'
      );
      return;
    }

    const isPositiveNumber = value =>
      String(value ?? '').trim() !== '' &&
      Number.isFinite(Number(value)) &&
      Number(value) > 0;

    const isNonNegativeNumber = value =>
      String(value ?? '').trim() !== '' &&
      Number.isFinite(Number(value)) &&
      Number(value) >= 0;

    if (!useSections && !isPositiveNumber(fullMark)) {
      alert('The item full mark must be a number greater than zero.');
      return;
    }

    let savedSections = null;

    if (useSections) {
      if (scaleTotalTo100 && !isPositiveNumber(paperFullMark)) {
        alert('The paper full mark must be a number greater than zero.');
        return;
      }

      if (sectionsConfig.length === 0) {
        alert('Please add at least one section.');
        return;
      }

      for (const section of sectionsConfig) {
        if (!section.name?.trim()) {
          alert('Each section needs a name.');
          return;
        }

        if (
          (scaleTotalTo100 || !section.hasSubSections) &&
          !isPositiveNumber(section.fullMark)
        ) {
          alert('Each section needs a full mark greater than zero.');
          return;
        }

        if (scaleTotalTo100 && !isNonNegativeNumber(section.weight)) {
          alert('Each section weight must be zero or greater.');
          return;
        }

        if (section.hasSubSections) {
          const subSections = section.subSections || [];

          if (
            subSections.length === 0 ||
            subSections.some(sub =>
              !sub.name?.trim() ||
              !isPositiveNumber(sub.fullMark)
            )
          ) {
            alert('Each enabled subsection needs a name and a full mark greater than zero.');
            return;
          }
        }
      }

      if (
        scaleTotalTo100 &&
        sectionsConfig.reduce((sum, section) => sum + Number(section.weight), 0) <= 0
      ) {
        alert('At least one section needs a positive weight when conversion to 100 is enabled.');
        return;
      }

      savedSections = sectionsConfig.map(section => ({
        ...section,
        name: section.name.trim(),
        fullMark: scaleTotalTo100
          ? Number(section.fullMark)
          : getSectionRawFullMark(section),
        weight: isNonNegativeNumber(section.weight)
          ? Number(section.weight)
          : 0,
        subSections: (section.subSections || []).map(sub => ({
          ...sub,
          name: (sub.name || '').trim(),
          fullMark: section.hasSubSections
            ? Number(sub.fullMark)
            : sub.fullMark
        }))
      }));
    }

    setIsSavingAssessment(true);

    try {
      const assessmentData = {
        classes: [...selectedClassesForNew],
        category,
        term: formTerm,
        name: finalName,
        date: newAssessmentDate,
        fullMark: useSections ? null : Number(fullMark),
        paperFullMark: useSections
          ? (
            scaleTotalTo100
              ? Number(paperFullMark)
              : savedSections.reduce(
                (sum, section) => sum + getSectionRawFullMark(section),
                0
              )
          )
          : null,
        scaleTotalTo100: useSections ? scaleTotalTo100 : false,
        sectionsConfig: savedSections,
        linkedDocId: linkedDocId || null,
        ...(isEditingAssessment && (
          selectedAssessment?.designatedSource ||
          selectedAssessment?.designatedPending
        )
          ? { designatedPending: false }
          : {})
      };

      if (isEditingAssessment) {
        const assessmentId = selectedAssessment.id;

        await updateDoc(doc(db, 'assessments', assessmentId), assessmentData);

        const updatedAssessment = {
          ...selectedAssessment,
          ...assessmentData
        };

        const remainsInCurrentClass = selectedClassesForNew.includes(selectedClass);
        const remainsInCurrentView = remainsInCurrentClass && formTerm === selectedTerm;

        setAssessments(previous =>
          remainsInCurrentView
            ? previous.map(a => a.id === assessmentId ? { ...a, ...assessmentData } : a)
            : previous.filter(a => a.id !== assessmentId)
        );

        setSelectedAssessment(remainsInCurrentView ? updatedAssessment : null);

        if (remainsInCurrentClass && formTerm !== selectedTerm) {
          setSelectedTerm(formTerm);
        }
      } else {
        const newData = {
          ...assessmentData,
          marks: {},
          isDisclosed: false
        };

        const docRef = await addDoc(collection(db, 'assessments'), newData);

        const addedAssessment = {
          id: docRef.id,
          ...newData
        };

        if (
          selectedClassesForNew.includes(selectedClass) &&
          formTerm === selectedTerm
        ) {
          if (category === selectedCategory) {
            setAssessments(previous => [addedAssessment, ...previous]);
            setSelectedAssessment(addedAssessment);
          } else {
            pendingSelectRef.current = docRef.id;
            setSelectedCategory(category);
          }
          setView('item');
        }
      }

      setShowAddAssessment(false);
    } catch (error) {
      console.error('Error saving assessment:', error);
      alert('Failed to save the assessment. Please try again.');
    } finally {
      setIsSavingAssessment(false);
    }
  };

  const handleDeleteAssessment = async (id, e) => {
    if (e) e.stopPropagation();

    const item = assessments.find(value => value.id === id) ||
      (selectedAssessment?.id === id ? selectedAssessment : null);

    if (item?.designatedSource) {
      alert(
        'This item came from Designated Assessment.\n\n' +
        'Delete its source list item there instead. Only empty Marks copies ' +
        'will be deleted; copies with student data will be retained.'
      );
      return;
    }

    if (!window.confirm("Are you sure you want to delete this assessment? All marks for ALL linked classes will be lost.")) return;

    try {
      await deleteDoc(doc(db, "assessments", id));
      setAssessments(previous => previous.filter(a => a.id !== id));
      if (selectedAssessment?.id === id) {
        setSelectedAssessment(null);
        setMarksData({});
      }
    } catch (error) {
      console.error("Error deleting assessment:", error);
      alert("Failed to delete assessment.");
    }
  };

  const toggleDisclosure = async () => {
    if (!selectedAssessment) return;
    const newStatus = !selectedAssessment.isDisclosed;
    try {
      await updateDoc(doc(db, "assessments", selectedAssessment.id), { isDisclosed: newStatus });
      const updated = { ...selectedAssessment, isDisclosed: newStatus };
      setSelectedAssessment(updated);
      setAssessments(previous => previous.map(a => a.id === updated.id ? updated : a));
    } catch (e) {
      console.error(e);
      alert("Failed to update disclosure status.");
    }
  };

  // ============================================================================
  // 5. MARKS INPUT & SAVE
  // ============================================================================
  const handleMarkChange = (studentId, value, subId = null) => {
    if (subId) {
      setMarksData(prev => ({
        ...prev,
        [studentId]: {
          ...(typeof prev[studentId] === 'object' ? prev[studentId] : {}),
          [subId]: value
        }
      }));
    } else {
      setMarksData(prev => ({
        ...prev,
        [studentId]: value
      }));
    }
  };

  const handleDeductionChange = (studentId, value) => {
    setMarksData(prev => ({
      ...prev,
      [`${studentId}_deduction`]: value
    }));
  };

  const handleBulkPaste = (e) => {
    const text = e.target.value;
    setBulkText(text);

    const lines = text.split('\n').map(l => l.trim());
    const newMarks = { ...marksData };
    const isMulti = selectedAssessment?.sectionsConfig?.length > 0;

    currentClassStudents.forEach((student, index) => {
      if (lines[index] !== undefined && lines[index] !== '') {
        if (isMulti) {
          const cols = lines[index].split('\t');
          const studentMarks = { ...(typeof newMarks[student.id] === 'object' ? newMarks[student.id] : {}) };

          let colIndex = 0;
          selectedAssessment.sectionsConfig.forEach(sec => {
            if (sec.hasSubSections) {
              sec.subSections.forEach(sub => {
                if (cols[colIndex] !== undefined) {
                  studentMarks[sub.id] = cols[colIndex].trim();
                }
                colIndex++;
              });
            } else {
              if (cols[colIndex] !== undefined) {
                studentMarks[sec.id] = cols[colIndex].trim();
              }
              colIndex++;
            }
          });
          newMarks[student.id] = studentMarks;
        } else {
          newMarks[student.id] = lines[index];
        }
      }
    });

    setMarksData(newMarks);
  };

  const flashSaved = () => {
    setSaveFlash(true);
    setTimeout(() => setSaveFlash(false), 2000);
  };

  const handleSaveMarks = async () => {
    if (!selectedAssessment) return;

    if (selectedAssessment.designatedPending) {
      alert('Configure this assessment before entering or saving marks.');
      return;
    }

    setIsSaving(true);

    try {
      await updateDoc(doc(db, "assessments", selectedAssessment.id), {
        marks: marksData
      });

      const updatedAssessment = { ...selectedAssessment, marks: marksData };
      setSelectedAssessment(updatedAssessment);
      setAssessments(previous => previous.map(a => a.id === updatedAssessment.id ? updatedAssessment : a));
      flashSaved();
    } catch (error) {
      console.error("Error saving marks:", error);
      alert("Failed to save marks.");
    }

    setIsSaving(false);
  };

  const handleKeyDown = (e, rowIndex, colIndex) => {
    let nextRow = rowIndex;
    let nextCol = colIndex;

    if (e.key === 'ArrowDown' || e.key === 'Enter') nextRow++;
    else if (e.key === 'ArrowUp') nextRow--;
    else if (e.key === 'ArrowRight') nextCol++;
    else if (e.key === 'ArrowLeft') nextCol--;
    else return;

    e.preventDefault();
    const nextInput = document.querySelector(`input[data-row="${nextRow}"][data-col="${nextCol}"]`);
    if (nextInput) {
      nextInput.focus();
      nextInput.select();
    }
  };

  // ============================================================================
  // AMEND MARKS
  // ============================================================================
  const openAmendModal = () => {
    const initialRows = Array.from({ length: 8 }).map(() => ({
      id: generateId(),
      query: '',
      student: null,
      marks: {},
      originalMarks: {}
    }));
    setAmendRows(initialRows);
    setHasUnsavedAmendments(false);
    setShowAmendModal(true);
  };

  const closeAmendModal = () => {
    if (hasUnsavedAmendments) {
      if (!window.confirm("You have unsaved amendments. Are you sure you want to close without saving?")) {
        return;
      }
    }
    setShowAmendModal(false);
  };

  const handleAddAmendRow = () => {
    setAmendRows(prev => [...prev, { id: generateId(), query: '', student: null, marks: {}, originalMarks: {} }]);
  };

  const handleRemoveAmendRow = (id) => {
    setAmendRows(prev => prev.filter(r => r.id !== id));
  };

  const assessmentClasses = useMemo(() => {
    return selectedAssessment?.classes || (selectedAssessment?.className ? [selectedAssessment.className] : []);
  }, [selectedAssessment]);

  const allClassesStudents = useMemo(() => {
    if (!selectedAssessment || assessmentClasses.length <= 1) return [];
    return students
      .filter(s => assessmentClasses.includes(s.className))
      .sort((a, b) => {
        if (a.className !== b.className) return a.className.localeCompare(b.className);
        return String(a.classNumber).localeCompare(String(b.classNumber), undefined, { numeric: true });
      });
  }, [students, selectedAssessment, assessmentClasses]);

  const handleAmendQueryChange = (rowId, queryText) => {
    let foundStudent = null;
    const q = queryText.trim().toUpperCase();
    if (q) {
      const searchPool = assessmentClasses.length > 1 ? allClassesStudents : currentClassStudents;

      foundStudent = searchPool.find(s => {
        const match1 = String(s.classNumber) === q && s.className === selectedClass;
        const match2 = `${s.className}${s.classNumber}`.replace(/\s/g, '').toUpperCase() === q;
        return match1 || match2;
      });
    }

    setAmendRows(prev => prev.map(r => {
      if (r.id === rowId) {
        const source = foundStudent ? marksData[foundStudent.id] : null;
        const initialMarks = source && typeof source === 'object' ? JSON.parse(JSON.stringify(source)) : {};
        return {
          ...r,
          query: queryText,
          student: foundStudent,
          marks: initialMarks,
          originalMarks: JSON.parse(JSON.stringify(initialMarks))
        };
      }
      return r;
    }));
  };

  const adjustAmendMark = (rowId, subId, amount) => {
    setHasUnsavedAmendments(true);
    setAmendRows(prev => prev.map(r => {
      if (r.id === rowId && r.student) {
        const currentVal = parseFloat(r.marks[subId]) || 0;
        const newVal = Math.max(0, Number((currentVal + amount).toFixed(2)));
        return {
          ...r,
          marks: { ...r.marks, [subId]: newVal.toString() }
        };
      }
      return r;
    }));
  };

  const setAmendMark = (rowId, subId, value) => {
    setHasUnsavedAmendments(true);
    setAmendRows(prev => prev.map(r =>
      r.id === rowId && r.student
        ? { ...r, marks: { ...r.marks, [subId]: value } }
        : r
    ));
  };

  const saveAmendments = async () => {
    const updatedMarksData = { ...marksData };
    let hasChanges = false;

    amendRows.forEach(r => {
      if (r.student && r.query.trim() !== '') {
        updatedMarksData[r.student.id] = r.marks;
        hasChanges = true;
      }
    });

    if (!hasChanges) {
      alert("No valid students to save.");
      return;
    }

    setIsSaving(true);
    try {
      await updateDoc(doc(db, "assessments", selectedAssessment.id), { marks: updatedMarksData });

      const updatedAssessment = { ...selectedAssessment, marks: updatedMarksData };
      setSelectedAssessment(updatedAssessment);
      setAssessments(previous => previous.map(a => a.id === updatedAssessment.id ? updatedAssessment : a));
      setMarksData(updatedMarksData);

      setHasUnsavedAmendments(false);
      setShowAmendModal(false);
      flashSaved();
    } catch (error) {
      console.error("Error saving amendments:", error);
      alert("Failed to save amendments.");
    }
    setIsSaving(false);
  };

  // ============================================================================
  // CALCULATIONS & STATS
  // ============================================================================
  const calculateTotal = (studentMarks) => {
    if (studentMarks === undefined || studentMarks === null || studentMarks === '') return null;

    if (typeof studentMarks !== 'object') {
      const num = parseFloat(studentMarks);
      return isNaN(num) ? null : num;
    }

    const values = Object.values(studentMarks).filter(v => v !== undefined && v !== '');
    if (values.length === 0) return null;

    return values.reduce((sum, mark) => {
      const num = parseFloat(mark);
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
  };

  const calculateSectionRawTotal = (studentMarks, section) => {
    if (!studentMarks || typeof studentMarks !== 'object') return null;

    if (!section.hasSubSections) {
      const mark = parseFloat(studentMarks[section.id]);
      return !isNaN(mark) ? mark : null;
    }

    let total = 0;
    let hasMark = false;
    section.subSections.forEach(sub => {
      const mark = parseFloat(studentMarks[sub.id]);
      if (!isNaN(mark)) {
        total += mark;
        hasMark = true;
      }
    });
    return hasMark ? total : null;
  };

  const calculateScaledTotal = (studentMarks, assessment) =>
    calculateAssessmentTotal(studentMarks, assessment);

  // Final (after deduction) mark of any saved item for one student.
  const getSavedFinalMark = (assessment, studentId) => {
    const marks = assessment?.marks || {};
    const studentMark = marks[studentId];
    const deduction = parseFloat(marks[`${studentId}_deduction`]) || 0;
    const multi = Array.isArray(assessment?.sectionsConfig) && assessment.sectionsConfig.length > 0;
    const total = multi
      ? calculateScaledTotal(studentMark, assessment)
      : calculateTotal(studentMark);
    return total === null ? null : total - deduction;
  };

  const allClassesStatsData = useMemo(() => {
    if (!selectedAssessment || !showAllClassesModal) return null;
    const marks = [];
    const sectioned = selectedAssessment.sectionsConfig && selectedAssessment.sectionsConfig.length > 0;
    allClassesStudents.forEach(student => {
      const studentMarks = marksData[student.id];
      const rawTotal = calculateTotal(studentMarks);
      const scaledTotal = sectioned ? calculateScaledTotal(studentMarks, selectedAssessment) : rawTotal;
      const deduction = parseFloat(marksData[`${student.id}_deduction`]) || 0;
      if (scaledTotal !== null) {
        marks.push(scaledTotal - deduction);
      }
    });
    return { marks, fullMark: getAssessmentFullMark(selectedAssessment) };
  }, [allClassesStudents, marksData, selectedAssessment, showAllClassesModal]);

  // Modal Terms Logic
  const modalTermsList = useMemo(() => {
    if (modalClasses.length === 0) return [];
    const refClass = modalClasses[0];
    return termsMap[refClass] && termsMap[refClass].length > 0
      ? termsMap[refClass]
      : getDefaultTerms(refClass);
  }, [modalClasses, termsMap]);

  useEffect(() => {
    if (modalClasses.length > 0 && !modalTermsList.includes(modalTerm)) {
      setModalTerm(modalTermsList[0] || '');
    }
  }, [modalClasses, modalTermsList, modalTerm]);

  const linkableDocs = useMemo(() => {
    const items = [];
    archives.forEach(a => {
      items.push({ ...a, linkMode: 'full' });
      a.subQuestions?.forEach(sq => {
        items.push({ ...a, id: `${a.id}_${sq.id}`, title: `${a.title} Q${sq.label}`, linkMode: 'sub' });
      });
    });
    return items;
  }, [archives]);

  const topStudentIds = new Set();
  const hasSections = selectedAssessment?.sectionsConfig && selectedAssessment.sectionsConfig.length > 0;
  const allScaledTotals = [];

  const statsData = {
    final: {
      marks: [],
      fullMark: getAssessmentFullMark(selectedAssessment)
    }
  };

  if (selectedAssessment) {
    if (hasSections) {
      selectedAssessment.sectionsConfig.forEach(sec => {
        if (sec.hasSubSections) {
          sec.subSections.forEach(sub => {
            statsData[sub.id] = { marks: [], fullMark: parseFloat(sub.fullMark) };
          });
          statsData[`sec_${sec.id}`] = { marks: [], fullMark: sec.subSections.reduce((sum, sub) => sum + parseFloat(sub.fullMark), 0) };
        } else {
          statsData[sec.id] = { marks: [], fullMark: parseFloat(sec.fullMark) };
        }
      });
      statsData.scaledTotal = {
        marks: [],
        fullMark: getAssessmentFullMark(selectedAssessment)
      };
    } else {
      statsData.main = { marks: [], fullMark: selectedAssessment.fullMark || 100 };
    }
  }

  if (selectedAssessment && currentClassStudents.length > 0) {
    const totals = currentClassStudents
      .map(s => {
        const studentMarks = marksData[s.id];
        const rawTotal = calculateTotal(studentMarks);
        const scaledTotal = hasSections ? calculateScaledTotal(studentMarks, selectedAssessment) : rawTotal;
        const deduction = parseFloat(marksData[`${s.id}_deduction`]) || 0;

        let finalTotal = null;
        if (scaledTotal !== null) {
          finalTotal = scaledTotal - deduction;
          statsData.final.marks.push(finalTotal);
        }

        if (hasSections) {
          if (scaledTotal !== null) statsData.scaledTotal.marks.push(scaledTotal);

          selectedAssessment.sectionsConfig.forEach(sec => {
            if (sec.hasSubSections) {
              const secRawTotal = calculateSectionRawTotal(studentMarks, sec);
              if (secRawTotal !== null) statsData[`sec_${sec.id}`].marks.push(secRawTotal);

              sec.subSections.forEach(sub => {
                const val = (studentMarks && typeof studentMarks === 'object') ? studentMarks[sub.id] : null;
                if (val !== null && val !== undefined && val !== '' && !isNaN(val)) statsData[sub.id].marks.push(parseFloat(val));
              });
            } else {
              const val = (studentMarks && typeof studentMarks === 'object') ? studentMarks[sec.id] : null;
              if (val !== null && val !== undefined && val !== '' && !isNaN(val)) statsData[sec.id].marks.push(parseFloat(val));
            }
          });
        } else if (studentMarks !== null && studentMarks !== undefined && studentMarks !== '' && !isNaN(studentMarks)) {
          statsData.main.marks.push(parseFloat(studentMarks));
        }

        if (finalTotal !== null) allScaledTotals.push(finalTotal);
        return { id: s.id, total: finalTotal };
      })
      .filter(s => s.total !== null);

    if (totals.length > 0) {
      const values = totals.map(student => student.total);
      totals.forEach(student => {
        if (marksIsTopTwo(student.total, values)) {
          topStudentIds.add(student.id);
        }
      });
    }
  }

  const getStats = (marksArray, fullMarkValue) => {
    const validMarks = marksArray.filter(m => m !== null && !isNaN(m)).map(Number).sort((a, b) => a - b);
    if (validMarks.length === 0) return null;

    const sum = validMarks.reduce((a, b) => a + b, 0);
    const mean = (sum / validMarks.length).toFixed(1);

    const mid = Math.floor(validMarks.length / 2);
    const median = validMarks.length % 2 !== 0 ? validMarks[mid].toFixed(1) : ((validMarks[mid - 1] + validMarks[mid]) / 2).toFixed(1);

    const passThreshold = (Number(fullMarkValue) || 0) / 2;
    const passCount = validMarks.filter(m => m >= passThreshold).length;

    const max = validMarks[validMarks.length - 1].toFixed(1);
    const min = validMarks[0].toFixed(1);

    return { mean, median, passCount, total: validMarks.length, max, min };
  };

  const renderStatCell = (key, stats, { bold = false, className = '' } = {}) => (
    <td key={key} className={className}>
      {stats ? (
        <div className="leading-tight space-y-0.5">
          <div className={bold ? 'font-bold text-blue-800' : 'font-semibold text-slate-700'} title="Mean">{stats.mean}</div>
          <div className="text-slate-500" title="Median">{stats.median}</div>
          <div
            title="Pass count"
            className={`font-semibold ${stats.passCount >= stats.total / 2 ? 'text-green-600' : 'text-red-500'}`}
          >
            {stats.passCount}/{stats.total}
          </div>
        </div>
      ) : (
        <span className="mk-gap">–</span>
      )}
    </td>
  );

  const handleCopyTotals = () => {
    const totalsList = currentClassStudents.map(student => {
      const studentMarks = marksData[student.id];
      const rawTotal = calculateTotal(studentMarks);
      const scaledTotal = hasSections ? calculateScaledTotal(studentMarks, selectedAssessment) : rawTotal;
      const deduction = parseFloat(marksData[`${student.id}_deduction`]) || 0;
      return scaledTotal !== null ? (scaledTotal - deduction).toFixed(1) : '';
    });

    navigator.clipboard.writeText(totalsList.join('\n')).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
      alert('Failed to copy totals.');
    });
  };

  const getGraphData = () => {
    const bins = Array.from({ length: 10 }, (_, index) => ({
      name: index === 9 ? '90–100%' : `${index * 10}–${(index + 1) * 10}%`,
      count: 0
    }));

    const full = getAssessmentFullMark(selectedAssessment);
    if (full <= 0) return bins;

    allScaledTotals.forEach(score => {
      const percentage = (score / full) * 100;
      const index = Math.max(0, Math.min(9, Math.floor(percentage / 10)));
      bins[index].count++;
    });

    return bins;
  };

  // ============================================================================
  // TERM SCORE PRESETS
  // ============================================================================
  const handleAddPreset = async (e) => {
    e.preventDefault();
    if (!newPresetName.trim()) return;

    const presetData = {
      id: generateId(),
      name: newPresetName.trim(),
      weights: newPresetWeights,
      owner: user.email,
      isShared: user.email === SUPER_ADMIN_EMAIL ? isSharedPreset : false
    };

    try {
      const presetsRef = doc(db, "settings", "presets");
      const presetsSnap = await getDoc(presetsRef);
      const allPresets = presetsSnap.exists() && presetsSnap.data().list ? presetsSnap.data().list : [];

      allPresets.push(presetData);
      await setDoc(presetsRef, { list: allPresets }, { merge: true });

      setPresets(marksVisiblePresets(allPresets, user?.email));
      setNewPresetName('');
      setNewPresetWeights({});
      setIsSharedPreset(false);
      setSelectedPresetId(presetData.id);
    } catch (error) {
      console.error("Error saving preset:", error);
      alert("Failed to save preset.");
    }
  };

  const handleDeletePreset = async (id) => {
    const presetToDelete = presets.find(p => p.id === id);
    if (presetToDelete?.isShared && presetToDelete?.owner !== user.email && user?.email !== SUPER_ADMIN_EMAIL) {
      alert("You cannot delete a shared preset created by the super admin.");
      return;
    }
    if (!window.confirm(`Delete the preset "${presetToDelete?.name || ''}"?`)) return;

    try {
      const presetsRef = doc(db, "settings", "presets");
      const presetsSnap = await getDoc(presetsRef);
      let allPresets = presetsSnap.exists() && presetsSnap.data().list ? presetsSnap.data().list : [];

      allPresets = allPresets.filter(p => p.id !== id);
      await setDoc(presetsRef, { list: allPresets }, { merge: true });

      const visiblePresets = marksVisiblePresets(allPresets, user?.email);
      setPresets(visiblePresets);
      if (selectedPresetId === id) {
        setSelectedPresetId(visiblePresets.length > 0 ? visiblePresets[0].id : '');
      }
    } catch (error) {
      console.error("Error deleting preset:", error);
    }
  };

  const handleToggleShareExistingPreset = async (id, currentShareStatus) => {
    try {
      const presetsRef = doc(db, "settings", "presets");
      const presetsSnap = await getDoc(presetsRef);
      let allPresets = presetsSnap.exists() && presetsSnap.data().list ? presetsSnap.data().list : [];

      allPresets = allPresets.map(p => p.id === id ? { ...p, isShared: !currentShareStatus } : p);
      await setDoc(presetsRef, { list: allPresets }, { merge: true });

      setPresets(marksVisiblePresets(allPresets, user?.email));
    } catch (error) {
      console.error("Error toggling preset share status:", error);
    }
  };

  const updatePresetWeight = (cat, value) => {
    setNewPresetWeights(prev => ({
      ...prev,
      [cat]: parseFloat(value) || 0
    }));
  };

  const assignHighlights = (data) => {
    const N = data.length;
    if (N < 3) return data;
    const sorted = [...data].sort((a, b) => parseFloat(b.overallScore) - parseFloat(a.overallScore));

    for (let i = 0; i < Math.min(3, N); i++) sorted[i].highlight = 'top';

    const midTarget = Math.floor(N / 3);
    const midStart = Math.max(3, midTarget - 1);
    for (let i = midStart; i < Math.min(midStart + 3, N); i++) {
      if (!sorted[i].highlight) sorted[i].highlight = 'middle';
    }

    const botTarget = Math.floor((2 * N) / 3);
    const botStart = Math.max(midStart + 3, botTarget - 1);
    for (let i = botStart; i < Math.min(botStart + 3, N); i++) {
      if (!sorted[i].highlight) sorted[i].highlight = 'bottom';
    }

    return sorted.sort((a, b) => {
      if (a.student.className !== b.student.className) return a.student.className.localeCompare(b.student.className);
      return String(a.student.classNumber).localeCompare(String(b.student.classNumber), undefined, { numeric: true });
    });
  };

  // mode: 'preset' | 'la-hw' | 'la-lesson'
  const calculateTermScores = async (mode = 'preset') => {
    if (modalClasses.length === 0 || !modalTerm) {
      alert('Choose at least one class and a term.');
      return;
    }

    const preset = presets.find(p => p.id === selectedPresetId);
    if (mode === 'preset' && !preset) {
      alert('Choose a calculation preset first.');
      return;
    }

    setCalculatingMode(mode);

    try {
      const querySnapshot = await getDocs(query(collection(db, "assessments")));

      const allTermAssessments = querySnapshot.docs
        .map(document => ({
          ...document.data(),
          id: document.id
        }))
        .filter(assessment => {
          if (assessment.designatedPending === true) return false;

          const matchesClass = Array.isArray(assessment.classes)
            ? assessment.classes.some(name => modalClasses.includes(name))
            : modalClasses.includes(assessment.className);

          return matchesClass && assessment.term === modalTerm;
        });

      const modalStudents = students
        .filter(s => modalClasses.includes(s.className))
        .sort((a, b) => {
          if (a.className !== b.className) return a.className.localeCompare(b.className);
          return String(a.classNumber).localeCompare(String(b.classNumber), undefined, { numeric: true });
        });

      const sumAssessments = (list, student) => {
        let totalRaw = 0;
        let totalFull = 0;

        list.forEach(assessment => {
          if (!marksAssessmentBelongsToClass(assessment, student.className)) return;

          const marks = assessment.marks || {};
          const studentMark = marks[student.id];
          const deduction = parseFloat(marks[`${student.id}_deduction`]) || 0;
          const total = calculateAssessmentTotal(studentMark, assessment);
          const actualMark = total !== null ? total : 0;

          totalRaw += actualMark - deduction;
          totalFull += getAssessmentFullMark(assessment);
        });
        return { raw: totalRaw, full: totalFull };
      };

      const byCategory = category => allTermAssessments.filter(a => a.category === category);
      const utAssessments = byCategory('Uniform Test');
      const examAssessments = byCategory('Exam');
      const assignAssessments = byCategory('Assignments');

      let scoresData = [];

      if (mode === 'la-hw') {
        scoresData = modalStudents.map(student => {
          const aStats = sumAssessments(assignAssessments, student);
          const score = aStats.full > 0 ? Math.round((aStats.raw / aStats.full) * 5) : 0;
          return {
            student,
            categoryScores: {
              'Homework': { score, raw: aStats.raw, full: aStats.full, weight: 100 }
            },
            overallScore: score.toString(),
            rawUT: sumAssessments(utAssessments, student).raw,
            rawExam: sumAssessments(examAssessments, student).raw
          };
        });
      } else if (mode === 'la-lesson') {
        scoresData = modalStudents.map(student => {
          const aStats = sumAssessments(assignAssessments, student);
          const assignPercent = aStats.full > 0 ? (aStats.raw / aStats.full) : 0;
          const recordCount = student.recordCount || 0;

          const bonus = assignPercent > 0.9 ? 1 : 0;
          let score = 4 + bonus - Math.floor(recordCount / 2);
          if (assignPercent < 0.6) score = Math.min(score, 3);
          score = Math.max(0, Math.min(5, score));

          return {
            student,
            categoryScores: {
              'Assignments %': { score: assignPercent * 100, raw: aStats.raw, full: aStats.full, weight: 0 },
              'Records': { score: recordCount, raw: recordCount, full: 0, weight: 0 }
            },
            overallScore: score.toString(),
            rawUT: sumAssessments(utAssessments, student).raw,
            rawExam: sumAssessments(examAssessments, student).raw
          };
        });
      } else if (preset.name === 'JS Geography') {
        const quizAssessments = byCategory('Quizzes');

        scoresData = modalStudents.map(student => {
          const aStats = sumAssessments(assignAssessments, student);
          const qStats = sumAssessments(quizAssessments, student);
          const utStats = sumAssessments(utAssessments, student);
          const examStats = sumAssessments(examAssessments, student);

          const combinedAQRaw = aStats.raw + qStats.raw;
          const combinedAQFull = aStats.full + qStats.full;

          const aqScore = combinedAQFull > 0 ? (combinedAQRaw / combinedAQFull) * 50 : 0;
          const utScore = utStats.full > 0 ? (utStats.raw / utStats.full) * 50 : 0;

          return {
            student,
            categoryScores: {
              'Assignments & Quizzes': { score: aqScore, raw: combinedAQRaw, full: combinedAQFull, weight: 50 },
              'Uniform Test': { score: utScore, raw: utStats.raw, full: utStats.full, weight: 50 }
            },
            overallScore: (aqScore + utScore).toFixed(1),
            rawUT: utStats.raw,
            rawExam: examStats.raw
          };
        });
      } else {
        scoresData = modalStudents.map(student => {
          let overallScore = 0;
          const categoryScores = {};

          Object.keys(preset.weights || {}).forEach(cat => {
            const weight = Number(preset.weights?.[cat]) || 0;
            if (weight === 0) return;

            const catStats = sumAssessments(byCategory(cat), student);

            if (catStats.full > 0) {
              const catScore = (catStats.raw / catStats.full) * weight;
              categoryScores[cat] = { score: catScore, raw: catStats.raw, full: catStats.full, weight };
              overallScore += catScore;
            } else {
              categoryScores[cat] = { score: 0, raw: 0, full: 0, weight };
            }
          });

          return {
            student,
            categoryScores,
            overallScore: overallScore.toFixed(1),
            rawUT: sumAssessments(utAssessments, student).raw,
            rawExam: sumAssessments(examAssessments, student).raw
          };
        });
      }

      setTermScoresData(assignHighlights(scoresData));
      setTermResultMode(mode);
    } catch (error) {
      console.error("Error calculating term scores:", error);
      alert("Failed to calculate term scores.");
    }

    setCalculatingMode('');
  };

  const displayCategories = termScoresData.length > 0 ? Object.keys(termScoresData[0].categoryScores) : [];
  const termIsLearningAttitude = termResultMode === 'la-hw' || termResultMode === 'la-lesson';

  const getTermPrefix = () => (modalTerm.includes('Term 2') ? 'T2' : 'T1');

  const handleCopyScores = (type) => {
    if (termScoresData.length === 0) return;

    let rows = [];
    if (type === 'A1') {
      rows = termScoresData.map(data => data.overallScore);
    } else if (type === 'A2') {
      rows = termScoresData.map(data => data.rawExam !== undefined ? data.rawExam.toFixed(1) : '');
    } else if (type === 'A3') {
      rows = termScoresData.map(data => data.rawUT !== undefined ? data.rawUT.toFixed(1) : '');
    }

    navigator.clipboard.writeText(rows.join('\n')).then(() => {
      setTermCopySuccess(type);
      setTimeout(() => setTermCopySuccess(false), 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
      alert('Failed to copy scores.');
    });
  };

  const openTermScoreModal = () => {
    setModalClasses(selectedClass ? [selectedClass] : []);
    setModalTerm(selectedTerm);
    const defaultPreset = classPresetsMap[selectedClass];
    setSelectedPresetId(
      presets.some(p => p.id === defaultPreset)
        ? defaultPreset
        : (presets.find(p => p.name === 'JS Geography')?.id || presets[0]?.id || '')
    );
    setTermScoresData([]);
    setTermResultMode('');
    setClassPickerOpen(false);
    setShowTermScoreModal(true);
  };

  // ============================================================================
  // DOCUMENT PREVIEW & LINKED MARKS
  // ============================================================================
  const handleOpenPreview = (docId) => {
    let parentDoc = archives.find(archive => archive.id === docId);
    let childDoc = null;

    if (!parentDoc) {
      for (const archive of archives) {
        const match = (archive.subQuestions || []).find(
          child => `${archive.id}_${child.id}` === docId
        );

        if (match) {
          parentDoc = archive;
          childDoc = match;
          break;
        }
      }
    }

    if (!parentDoc) {
      alert('This linked document is not in the loaded catalogue. Refresh the page and try again.');
      return;
    }

    const parent = {
      ...parentDoc,
      hasFile: Boolean(parentDoc.fileUrl || parentDoc.fileUrlChi),
      hasAnswer: Boolean(parentDoc.answerFileUrl || parentDoc.answerFileUrlChi)
    };

    setViewingAnswer(false);
    setPreviewLanguage(!parent.fileUrl && parent.fileUrlChi ? 'zh' : 'en');

    setPreviewItem({
      parent,
      ...(childDoc ? { child: childDoc } : {}),
      isFullPaper: !childDoc
    });
  };

  const handleViewLinkedMarks = async (docId, docTitle) => {
    if (!user?.isAdmin) return;

    const requestId = ++linkedMarksRequestRef.current;

    setCurrentMarksDocTitle(docTitle);
    setLinkedMarksData([]);
    setLinkedMarksError('');
    setLinkedMarksMode('total');
    setShowMarksModal(true);
    setIsLoadingMarks(true);

    try {
      const records = await loadLinkedAssessmentMarks(docId);
      if (requestId !== linkedMarksRequestRef.current) return;
      setLinkedMarksData(records);
    } catch (error) {
      if (requestId !== linkedMarksRequestRef.current) return;
      console.error('Error fetching linked assessment marks:', error);
      setLinkedMarksError(
        `${error.code || 'marks-load-error'}: ` +
        (error.message || 'The linked marks could not be loaded.')
      );
    } finally {
      if (requestId === linkedMarksRequestRef.current) {
        setIsLoadingMarks(false);
      }
    }
  };

  // ============================================================================
  // EXPORT TO EXCEL
  // ============================================================================
  const openExportModal = async () => {
    if (!selectedClass || !selectedTerm) {
      alert("Please select a class and term first.");
      return;
    }

    const querySnapshot = await getDocs(query(collection(db, "assessments")));
    const allTermAssessments = querySnapshot.docs
      .map(document => ({
        ...document.data(),
        id: document.id
      }))
      .filter(assessment => {
        if (assessment.designatedPending === true) return false;

        const matchesClass = Array.isArray(assessment.classes)
          ? assessment.classes.includes(selectedClass)
          : assessment.className === selectedClass;

        return matchesClass && assessment.term === selectedTerm;
      });

    allTermAssessments.sort((a, b) => new Date(a.date) - new Date(b.date));

    const exportCategories = marksUniqueNames([
      ...MARKS_DEFAULT_CATEGORIES,
      ...categories,
      ...allTermAssessments.map(assessment => assessment.category)
    ]);

    const grouped = Object.fromEntries(
      exportCategories.map(category => [category, []])
    );

    allTermAssessments.forEach(assessment => {
      const category = assessment.category || 'Others';
      if (!Object.prototype.hasOwnProperty.call(grouped, category)) {
        grouped[category] = [];
      }
      grouped[category].push(assessment);
    });

    setExportAssessmentsMap(grouped);
    const defaultPreset = classPresetsMap[selectedClass];
    setExportPresetId(
      presets.some(p => p.id === defaultPreset)
        ? defaultPreset
        : (presets[0]?.id || '')
    );
    setShowExportModal(true);
  };

  const moveExportItem = (category, index, direction) => {
    const newMap = { ...exportAssessmentsMap };
    const list = [...newMap[category]];
    if (direction === 'up' && index > 0) {
      [list[index - 1], list[index]] = [list[index], list[index - 1]];
    } else if (direction === 'down' && index < list.length - 1) {
      [list[index + 1], list[index]] = [list[index], list[index + 1]];
    }
    newMap[category] = list;
    setExportAssessmentsMap(newMap);
  };

  const generateExcel = () => {
    if (!exportPresetId) {
      alert("Please select a calculation preset.");
      return;
    }

    const preset = presets.find(p => p.id === exportPresetId);
    if (!preset) {
      alert("Please select a calculation preset.");
      return;
    }
    const isJSGeog = preset.name === 'JS Geography';

    const inCalc = (cat) => {
      if (isJSGeog) return ['Assignments', 'Quizzes', 'Uniform Test'].includes(cat);
      return (preset.weights?.[cat] || 0) > 0;
    };

    const baseCategories = marksUniqueNames([
      'Assignments',
      'Quizzes',
      'Others',
      'Uniform Test',
      'RAC',
      ...Object.keys(exportAssessmentsMap),
      ...Object.keys(preset.weights || {})
    ]).filter(category => category !== 'Exam');

    const activeCalcCategories = baseCategories.filter(category =>
      inCalc(category) ||
      (exportAssessmentsMap[category] || []).length > 0
    );

    const examInCalc = inCalc('Exam');
    const hasExamItems = (exportAssessmentsMap['Exam'] || []).length > 0;

    const layout = [...activeCalcCategories];
    if (examInCalc) {
      layout.push('Exam');
      layout.push('Total Term Score');
    } else {
      layout.push('Total Term Score');
      if (hasExamItems) {
        layout.push('Empty');
        layout.push('Exam');
      }
    }

    let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">';
    html += '<head><meta charset="UTF-8"><meta name="ProgId" content="Excel.Sheet"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Marks</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table border="1">';

    html += '<tr><th rowSpan="3">Class No.</th><th rowSpan="3">English Name</th>';
    layout.forEach(col => {
      if (col === 'Total Term Score') {
        html += `<th rowSpan="3" style="background-color:#dbeafe; font-weight:bold; text-align:center;">Total Term Score</th>`;
      } else if (col === 'Empty') {
        html += `<th rowSpan="3" style="background-color:#ffffff; border:none; min-width: 40px;"></th>`;
      } else {
        const cat = col;
        const items = exportAssessmentsMap[cat] || [];

        let colSpan = 0;
        items.forEach(item => {
          if (item.sectionsConfig && item.sectionsConfig.length > 0) {
            item.sectionsConfig.forEach(sec => {
              colSpan += sec.hasSubSections ? sec.subSections.length + 1 : 1;
            });
            colSpan += 1;
          } else {
            colSpan += 1;
          }
        });

        let hasCatTotal = inCalc(cat);
        if (isJSGeog && cat === 'Assignments') hasCatTotal = false;
        if (hasCatTotal) colSpan += 1;

        if (colSpan > 0) {
          html += `<th colSpan="${colSpan}" style="background-color:#f3f4f6; font-weight:bold; text-align:center;">${cat}</th>`;
        }
      }
    });
    html += '</tr>';

    html += '<tr>';
    layout.forEach(col => {
      if (col === 'Total Term Score' || col === 'Empty') return;

      const cat = col;
      const items = exportAssessmentsMap[cat] || [];

      items.forEach(item => {
        if (item.sectionsConfig && item.sectionsConfig.length > 0) {
          item.sectionsConfig.forEach(sec => {
            if (sec.hasSubSections) {
              sec.subSections.forEach(sub => {
                html += `<th style="white-space:nowrap;">${sec.name} ${sub.name}</th>`;
              });
              html += `<th style="background-color:#f9fafb; white-space:nowrap;">${sec.name} Total</th>`;
            } else {
              html += `<th style="white-space:nowrap;">${sec.name}</th>`;
            }
          });
          html += `<th style="background-color:#f3f4f6; font-weight:bold; white-space:nowrap;">${item.name} Total</th>`;
        } else {
          html += `<th style="white-space:nowrap;">${item.name}</th>`;
        }
      });

      let hasCatTotal = inCalc(cat);
      if (isJSGeog && cat === 'Assignments') hasCatTotal = false;
      if (hasCatTotal) {
        let catName = cat;
        if (isJSGeog && cat === 'Quizzes') catName = 'A+Q';
        html += `<th style="background-color:#e5e7eb; white-space:nowrap;">${catName} Total</th>`;
      }
    });
    html += '</tr>';

    html += '<tr>';
    layout.forEach(col => {
      if (col === 'Total Term Score' || col === 'Empty') return;

      const cat = col;
      const items = exportAssessmentsMap[cat] || [];

      items.forEach(item => {
        if (item.sectionsConfig && item.sectionsConfig.length > 0) {
          item.sectionsConfig.forEach(sec => {
            if (sec.hasSubSections) {
              sec.subSections.forEach(sub => {
                html += `<th>(/${sub.fullMark})</th>`;
              });
              html += `<th style="background-color:#f9fafb;">(/${getSectionRawFullMark(sec)})</th>`;
            } else {
              html += `<th>(/${sec.fullMark})</th>`;
            }
          });
          html += `<th style="background-color:#f3f4f6; font-weight:bold;">(/${getAssessmentFullMark(item)})</th>`;
        } else {
          html += `<th>(/${item.fullMark || 100})</th>`;
        }
      });

      let hasCatTotal = inCalc(cat);
      if (isJSGeog && cat === 'Assignments') hasCatTotal = false;
      if (hasCatTotal) {
        let weightLabel = preset.weights?.[cat] || 0;
        if (isJSGeog && (cat === 'Quizzes' || cat === 'Uniform Test')) weightLabel = '50';
        html += `<th style="background-color:#e5e7eb;">(/${weightLabel})</th>`;
      }
    });
    html += '</tr>';

    currentClassStudents.forEach(student => {
      html += `<tr><td>${student.classNumber}</td><td>${student.englishName}</td>`;

      let totalTermScore = 0;
      let jsGeogAQRaw = 0;
      let jsGeogAQFull = 0;

      layout.forEach(col => {
        if (col === 'Total Term Score') {
          html += `<td style="background-color:#eff6ff; font-weight:bold;">${totalTermScore.toFixed(1)}</td>`;
          return;
        }
        if (col === 'Empty') {
          html += `<td style="background-color:#ffffff; border:none;"></td>`;
          return;
        }

        const cat = col;
        const items = exportAssessmentsMap[cat] || [];
        let catRawTotal = 0;
        let catFullTotal = 0;

        items.forEach(item => {
          const marks = item.marks || {};
          const studentMark = marks[student.id];
          const deduction = parseFloat(marks[`${student.id}_deduction`]) || 0;

          let finalMark = null;

          if (item.sectionsConfig && item.sectionsConfig.length > 0) {
            item.sectionsConfig.forEach(sec => {
              if (sec.hasSubSections) {
                let secRawTotal = 0;
                let hasSecMark = false;
                sec.subSections.forEach(sub => {
                  const val = (studentMark && typeof studentMark === 'object') ? studentMark[sub.id] : null;
                  if (val !== null && val !== undefined && val !== '' && !isNaN(val)) {
                    html += `<td>${parseFloat(val).toFixed(1)}</td>`;
                    secRawTotal += parseFloat(val);
                    hasSecMark = true;
                  } else {
                    html += `<td>-</td>`;
                  }
                });
                html += hasSecMark
                  ? `<td style="background-color:#f9fafb;">${secRawTotal.toFixed(1)}</td>`
                  : `<td style="background-color:#f9fafb;">-</td>`;
              } else {
                const val = (studentMark && typeof studentMark === 'object') ? studentMark[sec.id] : null;
                if (val !== null && val !== undefined && val !== '' && !isNaN(val)) {
                  html += `<td>${parseFloat(val).toFixed(1)}</td>`;
                } else {
                  html += `<td>-</td>`;
                }
              }
            });

            const scaled = calculateScaledTotal(studentMark, item);
            if (scaled !== null) {
              finalMark = scaled - deduction;
              html += `<td style="background-color:#f3f4f6; font-weight:bold;">${finalMark.toFixed(1)}</td>`;
            } else {
              html += `<td style="background-color:#f3f4f6; font-weight:bold;">-</td>`;
            }
          } else {
            const raw = calculateTotal(studentMark);
            if (raw !== null) {
              finalMark = raw - deduction;
              html += `<td>${finalMark.toFixed(1)}</td>`;
            } else {
              html += `<td>-</td>`;
            }
          }

          if (finalMark !== null) {
            catRawTotal += finalMark;
            catFullTotal += getAssessmentFullMark(item);
          }
        });

        if (isJSGeog && (cat === 'Assignments' || cat === 'Quizzes')) {
          jsGeogAQRaw += catRawTotal;
          jsGeogAQFull += catFullTotal;
        }

        let hasCatTotal = inCalc(cat);
        if (isJSGeog && cat === 'Assignments') hasCatTotal = false;

        if (hasCatTotal) {
          const catWeight = preset.weights?.[cat] || 0;
          let catScore = 0;

          if (isJSGeog) {
            if (cat === 'Quizzes' && jsGeogAQFull > 0) {
              catScore = (jsGeogAQRaw / jsGeogAQFull) * 50;
              totalTermScore += catScore;
            } else if (cat === 'Uniform Test' && catFullTotal > 0) {
              catScore = (catRawTotal / catFullTotal) * 50;
              totalTermScore += catScore;
            }
          } else if (catFullTotal > 0 && catWeight > 0) {
            catScore = (catRawTotal / catFullTotal) * catWeight;
            totalTermScore += catScore;
          }

          html += `<td style="background-color:#f9fafb;">${catScore.toFixed(1)}</td>`;
        }
      });
      html += '</tr>';
    });

    html += '</table></body></html>';

    const wb = XLSX.read(html, { type: 'string' });
    XLSX.writeFile(wb, `${cleanClassName(selectedClass)}_${selectedTerm}_Marks.xlsx`);

    setShowExportModal(false);
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] flex-1">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
      </div>
    );
  }

  // Overview stats for the selected category
  const overviewStats = {};
  const overviewTotalStats = { marks: [], fullMark: 0 };

  if (view === 'overview' && assessments.length > 0) {
    assessments.forEach(a => {
      overviewStats[a.id] = {
        marks: [],
        fullMark: a.designatedPending ? 0 : getAssessmentFullMark(a)
      };
      overviewTotalStats.fullMark += overviewStats[a.id].fullMark;
    });

    currentClassStudents.forEach(student => {
      let studentTotal = 0;
      let hasAnyMark = false;

      assessments.forEach(a => {
        const finalMark = getSavedFinalMark(a, student.id);
        if (finalMark !== null) {
          overviewStats[a.id].marks.push(finalMark);
          studentTotal += finalMark;
          hasAnyMark = true;
        }
      });

      if (hasAnyMark) overviewTotalStats.marks.push(studentTotal);
    });
  }

  const itemStatus = item =>
    item.designatedPending
      ? 'pending'
      : marksCountEntered(item.marks, currentStudentIds) > 0
        ? 'done'
        : 'empty';

  const classOptions = (() => {
    if (classes.length === 0 && archivedClasses.length === 0) {
      return <option value="">No classes</option>;
    }

    const groupBy = (list, archived) => Object.entries(list.reduce((acc, c) => {
      const owner = c.owner === user?.email ? 'you' : c.owner;
      const key = `${archived ? 'Archived' : 'Active'} · created by ${owner}`;
      (acc[key] = acc[key] || []).push(c);
      return acc;
    }, {}));

    if (user?.email === SUPER_ADMIN_EMAIL) {
      return [...groupBy(classes, false), ...groupBy(archivedClasses, true)].map(([group, items]) => (
        <optgroup key={group} label={group}>
          {items.map(c => (
            <option key={c.name} value={c.name}>
              {cleanClassName(c.name)}{c.isArchived ? ' (Archived)' : ''}
            </option>
          ))}
        </optgroup>
      ));
    }

    return (
      <>
        {classes.length > 0 && (
          <optgroup label="Active classes">
            {classes.map(c => <option key={c.name} value={c.name}>{cleanClassName(c.name)}</option>)}
          </optgroup>
        )}
        {archivedClasses.length > 0 && (
          <optgroup label="Archived classes">
            {archivedClasses.map(c => <option key={c.name} value={c.name}>{cleanClassName(c.name)} (Archived)</option>)}
          </optgroup>
        )}
      </>
    );
  })();

  const renderItemCard = item => {
    const status = itemStatus(item);
    const entered = marksCountEntered(item.marks, currentStudentIds);
    const multi = Array.isArray(item.sectionsConfig) && item.sectionsConfig.length > 0;

    return (
      <li key={item.id}>
        <button
          type="button"
          onClick={() => openItem(item)}
          className={`mk-item is-${status} ${item.designatedSource ? 'is-compulsory' : ''}`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-semibold text-slate-800 break-words min-w-0">
              {item.name}
            </span>
            <span
              className={`mk-chip shrink-0 ${status === 'done'
                ? 'mk-chip-green'
                : status === 'pending'
                  ? 'mk-chip-yellow'
                  : ''
                }`}
            >
              {status === 'done'
                ? `${entered}/${currentStudentIds.length}`
                : status === 'pending'
                  ? 'Configure'
                  : 'No marks'}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {item.date || 'No date'}
            {' · '}
            {status === 'pending' ? 'Not configured' : `Full mark ${getAssessmentFullMark(item)}`}
          </div>
          {(item.designatedSource || multi || !item.isDisclosed) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.designatedSource && (
                <span className={`mk-chip ${status === 'pending' ? 'mk-chip-yellow' : status === 'done' ? 'mk-chip-green' : ''}`}>
                  Compulsory
                </span>
              )}
              {multi && <span className="mk-chip mk-chip-purple">Multi-section</span>}
              {!item.isDisclosed && <span className="mk-chip"><EyeOff />Hidden</span>}
            </div>
          )}
        </button>
      </li>
    );
  };

  const showDeductCol = !studentView && showDeduct;
  const trailingCols =
    1 + (showDeductCol ? 1 : 0) + 1 + (isMultiSectionCategory ? 1 : 0) + 1 + (!studentView ? 1 : 0);

  const overallStats = selectedAssessment
    ? getStats(statsData.final.marks, statsData.final.fullMark)
    : null;

  const selectedPreset = presets.find(p => p.id === selectedPresetId);

  const termFormulaText = termResultMode === 'la-hw'
    ? LA_HOMEWORK_FORMULA
    : termResultMode === 'la-lesson'
      ? LA_LESSON_FORMULA
      : describePresetFormula(selectedPreset);

  const sectionWeightTotal = sectionsConfig.reduce(
    (sum, section) => sum + (Number(section.weight) || 0),
    0
  );

  const rawSectionsTotal = sectionsConfig.reduce(
    (sum, section) => sum + getSectionRawFullMark(section),
    0
  );

  const layoutLocked = isEditingAssessment && !selectedAssessment?.designatedPending;

  // ==========================================================================
  return (
    <div className="marks-page flex flex-col flex-1 min-h-0 min-w-0 w-full bg-slate-50 text-slate-800">
      <style>{MARKS_CSS}</style>

      {/* ===== TOP BAR ===== */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2 h-[34px] pr-2">
            <BookOpen className="w-5 h-5 text-blue-600" />
            <h1 className="text-base font-bold text-slate-800">Marks</h1>
          </div>

          <label className="mk-field">
            <span className="mk-label">Class</span>
            <select
              className="mk-input min-w-[170px]"
              value={selectedClass}
              onChange={event => {
                if (!guardUnsaved()) return;
                setSelectedClass(event.target.value);
              }}
            >
              {classOptions}
            </select>
          </label>

          <label className="mk-field">
            <span className="mk-label">Term</span>
            <select
              className="mk-input min-w-[140px]"
              value={selectedTerm}
              onChange={event => {
                if (!guardUnsaved()) return;
                setSelectedTerm(event.target.value);
              }}
            >
              {!selectedTerm && (
                <option value="" disabled>
                  {termPreferenceError
                    ? 'Select a term'
                    : terms.length
                      ? 'Restoring last term…'
                      : 'No terms'}
                </option>
              )}
              {terms.map(term => (
                <option key={term} value={term}>{term}</option>
              ))}
            </select>
          </label>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="mk-btn mk-btn-soft-purple"
              onClick={openTermScoreModal}
              title="Calculate weighted term scores"
            >
              <Calculator /> Term Score
            </button>
            <button
              type="button"
              className="mk-btn"
              onClick={openExportModal}
              title="Export this class and term to Excel"
            >
              <Download /> Export
            </button>
            <button
              type="button"
              className={`mk-btn ${studentView ? 'mk-btn-warn' : ''}`}
              onClick={() => setStudentView(!studentView)}
              aria-pressed={studentView}
              title="Hide individual marks on this screen (does not change student disclosure)"
            >
              {studentView ? <EyeOff /> : <Eye />}
              Student View {studentView ? 'On' : 'Off'}
            </button>
            <button
              type="button"
              className="mk-btn mk-btn-icon"
              onClick={() => openSettings('general')}
              title="Settings: default score method, terms, categories, presets"
              aria-label="Settings"
            >
              <Settings />
            </button>
          </div>
        </div>

        {termPreferenceError && (
          <p role="alert" className="mt-2 text-xs text-red-700">{termPreferenceError}</p>
        )}
      </div>

      {/* ===== BODY ===== */}
      <div className="flex-1 min-h-0 flex">
        {/* ----- Item rail (only when an item / overview is open) ----- */}
        {view !== 'home' && (
          <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white min-h-0">
            <div className="p-3 space-y-2.5 border-b border-slate-200">
              <button
                type="button"
                className="mk-btn mk-btn-ghost mk-btn-sm w-full justify-start"
                onClick={goHome}
              >
                <LayoutGrid /> All items · {selectedTerm}
              </button>

              <label className="mk-field">
                <span className="mk-label">Category</span>
                <select
                  className="mk-input w-full"
                  value={selectedCategory}
                  onChange={event => openOverview(event.target.value)}
                >
                  {categories.map(category => (
                    <option key={category} value={category}>
                      {category} ({termCountByCategory[category] || 0})
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`mk-btn mk-btn-sm ${view === 'overview' ? 'mk-btn-soft' : ''}`}
                  onClick={() => openOverview(selectedCategory)}
                >
                  <Layers /> Overview
                </button>
                <button
                  type="button"
                  className="mk-btn mk-btn-sm"
                  onClick={() => openAddModal(selectedCategory)}
                  disabled={!selectedTerm}
                >
                  <Plus /> New item
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-2">
              {isAssessmentsLoading ? (
                <div className="p-4 flex items-center justify-center gap-2 text-sm text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              ) : assessmentsError ? (
                <p className="p-3 text-sm text-red-600" role="alert">{assessmentsError}</p>
              ) : assessments.length === 0 ? (
                <p className="p-3 text-sm text-slate-400 text-center">
                  No {selectedCategory} items in {selectedTerm || 'this term'}.
                </p>
              ) : (
                <>
                  <ul className="space-y-1">
                    {assessments.map((item, index) => {
                      const status = itemStatus(item);
                      const entered = marksCountEntered(item.marks, currentStudentIds);
                      const isActive = view === 'item' && selectedAssessment?.id === item.id;

                      return (
                        <li
                          key={item.id}
                          draggable
                          onDragStart={() => { dragIndexRef.current = index; }}
                          onDragOver={event => {
                            event.preventDefault();
                            if (dragOverIndex !== index) setDragOverIndex(index);
                          }}
                          onDrop={event => {
                            event.preventDefault();
                            reorderAssessments(dragIndexRef.current, index);
                            dragIndexRef.current = null;
                            setDragOverIndex(null);
                          }}
                          onDragEnd={() => {
                            dragIndexRef.current = null;
                            setDragOverIndex(null);
                          }}
                          className={dragOverIndex === index && dragIndexRef.current !== index ? 'mk-drop-target' : ''}
                        >
                          <button
                            type="button"
                            onClick={() => openItem(item)}
                            aria-pressed={isActive}
                            className={`mk-rail-item is-${status} ${item.designatedSource ? 'is-compulsory' : ''} ${isActive ? 'is-active' : ''}`}
                          >
                            <GripVertical className="mk-grip" />
                            <span className="flex-1 min-w-0">
                              <span className={`block truncate text-[13px] font-semibold ${isActive ? 'text-blue-700' : 'text-slate-800'}`}>
                                {item.name}
                              </span>
                              <span className="block text-[11px] text-slate-500 truncate">
                                {item.date || 'No date'}
                                {' · '}
                                {status === 'pending' ? 'Configure' : `${entered}/${currentStudentIds.length}`}
                                {item.designatedSource ? ' · Compulsory' : ''}
                              </span>
                            </span>
                            <span className={`mk-dot mk-dot-${status}`} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-3 px-2 text-[11px] text-slate-400">Drag items to reorder.</p>
                </>
              )}
            </div>
          </aside>
        )}

        {/* ----- Main panel ----- */}
        <main className="flex-1 min-w-0 min-h-0 flex flex-col">
          {/* ======== HOME BOARD ======== */}
          {view === 'home' && (
            <div className="flex-1 min-h-0 overflow-auto p-4 md:p-6">
              <div className="max-w-6xl mx-auto space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">
                      {cleanClassName(selectedClass) || 'No class'} · {selectedTerm || 'No term'}
                    </h2>
                    <p className="text-sm text-slate-500">
                      {(termBoard || []).reduce((sum, group) => sum + group.items.length, 0)} items
                      {' · '}
                      {currentClassStudents.length} students
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5"><span className="mk-dot mk-dot-done" />Marks entered</span>
                    <span className="flex items-center gap-1.5"><span className="mk-dot mk-dot-pending" />Needs configuration</span>
                    <span className="flex items-center gap-1.5"><span className="mk-dot" />No marks yet</span>
                  </div>
                </div>

                {categoryLoadError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
                    {categoryLoadError}
                  </div>
                ) : !selectedClass ? (
                  <div className="mk-card p-10 text-center text-slate-500">Select a class to begin.</div>
                ) : !selectedTerm ? (
                  <div className="mk-card p-10 text-center text-slate-500">
                    Select a term, or add one in <button type="button" className="text-blue-600 font-semibold underline" onClick={() => openSettings('terms')}>Settings → Terms</button>.
                  </div>
                ) : !termBoard ? (
                  <div className="mk-card p-10 flex items-center justify-center gap-2 text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-600" /> Loading items…
                  </div>
                ) : (
                  <>
                    {termBoard.filter(group => group.items.length > 0).map(group => (
                      <section key={group.category} className="mk-card overflow-hidden">
                        <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200 bg-slate-50">
                          <div className="flex items-center gap-2 min-w-0">
                            <h3 className="text-sm font-bold text-slate-800">{group.category}</h3>
                            <span className="mk-count">{group.items.length}</span>
                            {multiSectionCategories.includes(group.category) && (
                              <span className="mk-chip mk-chip-purple">Multi-section</span>
                            )}
                          </div>
                          <div className="flex gap-1.5">
                            <button type="button" className="mk-btn mk-btn-sm" onClick={() => openOverview(group.category)}>
                              <Layers /> Overview
                            </button>
                            <button type="button" className="mk-btn mk-btn-sm" onClick={() => openAddModal(group.category)}>
                              <Plus /> Add
                            </button>
                          </div>
                        </header>
                        <ul className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
                          {group.items.map(renderItemCard)}
                        </ul>
                      </section>
                    ))}

                    {termBoard.every(group => group.items.length === 0) && (
                      <div className="mk-card p-10 text-center">
                        <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <h3 className="text-base font-semibold text-slate-700">No items in {selectedTerm} yet</h3>
                        <p className="text-sm text-slate-500 mt-1">Add an item to a category below to start entering marks.</p>
                      </div>
                    )}

                    {termBoard.some(group => group.items.length === 0) && (
                      <div className="mk-card px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="mk-label mr-1">Empty categories</span>
                          {termBoard.filter(group => group.items.length === 0).map(group => (
                            <button
                              key={group.category}
                              type="button"
                              className="mk-btn mk-btn-sm"
                              onClick={() => openAddModal(group.category)}
                              title={`Add a ${group.category} item`}
                            >
                              <Plus /> {group.category}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* ======== CATEGORY OVERVIEW ======== */}
          {view === 'overview' && (
            <div className="flex-1 min-h-0 flex flex-col p-4 gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <button type="button" className="mk-btn mk-btn-icon md:hidden" onClick={goHome} aria-label="Back to all items">
                    <ChevronLeft />
                  </button>
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-slate-800">{selectedCategory} overview</h2>
                    <p className="text-sm text-slate-500">
                      {cleanClassName(selectedClass)} · {selectedTerm} · {assessments.length} items
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="mk-input md:hidden"
                    value={selectedCategory}
                    onChange={event => openOverview(event.target.value)}
                  >
                    {categories.map(category => <option key={category} value={category}>{category}</option>)}
                  </select>
                  <button type="button" className="mk-btn mk-btn-primary" onClick={() => openAddModal(selectedCategory)}>
                    <Plus /> New item
                  </button>
                </div>
              </div>

              {isAssessmentsLoading ? (
                <div className="mk-card p-10 flex items-center justify-center gap-2 text-slate-500" role="status">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" /> Loading…
                </div>
              ) : assessmentsError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
                  {assessmentsError}
                </div>
              ) : assessments.length === 0 ? (
                <div className="mk-card p-10 text-center">
                  <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <h3 className="text-base font-semibold text-slate-700">No {selectedCategory} items in {selectedTerm}</h3>
                  <p className="text-sm text-slate-500 mt-1 mb-4">Create one to start entering marks.</p>
                  <button type="button" className="mk-btn mk-btn-primary" onClick={() => openAddModal(selectedCategory)}>
                    <Plus /> Add {selectedCategory} item
                  </button>
                </div>
              ) : (
                <div className="mk-card flex-1 min-h-0 overflow-auto">
                  <table className="mk-table">
                    <thead>
                      <tr>
                        <th className="mk-sticky-no">No.</th>
                        <th className="mk-sticky-name">Student</th>
                        {assessments.map(a => (
                          <th key={a.id} className="mk-sep" style={{ minWidth: 96 }}>
                            <button
                              type="button"
                              onClick={() => openItem(a)}
                              className="max-w-[140px] truncate block mx-auto text-[11px] font-bold uppercase text-slate-600 hover:text-blue-600"
                              title={`Open ${a.name}`}
                            >
                              {a.name}
                            </button>
                            <span className="mk-sub">
                              {a.designatedPending ? 'Not configured' : `/${getAssessmentFullMark(a)}`}
                            </span>
                          </th>
                        ))}
                        <th className="mk-sep" style={{ color: '#1d4ed8', minWidth: 90 }}>
                          Total
                          <span className="mk-sub">/{overviewTotalStats.fullMark}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentClassStudents.length === 0 ? (
                        <tr>
                          <td colSpan={100} className="p-8 text-slate-500">No students found in {cleanClassName(selectedClass)}.</td>
                        </tr>
                      ) : currentClassStudents.map(student => {
                        let studentTotal = 0;
                        let hasAnyMark = false;

                        const cells = assessments.map(a => {
                          const finalMark = getSavedFinalMark(a, student.id);
                          if (finalMark !== null) {
                            studentTotal += finalMark;
                            hasAnyMark = true;
                          }
                          const isTop = finalMark !== null && marksIsTopTwo(finalMark, overviewStats[a.id]?.marks || []);

                          return (
                            <td key={a.id} className={`mk-sep ${finalMark === null ? 'mk-missing-cell' : isTop ? 'mk-top' : ''}`}>
                              {finalMark === null
                                ? <span className="mk-gap">–</span>
                                : studentView && !isTop
                                  ? '***'
                                  : finalMark.toFixed(1)}
                            </td>
                          );
                        });

                        const totalIsTop = hasAnyMark && marksIsTopTwo(studentTotal, overviewTotalStats.marks);

                        return (
                          <tr key={student.id}>
                            <td className="mk-sticky-no font-semibold text-slate-700">{student.classNumber}</td>
                            <td className="mk-sticky-name">
                              <div className="truncate max-w-[220px] text-slate-800">{student.englishName}</div>
                            </td>
                            {cells}
                            <td className={`mk-sep ${!hasAnyMark ? 'mk-missing-cell' : totalIsTop ? 'mk-top' : 'mk-final'}`}>
                              {!hasAnyMark
                                ? <span className="mk-gap">–</span>
                                : studentView && !totalIsTop
                                  ? '***'
                                  : studentTotal.toFixed(1)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {currentClassStudents.length > 0 && (
                      <tfoot>
                        <tr>
                          <td className="mk-sticky-no"></td>
                          <td className="mk-sticky-name">
                            <div className="font-bold text-blue-800 text-xs">Statistics</div>
                            <div className="text-[10px] text-blue-600">Mean / Median / Pass</div>
                          </td>
                          {assessments.map(a =>
                            renderStatCell(a.id, getStats(overviewStats[a.id].marks, overviewStats[a.id].fullMark), { className: 'mk-sep' })
                          )}
                          {renderStatCell('total', getStats(overviewTotalStats.marks, overviewTotalStats.fullMark), { bold: true, className: 'mk-sep' })}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ======== ITEM VIEW ======== */}
          {view === 'item' && (
            (isAssessmentsLoading || !selectedAssessment) ? (
              <div className="flex-1 flex items-center justify-center gap-2 text-slate-500" role="status">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" /> Loading item…
              </div>
            ) : selectedAssessment.designatedPending === true ? (
              <div className="flex-1 min-h-0 overflow-auto p-6">
                <div className="mx-auto max-w-xl rounded-xl border border-yellow-300 bg-yellow-50 p-6">
                  <div className="flex items-center gap-2">
                    <button type="button" className="mk-btn mk-btn-icon md:hidden" onClick={goHome} aria-label="Back">
                      <ChevronLeft />
                    </button>
                    <AlertTriangle className="w-5 h-5 text-yellow-700 shrink-0" />
                    <h2 className="text-lg font-bold text-yellow-950">{selectedAssessment.name}</h2>
                  </div>
                  <span className="mk-chip mk-chip-yellow mt-3">Compulsory · Needs configuration</span>
                  <p className="mt-4 text-sm text-yellow-900">
                    This item was added by Designated Assessment and has no marking setup yet.
                    It is excluded from term calculations and exports until configured.
                  </p>
                  <ol className="mt-3 list-decimal pl-5 text-sm text-yellow-900 space-y-1">
                    <li>Set its date, full mark and (if needed) sections.</li>
                    <li>Save, then enter marks.</li>
                    <li>Once marks are entered, the item turns <b className="text-green-700">green</b>.</li>
                  </ol>
                  <button type="button" onClick={openEditModal} className="mk-btn mk-btn-primary mt-5">
                    <Settings /> Configure now
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col">
                {/* Item header */}
                <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <button type="button" className="mk-btn mk-btn-icon md:hidden" onClick={goHome} aria-label="Back to all items">
                          <ChevronLeft />
                        </button>
                        <h2 className="text-lg font-bold text-slate-800 truncate">{selectedAssessment.name}</h2>
                        {selectedAssessment.designatedSource && (
                          <span className="mk-chip mk-chip-green shrink-0">Compulsory</span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="mk-chip" title="Linked classes">
                          <Users />
                          {(selectedAssessment.classes || [selectedAssessment.className]).map(cleanClassName).join(', ')}
                        </span>
                        <span className="mk-chip mk-chip-blue">{selectedAssessment.category || selectedCategory}</span>
                        <span className="mk-chip mk-chip-purple">{selectedAssessment.term || selectedTerm}</span>
                        <span className="mk-chip"><Calendar />{selectedAssessment.date || 'No date'}</span>
                        <span className="mk-chip">
                          Full mark {getAssessmentFullMark(selectedAssessment)}
                          {hasSections ? (assessmentUsesScaling(selectedAssessment) ? ' · converted' : ' · raw') : ''}
                        </span>
                        {selectedAssessment.linkedDocId && (
                          <button
                            type="button"
                            className="mk-btn mk-btn-sm mk-btn-soft"
                            onClick={() => handleOpenPreview(selectedAssessment.linkedDocId)}
                          >
                            <ExternalLink /> Linked document
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button type="button" className="mk-btn" onClick={openEditModal} title="Edit configuration">
                        <Edit /> Configure
                      </button>
                      <button
                        type="button"
                        onClick={toggleDisclosure}
                        className={`mk-btn ${selectedAssessment.isDisclosed ? 'mk-btn-ok' : 'mk-btn-warn'}`}
                        title="Show or hide this item's marks and documents for students"
                      >
                        {selectedAssessment.isDisclosed ? <Eye /> : <EyeOff />}
                        {selectedAssessment.isDisclosed ? 'Disclosed' : 'Hidden'}
                      </button>
                      <button
                        type="button"
                        className="mk-btn mk-btn-icon mk-btn-danger"
                        onClick={() => handleDeleteAssessment(selectedAssessment.id)}
                        title="Delete this item"
                        aria-label="Delete this item"
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <div className="mk-seg" role="group" aria-label="Input method">
                      <button
                        type="button"
                        className={inputMethod === 'individual' ? 'is-active' : ''}
                        onClick={() => setInputMethod('individual')}
                      >
                        <FormInput /> Boxes
                      </button>
                      <button
                        type="button"
                        className={inputMethod === 'bulk' ? 'is-active' : ''}
                        onClick={() => setInputMethod('bulk')}
                      >
                        <ClipboardPaste /> Paste
                      </button>
                    </div>

                    {!studentView && (
                      <button
                        type="button"
                        className={`mk-btn mk-btn-sm ${showDeduct ? 'mk-btn-soft' : ''}`}
                        onClick={() => setShowDeduct(!showDeduct)}
                        aria-pressed={showDeduct}
                      >
                        <MinusCircle /> Deduct
                      </button>
                    )}

                    <span className="mk-divider" />

                    {assessmentClasses.length > 1 && (
                      <button
                        type="button"
                        className="mk-btn mk-btn-sm"
                        onClick={() => {
                          setAllClassesStudentView(true);
                          setShowAllClassesModal(true);
                        }}
                      >
                        <Users /> All classes
                      </button>
                    )}
                    <button
                      type="button"
                      className="mk-btn mk-btn-sm"
                      onClick={handleCopyTotals}
                      title="Copy final totals in class-number order (WebSAMS)"
                    >
                      {copySuccess ? <CheckCircle /> : <Copy />}
                      {copySuccess ? 'Copied' : 'Copy totals'}
                    </button>
                    <button
                      type="button"
                      className="mk-btn mk-btn-sm"
                      onClick={() => {
                        setRevealStep(studentView ? 0 : 4);
                        setShowOverviewModal(true);
                      }}
                    >
                      <BarChart2 /> Overview & graph
                    </button>
                    {isMultiSectionCategory && (
                      <button type="button" className="mk-btn mk-btn-sm" onClick={openAmendModal}>
                        <Edit3 /> Amend marks
                      </button>
                    )}

                    <div className="ml-auto flex items-center gap-2">
                      {marksDirty && <span className="mk-chip mk-chip-yellow">Unsaved changes</span>}
                      <button
                        type="button"
                        onClick={handleSaveMarks}
                        disabled={isSaving}
                        className={`mk-btn ${saveFlash ? 'mk-btn-emerald' : 'mk-btn-primary'}`}
                      >
                        {isSaving ? <Loader2 className="animate-spin" /> : saveFlash ? <CheckCircle /> : <Save />}
                        {saveFlash ? 'Saved' : 'Save marks'}
                      </button>
                    </div>
                  </div>
                </div>

                {inputMethod === 'bulk' && (
                  <div className="shrink-0 border-b border-blue-100 bg-blue-50 px-4 py-3">
                    <p className="text-xs text-blue-800 mb-2">
                      <b>Paste from Excel.</b>{' '}
                      {hasSections
                        ? 'Each row is a student (class-number order). Columns map to the sections/sub-sections from left to right.'
                        : 'Paste one column of marks; rows map to students in class-number order.'}
                    </p>
                    <textarea
                      rows={4}
                      value={bulkText}
                      onChange={handleBulkPaste}
                      data-gramm="false"
                      data-gramm_editor="false"
                      placeholder="Paste marks here…"
                      className="mk-input w-full resize-y whitespace-pre font-mono"
                    />
                  </div>
                )}

                {/* Marks table */}
                <div className="flex-1 min-h-0 overflow-auto bg-white">
                  <table className="mk-table">
                    <thead>
                      {hasSections && (
                        <tr className="mk-group-row">
                          <th className="mk-sticky-no"></th>
                          <th className="mk-sticky-name"></th>
                          {selectedAssessment.sectionsConfig.map((sec, i) => {
                            const isLastInGroup = sec.groupName && (i === selectedAssessment.sectionsConfig.length - 1 || selectedAssessment.sectionsConfig[i + 1].groupName !== sec.groupName);
                            return (
                              <React.Fragment key={sec.id}>
                                <th colSpan={sec.hasSubSections ? sec.subSections.length + 1 : 1} className="mk-sep">
                                  {sec.name}
                                  <span className="mk-sub">
                                    {assessmentUsesScaling(selectedAssessment)
                                      ? `Full ${sec.fullMark} · Weight ${sec.weight}%`
                                      : `Full ${getSectionRawFullMark(sec)}`}
                                  </span>
                                </th>
                                {isLastInGroup && (
                                  <th className="mk-sep" style={{ background: '#f5f3ff', color: '#6d28d9' }}>
                                    {sec.groupName}
                                  </th>
                                )}
                              </React.Fragment>
                            );
                          })}
                          <th colSpan={trailingCols} className="mk-sep"></th>
                        </tr>
                      )}
                      <tr>
                        <th className="mk-sticky-no">No.</th>
                        <th className="mk-sticky-name">Student</th>

                        {hasSections ? (
                          <>
                            {selectedAssessment.sectionsConfig.map((sec, i) => {
                              const isLastInGroup = sec.groupName && (i === selectedAssessment.sectionsConfig.length - 1 || selectedAssessment.sectionsConfig[i + 1].groupName !== sec.groupName);
                              return (
                                <React.Fragment key={sec.id}>
                                  {sec.hasSubSections ? (
                                    <>
                                      {sec.subSections.map((sub, j) => (
                                        <th key={sub.id} className={j === 0 ? 'mk-sep' : ''}>
                                          {sub.name}
                                          <span className="mk-sub">/{sub.fullMark}</span>
                                        </th>
                                      ))}
                                      <th style={{ color: '#334155' }}>
                                        Total
                                        <span className="mk-sub">/{getSectionRawFullMark(sec)}</span>
                                      </th>
                                    </>
                                  ) : (
                                    <th className="mk-sep">
                                      Mark
                                      <span className="mk-sub">/{sec.fullMark}</span>
                                    </th>
                                  )}
                                  {isLastInGroup && (
                                    <th className="mk-sep" style={{ color: '#6d28d9' }}>Group total</th>
                                  )}
                                </React.Fragment>
                              );
                            })}
                            <th className="mk-sep">
                              Total
                              <span className="mk-sub">
                                /{getAssessmentFullMark(selectedAssessment)}
                                {assessmentUsesScaling(selectedAssessment) ? ' · converted' : ' · raw'}
                              </span>
                            </th>
                          </>
                        ) : (
                          <th className="mk-sep mk-left">
                            Mark / Grade
                            <span className="mk-sub">Full mark {selectedAssessment.fullMark ?? 100}</span>
                          </th>
                        )}

                        {showDeductCol && <th className="mk-sep" style={{ color: '#dc2626' }}>Deduct</th>}
                        <th className="mk-sep" style={{ color: '#1d4ed8' }}>Final</th>
                        {isMultiSectionCategory && (
                          <th className="mk-sep" style={{ minWidth: 130 }}>
                            Compare
                            <select
                              value={selectedCompareId}
                              onChange={(e) => setSelectedCompareId(e.target.value)}
                              className="mt-1 block w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] font-normal normal-case text-slate-700"
                            >
                              <option value="">None</option>
                              {compareAssessmentsList.map(ca => (
                                <option key={ca.id} value={ca.id}>{ca.term} {ca.name}</option>
                              ))}
                            </select>
                          </th>
                        )}
                        <th className="mk-sep">Done</th>
                        {!studentView && <th className="mk-sep mk-left">Comment</th>}
                      </tr>
                    </thead>

                    <tbody>
                      {currentClassStudents.length === 0 ? (
                        <tr>
                          <td colSpan={100} className="p-8 text-slate-500">
                            No students found. Please add students in the Manage Classes tab.
                          </td>
                        </tr>
                      ) : currentClassStudents.map((s, rowIndex) => {
                        const studentMarks = marksData[s.id];
                        const hasMark = hasSections
                          ? Boolean(studentMarks && typeof studentMarks === 'object' && Object.values(studentMarks).some(marksValueFilled))
                          : marksValueFilled(studentMarks);

                        const rawTotal = calculateTotal(studentMarks);
                        const scaledTotal = hasSections
                          ? calculateScaledTotal(studentMarks, selectedAssessment)
                          : rawTotal;
                        const deduction = parseFloat(marksData[`${s.id}_deduction`]) || 0;
                        const finalTotal = scaledTotal !== null ? scaledTotal - deduction : null;
                        const isTopMark = topStudentIds.has(s.id);
                        const inputsDisabled = inputMethod === 'bulk' || studentView;
                        let globalColIndex = 0;

                        const renderMarkInput = (value, onChange, extraClass = '') => {
                          const isMissing = !marksValueFilled(value);
                          const currentCol = globalColIndex++;
                          return (
                            <input
                              type="text"
                              inputMode="decimal"
                              data-row={rowIndex}
                              data-col={currentCol}
                              data-gramm="false"
                              data-gramm_editor="false"
                              value={studentView ? (isMissing ? '' : '***') : (value ?? '')}
                              onChange={event => { if (!studentView) onChange(event.target.value); }}
                              onKeyDown={event => handleKeyDown(event, rowIndex, currentCol)}
                              onFocus={event => event.target.select()}
                              disabled={inputsDisabled}
                              className={`mk-cell-input ${extraClass} ${isMissing ? 'is-missing' : ''}`}
                            />
                          );
                        };

                        return (
                          <tr key={s.id}>
                            <td className="mk-sticky-no font-semibold text-slate-700">{s.classNumber}</td>
                            <td className="mk-sticky-name">
                              <div className="truncate max-w-[220px] text-slate-800 font-medium">{s.englishName}</div>
                              {s.chineseName && <div className="truncate max-w-[220px] text-[11px] text-slate-400">{s.chineseName}</div>}
                            </td>

                            {hasSections ? (
                              <>
                                {selectedAssessment.sectionsConfig.map((sec, i) => {
                                  const secRawTotal = calculateSectionRawTotal(studentMarks, sec);
                                  const isLastInGroup = sec.groupName && (i === selectedAssessment.sectionsConfig.length - 1 || selectedAssessment.sectionsConfig[i + 1].groupName !== sec.groupName);

                                  let groupTotal = null;
                                  if (isLastInGroup) {
                                    let tempTotal = 0;
                                    let hasAnyGroupMark = false;
                                    selectedAssessment.sectionsConfig
                                      .filter(gs => gs.groupName === sec.groupName)
                                      .forEach(gs => {
                                        const gsTotal = calculateSectionRawTotal(studentMarks, gs);
                                        if (gsTotal !== null) {
                                          tempTotal += gsTotal;
                                          hasAnyGroupMark = true;
                                        }
                                      });
                                    if (hasAnyGroupMark) groupTotal = tempTotal;
                                  }

                                  const objectMarks = studentMarks && typeof studentMarks === 'object' ? studentMarks : {};

                                  return (
                                    <React.Fragment key={sec.id}>
                                      {sec.hasSubSections ? (
                                        <>
                                          {sec.subSections.map((sub, j) => (
                                            <td key={sub.id} className={j === 0 ? 'mk-sep' : ''}>
                                              {renderMarkInput(objectMarks[sub.id], value => handleMarkChange(s.id, value, sub.id))}
                                            </td>
                                          ))}
                                          <td className="font-semibold text-slate-600 bg-slate-50/60">
                                            {secRawTotal === null ? <span className="mk-gap">–</span> : (studentView ? '***' : secRawTotal.toFixed(1))}
                                          </td>
                                        </>
                                      ) : (
                                        <td className="mk-sep">
                                          {renderMarkInput(objectMarks[sec.id], value => handleMarkChange(s.id, value, sec.id))}
                                        </td>
                                      )}
                                      {isLastInGroup && (
                                        <td className="mk-sep font-bold" style={{ color: '#6d28d9', background: 'rgba(245,243,255,.6)' }}>
                                          {groupTotal === null ? <span className="mk-gap">–</span> : (studentView ? '***' : groupTotal.toFixed(1))}
                                        </td>
                                      )}
                                    </React.Fragment>
                                  );
                                })}
                                <td className="mk-sep font-semibold text-slate-700">
                                  {scaledTotal === null ? <span className="mk-gap">–</span> : studentView ? '***' : scaledTotal.toFixed(1)}
                                </td>
                              </>
                            ) : (
                              <td className="mk-sep mk-left">
                                {renderMarkInput(
                                  typeof studentMarks === 'object' ? '' : studentMarks,
                                  value => handleMarkChange(s.id, value),
                                  'is-wide'
                                )}
                              </td>
                            )}

                            {showDeductCol && (
                              <td className="mk-sep">
                                <input
                                  type="number"
                                  step="any"
                                  data-gramm="false"
                                  data-gramm_editor="false"
                                  value={marksData[`${s.id}_deduction`] || ''}
                                  onChange={(e) => handleDeductionChange(s.id, e.target.value)}
                                  placeholder="0"
                                  className="mk-cell-input"
                                  style={{ color: '#dc2626', borderColor: '#fecaca' }}
                                />
                              </td>
                            )}

                            <td className={`mk-sep ${finalTotal === null ? '' : isTopMark ? 'mk-top' : 'mk-final'}`}>
                              {finalTotal === null
                                ? <span className="mk-gap">–</span>
                                : studentView && !isTopMark
                                  ? '***'
                                  : finalTotal.toFixed(1)}
                            </td>

                            {isMultiSectionCategory && (
                              <td className="mk-sep">
                                {(() => {
                                  if (!selectedCompareId || finalTotal === null || studentView) return <span className="mk-gap">–</span>;
                                  const compAss = compareAssessmentsList.find(a => a.id === selectedCompareId);
                                  if (!compAss) return <span className="mk-gap">–</span>;

                                  const compMarks = compAss.marks?.[s.id];
                                  const compDeduct = parseFloat(compAss.marks?.[`${s.id}_deduction`]) || 0;
                                  const compScaled = calculateScaledTotal(compMarks, compAss);
                                  if (compScaled === null) return <span className="mk-gap">–</span>;

                                  const compFinal = compScaled - compDeduct;
                                  const currentFull = getAssessmentFullMark(selectedAssessment);
                                  const comparisonFull = getAssessmentFullMark(compAss);

                                  if (currentFull <= 0 || comparisonFull <= 0) return <span className="mk-gap">–</span>;

                                  const diff = (finalTotal / currentFull) * 100 - (compFinal / comparisonFull) * 100;
                                  const isPositive = diff > 0;
                                  const isNegative = diff < 0;
                                  const diffText = diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
                                  const widthPercent = Math.min(100, (Math.abs(diff) / 30) * 100);

                                  return (
                                    <div className="relative mx-auto w-28 h-7 flex items-center justify-center border border-slate-200 bg-white rounded overflow-hidden">
                                      {diff !== 0 && (
                                        <div
                                          className={`absolute top-0 bottom-0 ${isPositive ? 'left-1/2 bg-green-200' : 'right-1/2 bg-red-200'}`}
                                          style={{ width: `${widthPercent / 2}%` }}
                                        />
                                      )}
                                      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-300" />
                                      <span className={`relative z-10 text-xs font-bold ${isPositive ? 'text-green-700' : isNegative ? 'text-red-700' : 'text-slate-600'}`}>
                                        {diff === 0 ? '0' : diffText}
                                      </span>
                                    </div>
                                  );
                                })()}
                              </td>
                            )}

                            <td className="mk-sep">
                              {hasMark
                                ? <CheckCircle className="w-4 h-4 text-green-500 mx-auto" />
                                : <span className="mk-dot" />}
                            </td>

                            {!studentView && (
                              <td className="mk-sep mk-left">
                                <input
                                  type="text"
                                  placeholder="Add comment"
                                  value={marksData[`${s.id}_comment`] || ''}
                                  onChange={(e) => setMarksData(prev => ({ ...prev, [`${s.id}_comment`]: e.target.value }))}
                                  className="mk-cell-input is-wide is-text"
                                  style={{ fontSize: 12 }}
                                />
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>

                    {currentClassStudents.length > 0 && (
                      <tfoot>
                        <tr>
                          <td className="mk-sticky-no"></td>
                          <td className="mk-sticky-name">
                            <div className="font-bold text-blue-800 text-xs">Statistics</div>
                            <div className="text-[10px] text-blue-600">Mean / Median / Pass</div>
                          </td>

                          {hasSections ? (
                            <>
                              {selectedAssessment.sectionsConfig.map((sec, i) => {
                                const isLastInGroup = sec.groupName && (i === selectedAssessment.sectionsConfig.length - 1 || selectedAssessment.sectionsConfig[i + 1].groupName !== sec.groupName);
                                return (
                                  <React.Fragment key={sec.id}>
                                    {sec.hasSubSections ? (
                                      <>
                                        {sec.subSections.map((sub, j) =>
                                          renderStatCell(sub.id, getStats(statsData[sub.id].marks, statsData[sub.id].fullMark), { className: j === 0 ? 'mk-sep' : '' })
                                        )}
                                        {renderStatCell(`sec_${sec.id}`, getStats(statsData[`sec_${sec.id}`].marks, statsData[`sec_${sec.id}`].fullMark), { bold: true })}
                                      </>
                                    ) : (
                                      renderStatCell(sec.id, getStats(statsData[sec.id].marks, statsData[sec.id].fullMark), { className: 'mk-sep' })
                                    )}
                                    {isLastInGroup && <td className="mk-sep"></td>}
                                  </React.Fragment>
                                );
                              })}
                              {renderStatCell('scaled', getStats(statsData.scaledTotal.marks, statsData.scaledTotal.fullMark), { bold: true, className: 'mk-sep' })}
                            </>
                          ) : (
                            renderStatCell('main', getStats(statsData.main.marks, statsData.main.fullMark), { className: 'mk-sep mk-left' })
                          )}

                          {showDeductCol && <td className="mk-sep"></td>}
                          {renderStatCell('final', overallStats, { bold: true, className: 'mk-sep' })}
                          {isMultiSectionCategory && <td className="mk-sep"></td>}
                          <td className="mk-sep"></td>
                          {!studentView && <td className="mk-sep"></td>}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            )
          )}
        </main>
      </div>

      {/* ================= ADD / EDIT / CONFIGURE ASSESSMENT ================= */}
      {showAddAssessment && (
        <div className="mk-backdrop">
          <div className="mk-modal max-w-4xl">
            <div className="mk-modal-head">
              <div className="min-w-0">
                <h2>
                  {isEditingAssessment ? <Edit className="text-blue-600" /> : <PlusCircle className="text-blue-600" />}
                  {isEditingAssessment
                    ? (selectedAssessment?.designatedPending ? 'Configure assessment' : 'Edit assessment')
                    : `New ${formCategory} item`}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {formCategory} · {cleanClassName(selectedClass)}
                </p>
              </div>
              <button type="button" className="mk-btn mk-btn-icon mk-btn-ghost" onClick={() => setShowAddAssessment(false)} aria-label="Close">
                <X />
              </button>
            </div>

            <div className="mk-modal-body bg-slate-50">
              <form id="assessment-form" onSubmit={handleSaveAssessment} className="space-y-4">
                {isEditingAssessment && selectedAssessment?.designatedPending && (
                  <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900 flex gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      This compulsory item came from Designated Assessment. Choose its layout and full marks,
                      then save to start entering marks. You can choose the layout only this once.
                    </span>
                  </div>
                )}

                {/* Basics */}
                <section className="mk-card p-4">
                  <h3 className="mk-section-title">Basic details</h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="mk-field sm:col-span-2">
                      <span className="mk-label">Name</span>
                      <input
                        type="text"
                        value={newAssessmentName}
                        onChange={(e) => setNewAssessmentName(e.target.value)}
                        placeholder={isMultiSectionForm ? `${formTerm} ${formCategory}` : 'e.g. Quiz 1'}
                        data-gramm="false"
                        data-gramm_editor="false"
                        className="mk-input w-full"
                        required={!isMultiSectionForm}
                      />
                    </label>
                    <label className="mk-field">
                      <span className="mk-label">Date</span>
                      <input
                        type="date"
                        value={newAssessmentDate}
                        onChange={(e) => setNewAssessmentDate(e.target.value)}
                        className="mk-input w-full"
                        required
                      />
                    </label>
                    <label className="mk-field">
                      <span className="mk-label">Term</span>
                      <select
                        value={formTerm}
                        onChange={(e) => setFormTerm(e.target.value)}
                        className="mk-input w-full"
                        required
                      >
                        {terms.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                  </div>
                </section>

                {/* Layout */}
                <section className="mk-card p-4">
                  <h3 className="mk-section-title">Marking layout</h3>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="mk-seg">
                      <button
                        type="button"
                        className={!isMultiSectionForm ? 'is-active' : ''}
                        disabled={layoutLocked}
                        onClick={() => setForceMultiSection(false)}
                      >
                        <FormInput /> Single mark
                      </button>
                      <button
                        type="button"
                        className={isMultiSectionForm ? 'is-active' : ''}
                        disabled={layoutLocked}
                        onClick={() => setForceMultiSection(true)}
                      >
                        <Layers /> Sections / papers
                      </button>
                    </div>
                    {layoutLocked && (
                      <span className="mk-help">Layout is locked to protect existing marks. Full marks and weights can still change.</span>
                    )}
                  </div>

                  {!isMultiSectionForm && (
                    <div className="mt-4 flex flex-wrap items-end gap-3">
                      <label className="mk-field w-40">
                        <span className="mk-label">Full mark</span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={fullMark}
                          onChange={(e) => setFullMark(e.target.value)}
                          data-gramm="false"
                          data-gramm_editor="false"
                          className="mk-input w-full"
                          required
                        />
                      </label>
                      <p className="mk-help pb-2">
                        The maximum mark for this item (not its term weighting). Changing it does not alter entered marks.
                      </p>
                    </div>
                  )}
                </section>

                {/* Sections */}
                {isMultiSectionForm && (
                  <section className="mk-card p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="mk-section-title mb-0">Sections</h3>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="mk-label mr-1">Quick presets</span>
                        {SECTION_PRESETS.map(preset => (
                          <button
                            key={preset.label}
                            type="button"
                            className="mk-btn mk-btn-sm mk-btn-soft-purple"
                            onClick={() => {
                              if (
                                sectionsConfig.length > 1 &&
                                !window.confirm('Replace the current sections with this preset?')
                              ) return;
                              setSectionsConfig(preset.build());
                              setPaperFullMark(preset.paperFullMark);
                            }}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <label className="flex items-start gap-2 text-sm font-semibold text-slate-800">
                        <input
                          type="checkbox"
                          checked={scaleTotalTo100}
                          onChange={event => setScaleTotalTo100(event.target.checked)}
                          className="mt-0.5 rounded text-blue-600"
                        />
                        Convert the total to 100 using section weights
                      </label>
                      <p className="mk-help mt-1 pl-6">
                        {scaleTotalTo100
                          ? 'ON: section weights are applied and normalised to 100 (e.g. 5/15 becomes 33.3/100).'
                          : 'OFF: weights are ignored; the total is the sum of all sections (e.g. 5/15).'}
                      </p>

                      {scaleTotalTo100 ? (
                        <div className="mt-3 pl-6 flex flex-wrap items-end gap-3">
                          <label className="mk-field w-32">
                            <span className="mk-label">Paper full mark</span>
                            <input
                              type="number"
                              value={paperFullMark}
                              onChange={event => setPaperFullMark(event.target.value)}
                              data-gramm="false"
                              data-gramm_editor="false"
                              className="mk-input w-full text-center font-bold"
                            />
                          </label>
                          <button type="button" onClick={autoCalculateWeights} className="mk-btn">
                            <Percent /> Auto weights
                          </button>
                          <span className={`mk-chip ${Math.abs(sectionWeightTotal - 100) < 0.05 ? 'mk-chip-green' : 'mk-chip-yellow'}`}>
                            Weights total: {Number(sectionWeightTotal.toFixed(1))}%
                          </span>
                        </div>
                      ) : (
                        <p className="mt-2 pl-6 text-sm text-slate-700">
                          Total full mark: <b>{Number(rawSectionsTotal.toFixed(2))}</b>
                        </p>
                      )}
                    </div>

                    <div className="space-y-3">
                      {sectionsConfig.map((sec, index) => (
                        <div key={sec.id} className="rounded-lg border border-slate-200 bg-white">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 rounded-t-lg">
                            <span className="text-xs font-bold text-slate-500">Section {index + 1}</span>
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                onClick={() => { setDocLinkerTarget(sec.id); setShowDocLinker(true); }}
                                className={`mk-btn mk-btn-sm ${sec.linkedDocId ? 'mk-btn-soft' : ''}`}
                                title={sec.linkedDocId ? 'Change linked document' : 'Link a document'}
                              >
                                <LinkIcon /> {sec.linkedDocId ? 'Linked' : 'Link'}
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleSubSections(sec.id)}
                                className={`mk-btn mk-btn-sm ${sec.hasSubSections ? 'mk-btn-soft-purple' : ''}`}
                              >
                                <Layers /> Sub-sections {sec.hasSubSections ? 'on' : 'off'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveSection(sec.id)}
                                disabled={sectionsConfig.length === 1}
                                className="mk-btn mk-btn-sm mk-btn-icon mk-btn-danger"
                                aria-label="Remove section"
                              >
                                <Trash2 />
                              </button>
                            </div>
                          </div>

                          <div className="mk-section-grid p-3">
                            <label className="mk-field">
                              <span className="mk-label">Section name</span>
                              <input type="text" value={sec.name} onChange={(e) => updateSection(sec.id, 'name', e.target.value)} data-gramm="false" data-gramm_editor="false" className="mk-input w-full" required />
                            </label>
                            <label className="mk-field">
                              <span className="mk-label">Group (optional)</span>
                              <input type="text" value={sec.groupName || ''} onChange={(e) => updateSection(sec.id, 'groupName', e.target.value)} placeholder="e.g. DBQ" data-gramm="false" data-gramm_editor="false" className="mk-input w-full" />
                            </label>
                            <label className="mk-field">
                              <span className="mk-label">Full mark</span>
                              <input
                                type="number"
                                step="any"
                                value={!scaleTotalTo100 && sec.hasSubSections ? getSectionRawFullMark(sec) : sec.fullMark}
                                onChange={event => updateSection(sec.id, 'fullMark', event.target.value)}
                                disabled={!scaleTotalTo100 && sec.hasSubSections}
                                data-gramm="false"
                                data-gramm_editor="false"
                                className="mk-input w-full"
                                required={scaleTotalTo100 || !sec.hasSubSections}
                              />
                            </label>
                            <label className="mk-field">
                              <span className="mk-label">Weight %</span>
                              <input
                                type="number"
                                step="any"
                                value={sec.weight}
                                onChange={event => updateSection(sec.id, 'weight', event.target.value)}
                                disabled={!scaleTotalTo100}
                                data-gramm="false"
                                data-gramm_editor="false"
                                className="mk-input w-full"
                                required={scaleTotalTo100}
                              />
                            </label>
                          </div>

                          {sec.hasSubSections && (
                            <div className="border-t border-slate-100 px-3 py-3">
                              <div className="mk-label mb-2">Sub-sections</div>
                              <div className="space-y-2">
                                {sec.subSections.map(sub => (
                                  <div key={sub.id} className="flex items-center gap-2">
                                    <input type="text" value={sub.name} onChange={(e) => updateSubSection(sec.id, sub.id, 'name', e.target.value)} data-gramm="false" data-gramm_editor="false" placeholder="Name, e.g. a" className="mk-input flex-1" required />
                                    <input type="number" step="any" value={sub.fullMark} onChange={(e) => updateSubSection(sec.id, sub.id, 'fullMark', e.target.value)} data-gramm="false" data-gramm_editor="false" placeholder="Full mark" className="mk-input w-28" required />
                                    <button type="button" onClick={() => handleRemoveSubSection(sec.id, sub.id)} className="mk-btn mk-btn-sm mk-btn-icon mk-btn-danger" aria-label="Remove sub-section">
                                      <X />
                                    </button>
                                  </div>
                                ))}
                              </div>
                              <button type="button" onClick={() => handleAddSubSection(sec.id)} className="mk-btn mk-btn-sm mk-btn-ghost mt-2 text-indigo-700">
                                <Plus /> Add sub-section
                              </button>
                            </div>
                          )}
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={handleAddSection}
                        className="w-full py-2.5 border-2 border-dashed border-slate-300 rounded-lg text-sm text-slate-500 font-semibold hover:bg-white hover:text-blue-600 hover:border-blue-300 transition-colors flex items-center justify-center gap-2"
                      >
                        <PlusCircle className="w-4 h-4" /> Add section / paper
                      </button>
                    </div>
                  </section>
                )}

                {/* Classes */}
                <section className="mk-card p-4">
                  <h3 className="mk-section-title">Apply to classes</h3>
                  <div className="flex flex-wrap gap-2">
                    {classes.map(c => {
                      const checked = selectedClassesForNew.includes(c.name);
                      return (
                        <label
                          key={c.name}
                          className={`flex items-center gap-2 h-8 px-3 rounded-lg border cursor-pointer text-sm font-medium transition-colors ${checked ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleClassForNew(c.name)}
                            className="rounded text-blue-600"
                          />
                          {cleanClassName(c.name)}
                        </label>
                      );
                    })}
                  </div>
                </section>

                {/* Linked doc */}
                <section className="mk-card p-4">
                  <h3 className="mk-section-title">Linked archive document (optional)</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setDocLinkerTarget('main'); setShowDocLinker(true); }}
                      className="mk-btn mk-btn-soft"
                    >
                      <LinkIcon /> {linkedDocId ? 'Change document' : 'Link document'}
                    </button>
                    {linkedDocId && (
                      <span className="mk-chip" style={{ height: 30, paddingRight: 4 }}>
                        <FileText />
                        <span className="truncate max-w-[260px]">
                          {linkableDocs.find(a => a.id === linkedDocId)?.title || 'Unknown document'}
                        </span>
                        <button type="button" onClick={() => setLinkedDocId('')} className="ml-1 rounded-full p-1 text-red-500 hover:bg-red-50" aria-label="Remove link">
                          <X />
                        </button>
                      </span>
                    )}
                  </div>
                </section>
              </form>
            </div>

            <div className="mk-modal-foot">
              <button type="button" onClick={() => setShowAddAssessment(false)} className="mk-btn">Cancel</button>
              <button
                type="submit"
                form="assessment-form"
                disabled={isSavingAssessment}
                className="mk-btn mk-btn-primary"
              >
                {isSavingAssessment ? <Loader2 className="animate-spin" /> : <Save />}
                {isSavingAssessment ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= ALL CLASSES ================= */}
      {showAllClassesModal && selectedAssessment && (
        <div className="mk-backdrop">
          <div className="mk-modal max-w-5xl">
            <div className="mk-modal-head">
              <h2><Users className="text-blue-600" /> All classes · {selectedAssessment.name}</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAllClassesStudentView(!allClassesStudentView)}
                  className={`mk-btn mk-btn-sm ${allClassesStudentView ? 'mk-btn-warn' : ''}`}
                >
                  {allClassesStudentView ? <EyeOff /> : <Eye />}
                  Student View {allClassesStudentView ? 'On' : 'Off'}
                </button>
                <button type="button" onClick={() => setShowAllClassesModal(false)} className="mk-btn mk-btn-icon mk-btn-ghost" aria-label="Close">
                  <X />
                </button>
              </div>
            </div>
            <div className="mk-modal-body bg-slate-50 space-y-4">
              {allClassesStatsData && (() => {
                const s = getStats(allClassesStatsData.marks, allClassesStatsData.fullMark);
                if (!s) return null;
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      ['Mean', s.mean, 'text-blue-600'],
                      ['Median', s.median, 'text-blue-600'],
                      ['Pass', `${s.passCount}/${s.total}`, s.passCount >= s.total / 2 ? 'text-green-600' : 'text-red-500'],
                      ['Highest', s.max, 'text-purple-600']
                    ].map(([label, value, color]) => (
                      <div key={label} className="mk-card p-3">
                        <div className="mk-label">{label}</div>
                        <div className={`text-2xl font-bold ${color}`}>{value}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div className="mk-card overflow-auto max-h-[60vh]">
                <table className="mk-table">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>No.</th>
                      <th className="mk-left">Name</th>
                      {hasSections && selectedAssessment.sectionsConfig.map(sec => (
                        <th key={sec.id} className="mk-sep">{sec.name}</th>
                      ))}
                      <th className="mk-sep" style={{ color: '#1d4ed8' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allClassesStudents.length === 0 ? (
                      <tr><td colSpan={100} className="p-8 text-slate-500">No students found across linked classes.</td></tr>
                    ) : allClassesStudents.map(student => {
                      const studentMarks = marksData[student.id];
                      const rawTotal = calculateTotal(studentMarks);
                      const scaledTotal = hasSections ? calculateScaledTotal(studentMarks, selectedAssessment) : rawTotal;
                      const deduction = parseFloat(marksData[`${student.id}_deduction`]) || 0;
                      const finalTotal = scaledTotal !== null ? scaledTotal - deduction : null;
                      const isTop = marksIsTopTwo(finalTotal, allClassesStatsData?.marks || []);

                      return (
                        <tr key={student.id}>
                          <td className="text-slate-600">{cleanClassName(student.className)}</td>
                          <td className="font-semibold">{student.classNumber}</td>
                          <td className="mk-left font-medium text-slate-800">{student.englishName}</td>
                          {hasSections && selectedAssessment.sectionsConfig.map(sec => {
                            const secRawTotal = calculateSectionRawTotal(studentMarks, sec);
                            return (
                              <td key={sec.id} className="mk-sep text-slate-600">
                                {secRawTotal === null ? <span className="mk-gap">–</span> : (allClassesStudentView ? '***' : secRawTotal.toFixed(1))}
                              </td>
                            );
                          })}
                          <td className={`mk-sep ${finalTotal === null ? '' : isTop ? 'mk-top' : 'mk-final'}`}>
                            {finalTotal === null
                              ? <span className="mk-gap">–</span>
                              : allClassesStudentView && !isTop
                                ? '***'
                                : finalTotal.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= AMEND MARKS ================= */}
      {showAmendModal && selectedAssessment && isMultiSectionCategory && (() => {
        const amendColumns = selectedAssessment.sectionsConfig.flatMap(sec =>
          sec.hasSubSections
            ? sec.subSections.map(sub => ({ id: sub.id, section: sec.name, label: sub.name, full: sub.fullMark }))
            : [{ id: sec.id, section: sec.name, label: 'Mark', full: sec.fullMark }]
        );

        return (
          <div className="mk-backdrop">
            <div className="mk-modal max-w-7xl" style={{ height: 'min(90dvh, 900px)' }}>
              <div className="mk-modal-head">
                <div className="min-w-0">
                  <h2><Edit3 className="text-orange-600" /> Amend marks · {selectedAssessment.name}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Type a class number (e.g. 20) or class + number (e.g. 4A15), then type a new mark or use the − / + buttons.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={saveAmendments} disabled={isSaving} className="mk-btn mk-btn-orange">
                    {isSaving ? <Loader2 className="animate-spin" /> : <Save />} Save changes
                  </button>
                  <button type="button" onClick={closeAmendModal} className="mk-btn mk-btn-icon mk-btn-ghost" aria-label="Close">
                    <X />
                  </button>
                </div>
              </div>

              <div className="mk-modal-body bg-slate-50 space-y-3">
                <div className="mk-card overflow-auto">
                  <table className="mk-table">
                    <thead>
                      <tr>
                        <th className="mk-left" style={{ minWidth: 210 }}>Student</th>
                        {amendColumns.map(col => (
                          <th key={col.id} className="mk-sep" style={{ minWidth: 170 }}>
                            {col.section} · {col.label}
                            <span className="mk-sub">/{col.full}</span>
                          </th>
                        ))}
                        <th className="mk-sep" style={{ color: '#c2410c' }}>Total</th>
                        <th className="mk-sep"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {amendRows.map(row => {
                        const scaledTotal = row.student ? calculateScaledTotal(row.marks, selectedAssessment) : null;
                        const deduction = row.student ? (parseFloat(marksData[`${row.student.id}_deduction`]) || 0) : 0;
                        const finalTotal = scaledTotal !== null ? scaledTotal - deduction : null;

                        return (
                          <tr key={row.id}>
                            <td className="mk-left">
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={row.query}
                                  onChange={(e) => handleAmendQueryChange(row.id, e.target.value)}
                                  data-gramm="false"
                                  data-gramm_editor="false"
                                  placeholder="No."
                                  className="mk-cell-input font-bold"
                                  style={{ width: 70 }}
                                />
                                {row.student ? (
                                  <div className="min-w-0">
                                    <div className="font-semibold text-slate-800 truncate max-w-[140px]">{row.student.englishName}</div>
                                    <div className="text-[11px] text-slate-500">{cleanClassName(row.student.className)} · {row.student.classNumber}</div>
                                  </div>
                                ) : (
                                  <span className="text-xs italic text-slate-400">{row.query ? 'Not found' : ''}</span>
                                )}
                              </div>
                            </td>

                            {amendColumns.map(col => {
                              const val = row.marks[col.id] !== undefined ? row.marks[col.id] : '';
                              const diff = Number(((parseFloat(val) || 0) - (parseFloat(row.originalMarks[col.id]) || 0)).toFixed(2));

                              return (
                                <td key={col.id} className="mk-sep">
                                  {row.student ? (
                                    <div className="flex items-center justify-center gap-1">
                                      <button type="button" onClick={() => adjustAmendMark(row.id, col.id, -1)} className="mk-step mk-step-minus">−1</button>
                                      <button type="button" onClick={() => adjustAmendMark(row.id, col.id, -0.5)} className="mk-step mk-step-minus">−.5</button>
                                      <div className="flex flex-col items-center">
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          value={val}
                                          onChange={event => setAmendMark(row.id, col.id, event.target.value)}
                                          className="mk-cell-input font-bold"
                                          style={{ width: 52 }}
                                        />
                                        <span className={`text-[10px] font-bold h-3 leading-3 ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-transparent'}`}>
                                          {diff > 0 ? `+${diff}` : diff}
                                        </span>
                                      </div>
                                      <button type="button" onClick={() => adjustAmendMark(row.id, col.id, 0.5)} className="mk-step mk-step-plus">+.5</button>
                                      <button type="button" onClick={() => adjustAmendMark(row.id, col.id, 1)} className="mk-step mk-step-plus">+1</button>
                                    </div>
                                  ) : <span className="mk-gap">–</span>}
                                </td>
                              );
                            })}

                            <td className="mk-sep font-bold" style={{ color: '#c2410c', background: 'rgba(255,247,237,.7)' }}>
                              {finalTotal !== null ? finalTotal.toFixed(1) : <span className="mk-gap">–</span>}
                            </td>
                            <td className="mk-sep">
                              <button type="button" onClick={() => handleRemoveAmendRow(row.id)} className="mk-btn mk-btn-sm mk-btn-icon mk-btn-ghost mk-btn-danger" aria-label="Remove row">
                                <Trash2 />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button type="button" onClick={handleAddAmendRow} className="mk-btn">
                  <Plus /> Add row
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ================= OVERVIEW & GRAPH ================= */}
      {showOverviewModal && selectedAssessment && (
        <div className="mk-backdrop" style={revealStep < 4 ? { padding: 0 } : undefined}>
          <div
            className={`mk-modal ${revealStep < 4 ? '' : 'max-w-6xl'}`}
            style={revealStep < 4 ? { height: '100dvh', maxHeight: '100dvh', borderRadius: 0 } : { height: 'min(90dvh, 860px)' }}
          >
            <div className="mk-modal-head">
              <h2><BarChart2 className="text-indigo-600" /> Overview · {selectedAssessment.name}</h2>
              <div className="flex items-center gap-2">
                {revealStep < 4 && (
                  <button type="button" className="mk-btn mk-btn-sm" onClick={() => setRevealStep(4)}>
                    Skip to statistics
                  </button>
                )}
                <button type="button" onClick={() => setShowOverviewModal(false)} className="mk-btn mk-btn-icon mk-btn-ghost" aria-label="Close">
                  <X />
                </button>
              </div>
            </div>

            {revealStep < 4 ? (
              <div className="flex-1 min-h-0 overflow-y-auto bg-gradient-to-br from-indigo-50 to-blue-100 p-6 flex flex-col items-center justify-center text-center gap-10">
                <AnimatePresence mode="wait">
                  {revealStep === 0 && (
                    <motion.div
                      key="step0"
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.1 }}
                      transition={{ duration: 0.8 }}
                      className="flex flex-col items-center gap-10"
                    >
                      <h3 className="mk-reveal-title">Ready to reveal class performance?</h3>
                      <button type="button" onClick={() => setRevealStep(1)} className="mk-reveal-btn animate-pulse">
                        Reveal mean & pass rate
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {revealStep >= 1 && (
                  <motion.div
                    key="step1"
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.8 }}
                    className="w-full flex flex-col items-center gap-6"
                  >
                    <h3 className="mk-reveal-title">Class performance</h3>
                    <div className="flex flex-wrap justify-center gap-6 w-full">
                      <motion.div
                        initial={{ opacity: 0, x: -40 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.8, delay: 1.2 }}
                        className="mk-reveal-card"
                      >
                        <p className="text-sm font-bold uppercase tracking-wider text-slate-500">Mean score</p>
                        <p className="mk-reveal-num text-blue-600 mt-4 flex items-baseline justify-center">
                          {String(overallStats?.mean || '-').split('').map((char, i) => (
                            <motion.span key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 1.8 + (i * 0.8) }}>
                              {char}
                            </motion.span>
                          ))}
                          <span className="text-2xl text-slate-400 ml-2 font-bold">/ {statsData.final.fullMark}</span>
                        </p>
                      </motion.div>
                      <motion.div
                        initial={{ opacity: 0, x: 40 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.8, delay: 4.5 }}
                        className="mk-reveal-card"
                      >
                        <p className="text-sm font-bold uppercase tracking-wider text-slate-500">Pass rate</p>
                        <p className="mk-reveal-num text-green-600 mt-4 flex items-baseline justify-center">
                          {String(overallStats?.passCount || 0).split('').map((char, i) => (
                            <motion.span key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 5.3 + (i * 0.8) }}>
                              {char}
                            </motion.span>
                          ))}
                          <span className="text-2xl text-slate-400 ml-2 font-bold">/ {overallStats?.total || 0}</span>
                        </p>
                      </motion.div>
                    </div>
                  </motion.div>
                )}

                {revealStep >= 2 && (() => {
                  const sortedTotals = currentClassStudents.map(s => {
                    const scaled = hasSections ? calculateScaledTotal(marksData[s.id], selectedAssessment) : calculateTotal(marksData[s.id]);
                    const deduction = parseFloat(marksData[`${s.id}_deduction`]) || 0;
                    return { student: s, total: scaled !== null ? scaled - deduction : null };
                  }).filter(s => s.total !== null).sort((a, b) => b.total - a.total);

                  if (sortedTotals.length < 2) return null;

                  return (
                    <div className="flex flex-wrap justify-center items-end gap-6 w-full">
                      <motion.div
                        initial={{ opacity: 0, y: 80 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 1, delay: 0.5 }}
                        className="mk-reveal-card border-4 border-slate-300"
                      >
                        <p className="text-sm font-bold uppercase tracking-wider text-slate-500">2nd highest</p>
                        <p className="mt-4 text-2xl font-bold text-slate-700">{sortedTotals[1].student.englishName}</p>
                        <p className="text-lg text-slate-500">{sortedTotals[1].student.chineseName}</p>
                        <p className="mk-reveal-num text-slate-600 mt-4 flex items-baseline justify-center">
                          {sortedTotals[1].total.toFixed(1)}
                          <span className="text-xl text-slate-400 ml-2 font-bold">/ {statsData.final.fullMark}</span>
                        </p>
                      </motion.div>

                      {revealStep >= 3 && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.5, y: 120 }}
                          animate={{ opacity: 1, scale: 1.05, y: 0 }}
                          transition={{ duration: 1.2, delay: 0.8, type: 'spring', bounce: 0.4 }}
                          className="mk-reveal-card border-4 border-yellow-400"
                          style={{ background: 'linear-gradient(#fef9c3, #fefce8)' }}
                        >
                          <p className="text-base font-bold uppercase tracking-wider text-yellow-700 animate-bounce">🏆 Top scorer 🏆</p>
                          <p className="mt-4 text-3xl font-bold text-yellow-900">{sortedTotals[0].student.englishName}</p>
                          <p className="text-xl text-yellow-700">{sortedTotals[0].student.chineseName}</p>
                          <p className="mk-reveal-num text-yellow-600 mt-4 flex items-baseline justify-center">
                            {sortedTotals[0].total.toFixed(1)}
                            <span className="text-xl text-yellow-700/60 ml-2 font-bold">/ {statsData.final.fullMark}</span>
                          </p>
                        </motion.div>
                      )}
                    </div>
                  );
                })()}

                {revealStep >= 1 && (
                  <motion.button
                    type="button"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 1, delay: revealStep === 1 ? 7.5 : 1.5 }}
                    onClick={() => setRevealStep(prev => prev + 1)}
                    className="mk-reveal-btn"
                  >
                    {revealStep === 1 ? 'Reveal top students' : revealStep === 2 ? 'Reveal top scorer' : 'Show full statistics'}
                  </motion.button>
                )}
              </div>
            ) : (
              <div className="mk-modal-body bg-slate-50 space-y-4">
                {overallStats ? (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      ['Mean', overallStats.mean, `/ ${statsData.final.fullMark}`, 'text-blue-600'],
                      ['Median', overallStats.median, '', 'text-blue-600'],
                      ['Pass', `${overallStats.passCount}/${overallStats.total}`, `${Math.round((overallStats.passCount / overallStats.total) * 100)}%`, overallStats.passCount >= overallStats.total / 2 ? 'text-green-600' : 'text-red-500'],
                      ['Highest', overallStats.max, '', 'text-purple-600'],
                      ['Lowest', overallStats.min, '', 'text-orange-500']
                    ].map(([label, value, extra, color]) => (
                      <div key={label} className="mk-card p-3">
                        <div className="mk-label">{label}</div>
                        <div className={`text-2xl font-bold ${color}`}>
                          {value} {extra && <span className="text-sm font-semibold text-slate-400">{extra}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mk-card p-8 text-center text-slate-500">No marks entered yet.</div>
                )}

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="mk-card overflow-auto">
                    <div className="px-4 py-2.5 border-b border-slate-200 text-sm font-bold text-slate-700">Component statistics</div>
                    <table className="mk-table">
                      <thead>
                        <tr>
                          <th className="mk-left">Component</th>
                          <th>Full</th>
                          <th>Mean</th>
                          <th>Median</th>
                          <th>Max</th>
                          <th>Min</th>
                          <th>Pass</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ...(hasSections
                            ? selectedAssessment.sectionsConfig.flatMap(sec => sec.hasSubSections
                              ? [
                                ...sec.subSections.map(sub => ({ key: sub.id, label: `${sec.name} – ${sub.name}`, indent: true, data: statsData[sub.id] })),
                                { key: `sec_${sec.id}`, label: `${sec.name} total`, bold: true, data: statsData[`sec_${sec.id}`] }
                              ]
                              : [{ key: sec.id, label: sec.name, data: statsData[sec.id] }])
                            : []),
                          { key: 'overall', label: 'Final total', bold: true, overall: true, data: statsData.final }
                        ].map(row => {
                          const st = getStats(row.data?.marks || [], row.data?.fullMark);
                          return (
                            <tr key={row.key} style={row.overall ? { background: '#eff6ff' } : undefined}>
                              <td className={`mk-left ${row.bold ? 'font-bold text-slate-800' : 'text-slate-600'}`} style={row.indent ? { paddingLeft: 24 } : undefined}>
                                {row.label}
                              </td>
                              <td className="text-slate-500">{Number.isFinite(row.data?.fullMark) ? Number(row.data.fullMark.toFixed(2)) : '–'}</td>
                              <td className="font-semibold">{st?.mean ?? '–'}</td>
                              <td>{st?.median ?? '–'}</td>
                              <td>{st?.max ?? '–'}</td>
                              <td>{st?.min ?? '–'}</td>
                              <td className={st ? (st.passCount >= st.total / 2 ? 'text-green-600 font-semibold' : 'text-red-500 font-semibold') : ''}>
                                {st ? `${st.passCount}/${st.total}` : '–'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="mk-card p-4 flex flex-col">
                    <div className="text-sm font-bold text-slate-700 mb-3">Score distribution (% of full mark)</div>
                    <div style={{ height: 340 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={getGraphData()} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={50} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} name="Students" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= TERM SCORE CALCULATOR ================= */}
      {showTermScoreModal && (
        <div className="mk-backdrop">
          <div className="mk-modal max-w-7xl" style={{ height: 'min(92dvh, 920px)' }}>
            <div className="mk-modal-head">
              <div>
                <h2><Calculator className="text-purple-600" /> Term score calculator</h2>
                <p className="text-xs text-slate-500 mt-0.5">Calculate term scores and copy them for WebSAMS.</p>
              </div>
              <button type="button" onClick={() => setShowTermScoreModal(false)} className="mk-btn mk-btn-icon mk-btn-ghost" aria-label="Close">
                <X />
              </button>
            </div>

            {/* Controls */}
            <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-3 flex flex-wrap items-end gap-3">
              <div className="mk-field relative">
                <span className="mk-label">Classes</span>
                <button
                  type="button"
                  className="mk-input flex items-center justify-between gap-2 min-w-[180px] text-left"
                  onClick={() => setClassPickerOpen(open => !open)}
                  aria-expanded={classPickerOpen}
                >
                  <span className="truncate max-w-[220px]">
                    {modalClasses.length === 0
                      ? 'Choose classes'
                      : modalClasses.length <= 2
                        ? modalClasses.map(cleanClassName).join(', ')
                        : `${modalClasses.length} classes`}
                  </span>
                  <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                </button>
                {classPickerOpen && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setClassPickerOpen(false)} />
                    <div className="absolute left-0 top-full mt-1 z-30 w-64 rounded-lg border border-slate-200 bg-white p-1 shadow-lg max-h-72 overflow-auto">
                      {classes.map(c => (
                        <label key={c.name} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-purple-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={modalClasses.includes(c.name)}
                            onChange={() => {
                              setModalClasses(previous =>
                                previous.includes(c.name)
                                  ? previous.filter(name => name !== c.name)
                                  : [...previous, c.name]
                              );
                              setTermScoresData([]);
                              setTermResultMode('');
                            }}
                            className="rounded text-purple-600"
                          />
                          <span className="break-words">{cleanClassName(c.name)}</span>
                        </label>
                      ))}
                      <div className="border-t border-slate-100 p-1 mt-1">
                        <button type="button" className="mk-btn mk-btn-sm w-full" onClick={() => setClassPickerOpen(false)}>Done</button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <label className="mk-field">
                <span className="mk-label">Term</span>
                <select
                  value={modalTerm}
                  onChange={(e) => {
                    setModalTerm(e.target.value);
                    setTermScoresData([]);
                    setTermResultMode('');
                  }}
                  className="mk-input min-w-[130px]"
                >
                  {modalTermsList.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>

              <div className="mk-field">
                <span className="mk-label">Preset</span>
                <div className="flex gap-1.5">
                  <select
                    value={selectedPresetId}
                    onChange={(e) => {
                      setSelectedPresetId(e.target.value);
                      if (termResultMode === 'preset') {
                        setTermScoresData([]);
                        setTermResultMode('');
                      }
                    }}
                    className="mk-input min-w-[170px]"
                  >
                    {presets.length === 0 && <option value="">No presets</option>}
                    {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button type="button" className="mk-btn mk-btn-icon" onClick={() => openSettings('presets')} title="Manage presets" aria-label="Manage presets">
                    <Settings />
                  </button>
                </div>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => calculateTermScores('preset')}
                  disabled={!selectedPresetId || Boolean(calculatingMode) || modalClasses.length === 0}
                  className="mk-btn mk-btn-purple"
                  title={describePresetFormula(selectedPreset)}
                >
                  {calculatingMode === 'preset' ? <Loader2 className="animate-spin" /> : <Calculator />}
                  Calculate
                </button>
                <span className="mk-divider" />
                <button
                  type="button"
                  onClick={() => calculateTermScores('la-hw')}
                  disabled={Boolean(calculatingMode) || modalClasses.length === 0}
                  className={`mk-btn ${termResultMode === 'la-hw' ? 'mk-btn-soft-purple' : ''}`}
                  title={LA_HOMEWORK_FORMULA}
                >
                  {calculatingMode === 'la-hw' ? <Loader2 className="animate-spin" /> : <BookOpen />}
                  Learning Attitude (Homework)
                </button>
                <button
                  type="button"
                  onClick={() => calculateTermScores('la-lesson')}
                  disabled={Boolean(calculatingMode) || modalClasses.length === 0}
                  className={`mk-btn ${termResultMode === 'la-lesson' ? 'mk-btn-soft-purple' : ''}`}
                  title={LA_LESSON_FORMULA}
                >
                  {calculatingMode === 'la-lesson' ? <Loader2 className="animate-spin" /> : <Users />}
                  Learning Attitude (Lesson)
                </button>
              </div>
            </div>

            {/* Formula + copy bar */}
            <div className="shrink-0 border-b border-purple-100 bg-purple-50 px-5 py-2.5 flex flex-wrap items-center gap-3">
              <Info className="w-4 h-4 text-purple-600 shrink-0" />
              <p className="flex-1 min-w-[220px] text-xs text-purple-800">
                <b>{termResultMode === 'la-hw' ? 'Learning Attitude (Homework)' : termResultMode === 'la-lesson' ? 'Learning Attitude (Lesson)' : (selectedPreset?.name || 'Formula')}:</b>{' '}
                {termFormulaText}
              </p>
              {termScoresData.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => handleCopyScores('A1')} className="mk-btn mk-btn-sm">
                    {termCopySuccess === 'A1' ? <CheckCircle /> : <Copy />}
                    Copy {termIsLearningAttitude ? 'Learning Attitude' : `${getTermPrefix()}A1`}
                  </button>
                  {!termIsLearningAttitude && (
                    <>
                      <button type="button" onClick={() => handleCopyScores('A2')} className="mk-btn mk-btn-sm">
                        {termCopySuccess === 'A2' ? <CheckCircle /> : <Copy />} Copy {getTermPrefix()}A2
                      </button>
                      <button type="button" onClick={() => handleCopyScores('A3')} className="mk-btn mk-btn-sm">
                        {termCopySuccess === 'A3' ? <CheckCircle /> : <Copy />} Copy {getTermPrefix()}A3
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-auto bg-slate-50 p-4">
              {termScoresData.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center">
                  <Calculator className="w-12 h-12 text-slate-300 mb-3" />
                  <p className="text-sm">Choose classes and a term, then press <b>Calculate</b> or a <b>Learning Attitude</b> button.</p>
                </div>
              ) : (
                <div className="mk-card overflow-auto">
                  <table className="mk-table">
                    <thead>
                      <tr>
                        {modalClasses.length > 1 && <th>Class</th>}
                        <th>No.</th>
                        <th className="mk-left">Name</th>
                        {displayCategories.map(cat => {
                          const weight = termScoresData[0].categoryScores[cat]?.weight || 0;
                          let headerName = cat;
                          if (cat === 'Uniform Test') headerName = `Uniform Test (${getTermPrefix()}A3)`;
                          return (
                            <th key={cat} className="mk-sep">
                              {headerName}
                              {!termIsLearningAttitude && <span className="mk-sub" style={{ color: '#7c3aed', fontWeight: 700 }}>{weight}%</span>}
                            </th>
                          );
                        })}
                        <th className="mk-sep" style={{ color: '#6d28d9' }}>
                          {termIsLearningAttitude ? 'Learning Attitude' : `Daily marks (${getTermPrefix()}A1)`}
                        </th>
                        {!termIsLearningAttitude && (
                          <th className="mk-sep" style={{ color: '#1d4ed8' }}>Exam ({getTermPrefix()}A2)</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {termScoresData.map((data, idx) => {
                        let scoreStyle = { background: 'rgba(245,243,255,.8)', color: '#6d28d9' };
                        let rowStyle;
                        if (data.highlight === 'top') {
                          rowStyle = { background: '#f0fdf4' };
                          scoreStyle = { background: '#dcfce7', color: '#166534' };
                        } else if (data.highlight === 'middle') {
                          rowStyle = { background: '#eff6ff' };
                          scoreStyle = { background: '#dbeafe', color: '#1e40af' };
                        } else if (data.highlight === 'bottom') {
                          rowStyle = { background: '#fff7ed' };
                          scoreStyle = { background: '#ffedd5', color: '#9a3412' };
                        }

                        return (
                          <tr key={idx} style={rowStyle}>
                            {modalClasses.length > 1 && <td className="text-slate-600">{cleanClassName(data.student.className)}</td>}
                            <td className="font-semibold">{data.student.classNumber}</td>
                            <td className="mk-left font-medium text-slate-800">{data.student.englishName}</td>
                            {displayCategories.map(cat => {
                              const catData = data.categoryScores[cat];
                              if (termResultMode === 'la-lesson') {
                                return (
                                  <td key={cat} className="mk-sep">
                                    {cat === 'Records'
                                      ? <span className="font-semibold">{catData.raw}</span>
                                      : (
                                        <>
                                          <div className="font-semibold">{catData.score.toFixed(1)}%</div>
                                          <div className="text-[10px] text-slate-400">({catData.raw.toFixed(1)}/{catData.full})</div>
                                        </>
                                      )}
                                  </td>
                                );
                              }
                              return (
                                <td key={cat} className="mk-sep">
                                  <div className="font-semibold text-slate-700">{catData.score.toFixed(1)}</div>
                                  <div className="text-[10px] text-slate-400">({catData.raw.toFixed(1)}/{catData.full})</div>
                                </td>
                              );
                            })}
                            <td className="mk-sep font-bold text-base" style={scoreStyle}>{data.overallScore}</td>
                            {!termIsLearningAttitude && (
                              <td className="mk-sep font-bold text-base" style={{ color: '#1d4ed8' }}>
                                {data.rawExam !== undefined ? data.rawExam.toFixed(1) : '–'}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= SETTINGS ================= */}
      {showSettings && (
        <div className="mk-backdrop" style={{ zIndex: 60 }}>
          <div className="mk-modal max-w-3xl" style={{ height: 'min(660px, calc(100dvh - 32px))' }}>
            <div className="mk-modal-head">
              <div>
                <h2><Settings className="text-slate-600" /> Settings</h2>
                <p className="text-xs text-slate-500 mt-0.5">{cleanClassName(selectedClass)}</p>
              </div>
              <button type="button" onClick={() => setShowSettings(false)} className="mk-btn mk-btn-icon mk-btn-ghost" aria-label="Close">
                <X />
              </button>
            </div>

            <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
              <nav className="shrink-0 sm:w-48 border-b sm:border-b-0 sm:border-r border-slate-200 bg-slate-50 p-2 flex sm:flex-col gap-1 overflow-x-auto">
                {[
                  ['general', 'General', <Calculator key="i" />],
                  ['terms', 'Terms', <Calendar key="i" />],
                  ['categories', 'Categories', <Layers key="i" />],
                  ['presets', 'Score presets', <Percent key="i" />]
                ].map(([key, label, icon]) => (
                  <button
                    key={key}
                    type="button"
                    className={`mk-tab ${settingsTab === key ? 'is-active' : ''}`}
                    onClick={() => setSettingsTab(key)}
                  >
                    {icon} {label}
                  </button>
                ))}
              </nav>

              <div className="flex-1 min-h-0 overflow-auto p-5">
                {/* General */}
                {settingsTab === 'general' && (
                  <div className="space-y-6">
                    <section>
                      <h3 className="mk-section-title">Default term score method</h3>
                      <select
                        className="mk-input w-full max-w-sm"
                        value={presets.some(p => p.id === classPresetsMap[selectedClass]) ? classPresetsMap[selectedClass] : ''}
                        onChange={event => handleSaveDefaultPreset(event.target.value)}
                      >
                        <option value="">No default</option>
                        {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <p className="mk-help mt-2">
                        Used first when you open the Term Score calculator or Export for {cleanClassName(selectedClass)}.
                      </p>
                      {presets.find(p => p.id === classPresetsMap[selectedClass]) && (
                        <p className="mt-2 rounded-lg bg-purple-50 border border-purple-100 px-3 py-2 text-xs text-purple-800">
                          {describePresetFormula(presets.find(p => p.id === classPresetsMap[selectedClass]))}
                        </p>
                      )}
                    </section>

                    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                      <h3 className="mk-section-title text-amber-900">Disclosure</h3>
                      <p className="mk-help mb-3">Instantly reveal every hidden item to students, across all classes and terms.</p>
                      <button type="button" className="mk-btn mk-btn-warn" onClick={handleRevealAllClasses}>
                        <Eye /> Reveal all classes
                      </button>
                    </section>
                  </div>
                )}

                {/* Terms */}
                {settingsTab === 'terms' && (
                  <div className="space-y-4">
                    <form onSubmit={handleAddTerm} className="flex gap-2">
                      <input
                        type="text"
                        value={newTermName}
                        onChange={(e) => setNewTermName(e.target.value)}
                        data-gramm="false"
                        data-gramm_editor="false"
                        placeholder="New term, e.g. Term 3"
                        className="mk-input flex-1"
                        required
                      />
                      <button type="submit" className="mk-btn mk-btn-primary"><Plus /> Add term</button>
                    </form>

                    <ul className="mk-card divide-y divide-slate-100">
                      {terms.map((t, index) => (
                        <li key={t} className="flex items-center gap-2 px-3 py-2">
                          {editingTerm === t ? (
                            <>
                              <input
                                type="text"
                                value={editTermName}
                                onChange={(e) => setEditTermName(e.target.value)}
                                onKeyDown={event => {
                                  if (event.key === 'Enter') handleUpdateTerm(t);
                                  if (event.key === 'Escape') setEditingTerm(null);
                                }}
                                data-gramm="false"
                                data-gramm_editor="false"
                                className="mk-input flex-1"
                                autoFocus
                              />
                              <button type="button" onClick={() => handleUpdateTerm(t)} className="mk-btn mk-btn-sm mk-btn-icon" aria-label="Save"><CheckCircle /></button>
                              <button type="button" onClick={() => setEditingTerm(null)} className="mk-btn mk-btn-sm mk-btn-icon" aria-label="Cancel"><X /></button>
                            </>
                          ) : (
                            <>
                              <span className="flex-1 text-sm font-medium text-slate-700">
                                {t}
                                {t === selectedTerm && <span className="mk-chip mk-chip-blue ml-2">Current</span>}
                              </span>
                              <button type="button" onClick={() => handleMoveTerm(index, 'up')} disabled={index === 0} className="mk-btn mk-btn-sm mk-btn-icon mk-btn-ghost" aria-label="Move up"><ChevronUp /></button>
                              <button type="button" onClick={() => handleMoveTerm(index, 'down')} disabled={index === terms.length - 1} className="mk-btn mk-btn-sm mk-btn-icon mk-btn-ghost" aria-label="Move down"><ChevronDown /></button>
                              <button type="button" onClick={() => { setEditingTerm(t); setEditTermName(t); }} className="mk-btn mk-btn-sm mk-btn-icon mk-btn-ghost" aria-label="Rename"><Edit2 /></button>
                              <button type="button" onClick={() => handleDeleteTerm(t)} className="mk-btn mk-btn-sm mk-btn-icon mk-btn-ghost mk-btn-danger" aria-label="Delete"><Trash2 /></button>
                            </>
                          )}
                        </li>
                      ))}
                      {terms.length === 0 && <li className="p-4 text-sm text-slate-500 text-center">No terms yet.</li>}
                    </ul>
                  </div>
                )}

                {/* Categories */}
                {settingsTab === 'categories' && (
                  <div className="space-y-4">
                    {categoryLoadError ? (
                      <p className="text-sm text-red-700" role="alert">{categoryLoadError}</p>
                    ) : !categoriesReady ? (
                      <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading categories…</p>
                    ) : (
                      <>
                        {canManageClassCategories ? (
                          <form onSubmit={handleAddCategory} className="mk-card p-3 space-y-2">
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={newCategoryName}
                                onChange={event => setNewCategoryName(event.target.value)}
                                placeholder="New category for this class"
                                maxLength={80}
                                disabled={isCategorySaving}
                                className="mk-input flex-1"
                              />
                              <button type="submit" disabled={isCategorySaving || !newCategoryName.trim()} className="mk-btn mk-btn-primary">
                                {isCategorySaving ? <Loader2 className="animate-spin" /> : <Plus />} Add
                              </button>
                            </div>
                            <label className="flex items-center gap-2 text-xs text-slate-600">
                              <input
                                type="checkbox"
                                checked={newCategoryIsMulti}
                                onChange={event => setNewCategoryIsMulti(event.target.checked)}
                                disabled={isCategorySaving}
                              />
                              New items in this category use the multi-section layout by default
                            </label>
                          </form>
                        ) : (
                          <p className="mk-help">Only the class owner can change its categories.</p>
                        )}

                        <ul className="mk-card divide-y divide-slate-100">
                          {categories.map(cat => {
const isDefault = MARKS_DEFAULT_CATEGORIES.includes(cat);
                            const usedCount = allTermCountByCategory[cat] || 0;
                            const isMulti = multiSectionCategories.includes(cat);

                            return (
                              <li key={cat} className="flex items-center gap-2 px-3 py-2">
                                {editingCategory === cat ? (
                                  <>
                                    <input
                                      type="text"
                                      value={editCategoryName}
                                      onChange={event => setEditCategoryName(event.target.value)}
                                      onKeyDown={event => {
                                        if (event.key === 'Enter') handleUpdateCategory(cat);
                                        if (event.key === 'Escape') setEditingCategory(null);
                                      }}
                                      disabled={isCategorySaving}
                                      className="mk-input flex-1"
                                      autoFocus
                                    />
                                    <button type="button" onClick={() => handleUpdateCategory(cat)} disabled={isCategorySaving} className="mk-btn mk-btn-sm mk-btn-icon" aria-label="Save category name">
                                      <CheckCircle />
                                    </button>
                                    <button type="button" onClick={() => setEditingCategory(null)} disabled={isCategorySaving} className="mk-btn mk-btn-sm mk-btn-icon" aria-label="Cancel">
                                      <X />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <span className="flex-1 min-w-0 text-sm font-medium text-slate-700 break-words">{cat}</span>
                                    {isMulti && <span className="mk-chip mk-chip-purple">Multi-section</span>}
                                    <span className="mk-chip" title="Items in all terms of this class">
                                      {usedCount} {usedCount === 1 ? 'item' : 'items'}
                                    </span>
                                    {isDefault ? (
                                      <span className="mk-chip">Default</span>
                                    ) : canManageClassCategories ? (
                                      <>
                                        <button
                                          type="button"
                                          disabled={isCategorySaving || usedCount > 0}
                                          onClick={() => {
                                            setEditingCategory(cat);
                                            setEditCategoryName(cat);
                                          }}
                                          className="mk-btn mk-btn-sm mk-btn-icon mk-btn-ghost"
                                          title={usedCount > 0 ? 'Only empty categories can be renamed' : 'Rename'}
                                          aria-label={`Rename ${cat}`}
                                        >
                                          <Edit2 />
                                        </button>
                                        <button
                                          type="button"
                                          disabled={isCategorySaving || usedCount > 0}
                                          onClick={event => handleDeleteCategory(cat, event)}
                                          className="mk-btn mk-btn-sm mk-btn-icon mk-btn-ghost mk-btn-danger"
                                          title={usedCount > 0 ? 'Only empty categories can be removed' : 'Remove'}
                                          aria-label={`Remove ${cat}`}
                                        >
                                          <Trash2 />
                                        </button>
                                      </>
                                    ) : null}
                                  </>
                                )}
                              </li>
                            );
                          })}
                        </ul>

                        {canManageClassCategories && (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={handleCleanClassCategories}
                              disabled={isCategorySaving}
                              className="mk-btn mk-btn-sm"
                              title="Remove empty custom categories from this class (checks all terms)"
                            >
                              <Trash2 /> Clean empty categories
                            </button>
                            {user?.email === SUPER_ADMIN_EMAIL && (
                              <button
                                type="button"
                                onClick={handleCleanAllClassCategories}
                                disabled={isCategorySaving}
                                className="mk-btn mk-btn-sm mk-btn-warn"
                                title="Clean empty custom categories across all active and archived classes"
                              >
                                <AlertTriangle /> Clean ALL classes
                              </button>
                            )}
                          </div>
                        )}
                        <p className="mk-help">
                          The six default categories are always kept. A category that has items in any term cannot be renamed or removed.
                        </p>
                      </>
                    )}
                  </div>
                )}

                {/* Presets */}
                {settingsTab === 'presets' && (
                  <div className="space-y-5">
                    <form onSubmit={handleAddPreset} className="mk-card p-4 space-y-3">
                      <h3 className="mk-section-title mb-0">New preset</h3>
                      <input
                        type="text"
                        value={newPresetName}
                        onChange={(e) => setNewPresetName(e.target.value)}
                        data-gramm="false"
                        data-gramm_editor="false"
                        placeholder="Preset name, e.g. S3 History"
                        className="mk-input w-full"
                        required
                      />
                      <div>
                        <div className="mk-label mb-2">Category weights (%)</div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {categories.map(cat => (
                            <label key={cat} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-1.5">
                              <span className="text-sm text-slate-700 truncate">{cat}</span>
                              <span className="flex items-center gap-1">
                                <input
                                  type="number"
                                  placeholder="0"
                                  value={newPresetWeights[cat] || ''}
                                  onChange={(e) => updatePresetWeight(cat, e.target.value)}
                                  data-gramm="false"
                                  data-gramm_editor="false"
                                  className="mk-cell-input"
                                  style={{ width: 64 }}
                                />
                                <Percent className="w-3.5 h-3.5 text-slate-400" />
                              </span>
                            </label>
                          ))}
                        </div>
                        <p className="mk-help mt-2">
                          Weights total: <b>{Object.values(newPresetWeights).reduce((sum, value) => sum + (Number(value) || 0), 0)}%</b>
                        </p>
                      </div>
                      {user?.email === SUPER_ADMIN_EMAIL && (
                        <label className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={isSharedPreset}
                            onChange={(e) => setIsSharedPreset(e.target.checked)}
                            className="rounded text-purple-600"
                          />
                          Share this preset with all admins
                        </label>
                      )}
                      <button type="submit" className="mk-btn mk-btn-purple">
                        <Save /> Save preset
                      </button>
                    </form>

                    <div>
                      <h3 className="mk-section-title">Existing presets</h3>
                      <ul className="mk-card divide-y divide-slate-100">
                        {presets.map(p => (
                          <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                                <span className="truncate">{p.name}</span>
                                {p.isShared && <span className="mk-chip mk-chip-blue">Shared</span>}
                                {classPresetsMap[selectedClass] === p.id && <span className="mk-chip mk-chip-purple">Default</span>}
                              </div>
                              <div className="text-xs text-slate-500 mt-0.5">{describePresetFormula(p)}</div>
                            </div>
                            {user?.email === SUPER_ADMIN_EMAIL && (
                              <button
                                type="button"
                                onClick={() => handleToggleShareExistingPreset(p.id, p.isShared)}
                                className="mk-btn mk-btn-sm"
                              >
                                {p.isShared ? 'Unshare' : 'Share'}
                              </button>
                            )}
                            {(!p.isShared || user?.email === p.owner || user?.email === SUPER_ADMIN_EMAIL) && (
                              <button
                                type="button"
                                onClick={() => handleDeletePreset(p.id)}
                                className="mk-btn mk-btn-sm mk-btn-icon mk-btn-ghost mk-btn-danger"
                                aria-label={`Delete ${p.name}`}
                              >
                                <Trash2 />
                              </button>
                            )}
                          </li>
                        ))}
                        {presets.length === 0 && <li className="p-4 text-sm text-slate-500 text-center">No presets yet.</li>}
                      </ul>
                      <p className="mk-help mt-2">
                        Learning Attitude (Homework / Lesson) are now separate buttons in the Term Score calculator.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= EXPORT TO EXCEL ================= */}
      {showExportModal && (
        <div className="mk-backdrop">
          <div className="mk-modal max-w-3xl">
            <div className="mk-modal-head">
              <div>
                <h2><Download className="text-emerald-600" /> Export to Excel</h2>
                <p className="text-xs text-slate-500 mt-0.5">{cleanClassName(selectedClass)} · {selectedTerm}</p>
              </div>
              <button type="button" onClick={() => setShowExportModal(false)} className="mk-btn mk-btn-icon mk-btn-ghost" aria-label="Close">
                <X />
              </button>
            </div>

            <div className="mk-modal-body bg-slate-50 space-y-4">
              <section className="mk-card p-4">
                <h3 className="mk-section-title">1. Term score preset</h3>
                <select
                  value={exportPresetId}
                  onChange={(e) => setExportPresetId(e.target.value)}
                  className="mk-input w-full max-w-sm"
                >
                  {presets.length === 0 && <option value="">No presets available</option>}
                  {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {presets.find(p => p.id === exportPresetId) && (
                  <p className="mk-help mt-2">{describePresetFormula(presets.find(p => p.id === exportPresetId))}</p>
                )}
              </section>

              <section className="mk-card p-4">
                <h3 className="mk-section-title">2. Column order (top to bottom = left to right)</h3>
                <div className="space-y-3">
                  {Object.keys(exportAssessmentsMap)
                    .filter(cat => (exportAssessmentsMap[cat] || []).length > 0)
                    .map(cat => (
                      <div key={cat} className="rounded-lg border border-slate-200 overflow-hidden">
                        <div className="bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 border-b border-slate-200 flex items-center gap-2">
                          {cat} <span className="mk-count">{exportAssessmentsMap[cat].length}</span>
                        </div>
                        <ul className="divide-y divide-slate-100 bg-white">
                          {exportAssessmentsMap[cat].map((item, index) => (
                            <li key={item.id} className="flex items-center gap-2 px-3 py-1.5">
                              <span className="flex-1 min-w-0 truncate text-sm text-slate-700">{item.name}</span>
                              <span className="text-xs text-slate-400">{item.date}</span>
                              <button type="button" onClick={() => moveExportItem(cat, index, 'up')} disabled={index === 0} className="mk-btn mk-btn-sm mk-btn-icon mk-btn-ghost" aria-label="Move up"><ChevronUp /></button>
                              <button type="button" onClick={() => moveExportItem(cat, index, 'down')} disabled={index === exportAssessmentsMap[cat].length - 1} className="mk-btn mk-btn-sm mk-btn-icon mk-btn-ghost" aria-label="Move down"><ChevronDown /></button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  {Object.values(exportAssessmentsMap).every(list => (list || []).length === 0) && (
                    <p className="text-sm text-slate-500">No configured items in this term.</p>
                  )}
                  {Object.keys(exportAssessmentsMap).some(cat => (exportAssessmentsMap[cat] || []).length === 0) && (
                    <p className="mk-help">
                      Empty: {Object.keys(exportAssessmentsMap).filter(cat => (exportAssessmentsMap[cat] || []).length === 0).join(', ')}
                    </p>
                  )}
                </div>
              </section>
            </div>

            <div className="mk-modal-foot">
              <button type="button" onClick={() => setShowExportModal(false)} className="mk-btn">Cancel</button>
              <button type="button" onClick={generateExcel} className="mk-btn mk-btn-emerald">
                <Download /> Download Excel file
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= DOCUMENT LINKER ================= */}
      {showDocLinker && (
        <DesignatedDocumentLinker
          key={`${docLinkerTarget || 'main'}:${selectedAssessment?.id || 'new'}`}
          archives={archives}
          loading={docCatalogueLoading}
          error={docCatalogueError}
          selectedId={
            docLinkerTarget === 'main'
              ? linkedDocId
              : sectionsConfig.find(section => section.id === docLinkerTarget)?.linkedDocId || ''
          }
          onClose={() => setShowDocLinker(false)}
          onSelect={({ linkedDocId: selectedLink }) => {
            if (docCatalogueLoading || docCatalogueError) return;

            if (docLinkerTarget === 'main') {
              setLinkedDocId(selectedLink);
            } else {
              updateSection(docLinkerTarget, 'linkedDocId', selectedLink);
            }

            setShowDocLinker(false);
          }}
        />
      )}

      {/* ================= LINKED DOCUMENT PREVIEW ================= */}
      {previewItem && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-xl w-full h-full shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-white shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    {previewItem.parent.year || ''} · {previewItem.parent.origin || ''}
                  </span>
                  <span className={`mk-chip ${previewItem.parent.paperType?.includes('1') ? 'mk-chip-yellow' : 'mk-chip-purple'}`}>
                    {previewItem.parent.paperType || 'Unknown'}
                  </span>
                </div>
                <h2 className="text-base font-bold text-slate-800 flex items-center gap-2 flex-wrap">
                  {viewingAnswer ? 'Answer key: ' : ''}{previewItem.parent.title || 'Untitled document'}
                  <span className="mk-chip mk-chip-blue">
                    {previewItem.isFullPaper ? 'Full paper' : `Part ${previewItem.child?.label || ''}`}
                  </span>
                </h2>
              </div>

              {selectedAssessment && overallStats && (
                <div className="hidden md:flex items-center gap-4 text-xs bg-slate-50 border border-slate-200 rounded-lg px-4 py-1.5">
                  {[
                    ['Mean', overallStats.mean, 'text-slate-700'],
                    ['Median', overallStats.median, 'text-slate-700'],
                    ['Pass', `${overallStats.passCount}/${overallStats.total}`, overallStats.passCount >= overallStats.total / 2 ? 'text-green-600' : 'text-red-500'],
                    ['Max', overallStats.max, 'text-blue-600'],
                    ['Min', overallStats.min, 'text-orange-500']
                  ].map(([label, value, color]) => (
                    <div key={label} className="flex flex-col items-center">
                      <span className="text-slate-400 font-semibold uppercase text-[10px]">{label}</span>
                      <span className={`font-bold text-sm ${color}`}>{value}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {!viewingAnswer && previewItem.parent.hasAnswer && (
                  <button type="button" onClick={() => setViewingAnswer(true)} className="mk-btn mk-btn-emerald">
                    <BookOpen /> Show answer
                  </button>
                )}
                {viewingAnswer && (
                  <button type="button" onClick={() => setViewingAnswer(false)} className="mk-btn">
                    <ArrowLeft /> Back to question
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleViewLinkedMarks(previewItem.parent.id, previewItem.parent.title)}
                  className="mk-btn mk-btn-soft"
                >
                  <BarChart2 /> View marks
                </button>
                <select
                  value={previewLanguage}
                  onChange={event => setPreviewLanguage(event.target.value)}
                  className="mk-input"
                  aria-label="Language"
                >
                  <option value="en">English</option>
                  <option value="zh">中文</option>
                </select>
                {previewPdfUrl && (
                  <a
                    href={previewPdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mk-btn mk-btn-primary"
                  >
                    <Download /> {viewingAnswer ? 'Open answer' : 'Open PDF'}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setPreviewItem(null);
                    setViewingAnswer(false);
                  }}
                  className="mk-btn mk-btn-icon mk-btn-ghost"
                  aria-label="Close"
                >
                  <X />
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 min-w-0 overflow-auto md:overflow-hidden flex flex-col md:flex-row">
              {!viewingAnswer && (
                <div className={`${previewPdfUrl ? 'md:w-1/3 lg:w-1/4 md:border-r border-slate-200 shrink-0' : 'w-full'} p-4 overflow-y-auto bg-slate-50`}>
                  <div className="space-y-3">
                    <div className="mk-card p-4">
                      <h3 className="text-sm font-bold text-slate-800 mb-2">Paper overview</h3>
                      {previewItem.parent.versionFamilyId && (
                        <p className="mb-2 text-xs font-bold text-indigo-700">
                          Version: {previewItem.parent.versionLabel || previewItem.parent.year || 'Year unknown'}
                          {previewItem.parent.versionIsOriginal ? ' (Original)' : ''}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        {(
                          Array.isArray(previewItem.parent.topic)
                            ? previewItem.parent.topic
                            : previewItem.parent.topic ? [previewItem.parent.topic] : []
                        ).filter(Boolean).map((topic, index) => (
                          <span key={index} className="mk-chip mk-chip-blue"><Tag /> {topic}</span>
                        ))}
                      </div>
                    </div>

                    <h3 className="mk-label flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" />
                      {previewItem.isFullPaper ? 'All sub-questions' : 'Linked sub-question'}
                    </h3>

                    {(
                      previewItem.isFullPaper
                        ? previewItem.parent.subQuestions || []
                        : previewItem.child ? [previewItem.child] : []
                    ).map(sq => {
                      const preferredText = previewLanguage === 'zh' ? sq.contentChi : sq.content;
                      const alternativeText = previewLanguage === 'zh' ? sq.content : sq.contentChi;
                      const text = preferredText || alternativeText || '';

                      return (
                        <div key={sq.id} className="mk-card p-4">
                          <div className="flex justify-between items-start mb-2">
                            <span className="bg-slate-800 text-white text-xs px-2 py-0.5 rounded-md font-bold">Q{sq.label}</span>
                            {previewItem.parent.paperType === 'Paper 1 (DBQ)' && String(sq.marks ?? '') !== '' && (
                              <span className="mk-chip">{sq.marks} marks</span>
                            )}
                          </div>
                          {!preferredText && alternativeText && (
                            <p className="mb-2 text-xs text-amber-700">Selected language unavailable; showing the other language.</p>
                          )}
                          <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                            {text || <span className="text-slate-400 italic">No text content available.</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(previewPdfUrl || viewingAnswer) && (
                <div className="flex-1 min-w-0 min-h-[50vh] md:min-h-0 bg-slate-200 flex flex-col relative">
                  <div className="shrink-0 px-3 py-1.5 bg-slate-100 text-xs text-slate-600 border-b border-slate-300">
                    {previewLanguage === 'zh' ? 'Chinese preferred' : 'English preferred'} — falls back to the other language when unavailable.
                  </div>
                  <div className="relative flex-1 min-h-[45vh] md:min-h-0">
                    <div className="absolute inset-0">
                      <MarksPdfAttachment
                        fileUrl={previewPdfUrl}
                        title={viewingAnswer ? 'Answer preview' : 'Question preview'}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= LINKED MARKS RECORD ================= */}
      {showMarksModal && (
        <div className="mk-backdrop" style={{ zIndex: 70 }}>
          <div className="mk-modal max-w-4xl">
            <div className="mk-modal-head">
              <div className="min-w-0">
                <h2><BarChart2 className="text-teal-600" /> Linked marks record</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Marks linked to: <b className="text-slate-700">{currentMarksDocTitle}</b>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="mk-seg">
                  <button type="button" className={linkedMarksMode === 'total' ? 'is-active' : ''} onClick={() => setLinkedMarksMode('total')}>Totals</button>
                  <button type="button" className={linkedMarksMode === 'details' ? 'is-active' : ''} onClick={() => setLinkedMarksMode('details')}>Details</button>
                </div>
                <button type="button" onClick={() => setShowMarksModal(false)} className="mk-btn mk-btn-icon mk-btn-ghost" aria-label="Close">
                  <X />
                </button>
              </div>
            </div>

            <div className="mk-modal-body bg-slate-50 space-y-3">
              {linkedMarksError && (
                <p role="alert" className="whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {linkedMarksError}
                </p>
              )}
              <p className="mk-help">Component-linked documents show only their linked component and its recorded parts.</p>

              {isLoadingMarks ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 className="w-8 h-8 animate-spin text-teal-600 mb-3" />
                  <p className="text-sm text-slate-500">Loading marks…</p>
                </div>
              ) : linkedMarksData.length === 0 ? (
                <div className="mk-card border-dashed flex flex-col items-center justify-center py-14 text-center">
                  <BarChart2 className="w-10 h-10 text-slate-300 mb-3" />
                  <h3 className="text-base font-semibold text-slate-600">No marks found</h3>
                  <p className="text-sm text-slate-500 max-w-xs mt-1">
                    {linkedMarksError
                      ? 'The request failed. Close this window and click View marks to retry.'
                      : 'No recorded student marks were found through the main or section links for this document.'}
                  </p>
                </div>
              ) : (
                <div className="mk-card overflow-auto max-h-[60vh]">
                  <table className="mk-table">
                    <thead>
                      <tr>
                        <th className="mk-left">Class</th>
                        <th>No.</th>
                        <th className="mk-left">Student</th>
                        <th className="mk-left">Assessment</th>
                        <th className="mk-left">Term / Category</th>
                        <th style={{ textAlign: 'right', color: '#0f766e' }}>Mark</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linkedMarksData.map((record, idx) => (
                        <tr key={idx}>
                          <td className="mk-left font-medium">{cleanClassName(record.className)}</td>
                          <td>{record.classNumber}</td>
                          <td className="mk-left font-medium text-slate-800">{record.studentName}</td>
                          <td className="mk-left">{record.assessmentName}</td>
                          <td className="mk-left text-xs text-slate-500">{record.term} · {record.category}</td>
                          <td style={{ textAlign: 'right', verticalAlign: 'top' }}>
                            <LinkedMarksValue record={record} detailed={linkedMarksMode === 'details'} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}