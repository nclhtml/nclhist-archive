import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

import {
  collection,
  getDocs,
  query,
  where
} from 'firebase/firestore';

import { db } from './firebase.js';

const DBQ_QUESTIONS = ['Q1', 'Q2', 'Q3', 'Q4'];
const ESSAY_QUESTIONS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'];

const CATEGORY_NAMES = [
  'First World War',
  'Second World War',
  'Cold War',
  'China',
  'Hong Kong',
  'Japan',
  'Intl. Cooperation'
];

function ensureArray(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : [];

  return values
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

function getCategory(topic) {
  const text = String(topic || '').toLowerCase();

  if (text.includes('first world war') || text.includes('ww1')) {
    return 'First World War';
  }

  if (text.includes('second world war') || text.includes('ww2')) {
    return 'Second World War';
  }

  if (text.includes('cold war')) return 'Cold War';

  if (text.includes('hong kong') || text.includes('hk')) {
    return 'Hong Kong';
  }

  if (
    text.includes('china') ||
    text.includes('communist revolution')
  ) {
    return 'China';
  }

  if (text.includes('japan')) return 'Japan';

  if (
    text.includes('international') ||
    text.includes('cooperation')
  ) {
    return 'Intl. Cooperation';
  }

  return '';
}

function getTopicColor(topic) {
  const category = getCategory(topic);

  const colors = {
    'First World War': 'bg-red-100 text-red-800 border-red-200',
    'Second World War': 'bg-orange-100 text-orange-800 border-orange-200',
    'Cold War': 'bg-blue-100 text-blue-800 border-blue-200',
    China: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    'Hong Kong': 'bg-purple-100 text-purple-800 border-purple-200',
    Japan: 'bg-pink-100 text-pink-800 border-pink-200',
    'Intl. Cooperation': 'bg-teal-100 text-teal-800 border-teal-200'
  };

  if (colors[category]) return colors[category];

  if (String(topic).toLowerCase().includes('elective')) {
    return 'bg-white text-slate-700 border-slate-300';
  }

  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function sortYears(a, b) {
  if (a === b) return 0;
  if (a === 'SP') return -1;
  if (b === 'SP') return 1;
  if (a === 'PP') return -1;
  if (b === 'PP') return 1;

  return a.localeCompare(b, undefined, { numeric: true });
}

function countTopics(grid) {
  const counts = Object.fromEntries(
    CATEGORY_NAMES.map(category => [category, 0])
  );

  Object.values(grid).forEach(yearData => {
    Object.values(yearData).forEach(topics => {
      const categoriesInQuestion = new Set(
        topics.map(getCategory).filter(Boolean)
      );

      categoriesInQuestion.forEach(category => {
        counts[category] += 1;
      });
    });
  });

  return counts;
}

function TopicBadges({ topics }) {
  if (!topics.length) {
    return <span className="text-sm text-slate-400">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {topics.map((topic, index) => (
        <span
          key={`${topic}-${index}`}
          className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${getTopicColor(topic)}`}
        >
          {topic}
        </span>
      ))}
    </div>
  );
}

function TrendSection({
  title,
  questions,
  grid,
  years,
  selectedYear
}) {
  const counts = useMemo(() => countTopics(grid), [grid]);

  return (
    <section className="mb-6 min-w-0">
      <h2 className="mb-3 text-lg md:text-xl font-bold text-slate-800">
        {title}
      </h2>

      <details className="mb-4 rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-700">
          Topic totals — all years
        </summary>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 p-3 pt-0">
          {Object.entries(counts).map(([label, count]) => (
            <div
              key={label}
              className={`rounded-lg border p-3 ${getTopicColor(label)}`}
            >
              <div className="text-2xl font-bold">{count}</div>
              <div className="mt-1 text-xs leading-tight">
                {label}
              </div>
            </div>
          ))}
        </div>
      </details>

      {/* Phone: show one year's questions without a very wide table. */}
      <div className="compact-phone-only space-y-2">
        {questions.map(question => (
          <div
            key={question}
            className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3"
          >
            <span className="w-8 shrink-0 font-bold text-slate-700">
              {question}
            </span>

            <div className="min-w-0 flex-1">
              <TopicBadges
                topics={grid[selectedYear]?.[question] || []}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: retain the complete year-by-year matrix. */}
      <div className="compact-desktop-only max-w-full overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="sticky left-0 z-10 border-r border-slate-200 bg-slate-50 p-4">
                Question
              </th>

              {years.map(year => (
                <th
                  key={year}
                  className="min-w-[150px] border-r border-slate-100 p-4 text-center"
                >
                  {year}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {questions.map(question => (
              <tr
                key={question}
                className="border-t border-slate-100"
              >
                <th className="sticky left-0 z-10 border-r border-slate-200 bg-slate-50 p-4 text-slate-800">
                  {question}
                </th>

                {years.map(year => (
                  <td
                    key={`${year}-${question}`}
                    className="border-r border-slate-100 p-3 align-top"
                  >
                    <TopicBadges
                      topics={grid[year]?.[question] || []}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function DseTrend() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  const [years, setYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState('');
  const [trendData, setTrendData] = useState({});
  const [trendDataEssay, setTrendDataEssay] = useState({});

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError('');

    const loadTrend = async () => {
      try {
        // Filter in Firestore, not after downloading all archives.
        const snapshot = await getDocs(
          query(
            collection(db, 'archives'),
            where('origin', '==', 'DSE Pastpaper')
          )
        );

        const dbqGrid = {};
        const essayGrid = {};
        const foundYears = new Set(['SP', 'PP']);

        snapshot.docs.forEach(document => {
          const item = document.data();

          if (
            item.year === undefined ||
            item.year === null ||
            String(item.year).trim() === ''
          ) return;

          const year = String(item.year).trim();
          foundYears.add(year);

          dbqGrid[year] ||= {};
          essayGrid[year] ||= {};

          if (item.paperType === 'Paper 1 (DBQ)') {
            const match = String(item.title || '')
              .match(/\bQ\s*([1-4])\b/i);

            if (match) {
              const question = `Q${match[1]}`;

              dbqGrid[year][question] = [
                ...new Set([
                  ...(dbqGrid[year][question] || []),
                  ...ensureArray(item.topic)
                ])
              ];
            }
          }

          if (item.paperType === 'Paper 2 (Essay)') {
            (item.subQuestions || []).forEach(subQuestion => {
              const number = String(subQuestion.label || '')
                .trim()
                .replace(/^Q\s*/i, '');

              const question = `Q${number}`;

              if (!ESSAY_QUESTIONS.includes(question)) return;

              essayGrid[year][question] = [
                ...new Set([
                  ...(essayGrid[year][question] || []),
                  ...ensureArray(subQuestion.topic)
                ])
              ];
            });
          }
        });

        if (cancelled) return;

        const sortedYears = [...foundYears].sort(sortYears);

        setYears(sortedYears);
        setTrendData(dbqGrid);
        setTrendDataEssay(essayGrid);

        setSelectedYear(previous =>
          sortedYears.includes(previous)
            ? previous
            : sortedYears[sortedYears.length - 1] || ''
        );
      } catch (requestError) {
        if (!cancelled) {
          console.error('Error fetching DSE trend:', requestError);
          setError(
            requestError.message || 'Could not load DSE trend data.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadTrend();

    return () => {
      cancelled = true;
    };
  }, [reload]);

  if (loading) {
    return (
      <div
        role="status"
        className="flex min-h-[40vh] items-center justify-center"
      >
        <Loader2 size={32} className="animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto my-8 max-w-xl rounded-xl border border-red-200 bg-red-50 p-5">
        <h2 className="font-bold text-red-800">
          DSE trend could not be loaded
        </h2>

        <p className="mt-2 text-sm text-red-700">{error}</p>

        <button
          type="button"
          onClick={() => setReload(previous => previous + 1)}
          className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="trend-page w-full min-w-0 max-w-[1600px] mx-auto p-3 md:p-6">
      <h1 className="mb-4 text-xl md:text-2xl font-bold text-slate-800">
        DSE Topic Trends
      </h1>

      <label className="compact-phone-only mb-5">
        <span className="mb-1 block text-xs font-bold text-slate-500">
          Examination year
        </span>

        <select
          value={selectedYear}
          onChange={event => setSelectedYear(event.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-base text-slate-800"
        >
          {years.map(year => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </label>

      <TrendSection
        title="Paper 1 (Data-Based Questions)"
        questions={DBQ_QUESTIONS}
        grid={trendData}
        years={years}
        selectedYear={selectedYear}
      />

      <TrendSection
        title="Paper 2 (Essay)"
        questions={ESSAY_QUESTIONS}
        grid={trendDataEssay}
        years={years}
        selectedYear={selectedYear}
      />

      <p className="flex items-start gap-2 text-xs text-slate-500">
        <AlertCircle size={15} className="shrink-0" />

        <span>
          Generated from DSE Pastpaper entries. Topic totals include
          all loaded years, including SP and PP—not only the selected year.
        </span>
      </p>
    </div>
  );
}