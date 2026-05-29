import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

// --- CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyD2ZnF0VioN7pDYS6q25whLzc-BQi8EyQo",
  authDomain: "nclhist.firebaseapp.com",
  projectId: "nclhist",
  storageBucket: "nclhist.firebasestorage.app",
  messagingSenderId: "513745613340",
  appId: "1:513745613340:web:159ab2c6f583a1160225d9",
  measurementId: "G-0SMPXMH9Y1"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const ensureArray = (data) => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'string') return [data];
  return [];
};

export default function DseTrend() {
  const [loading, setLoading] = useState(true);
  const [trendData, setTrendData] = useState({});
  const [trendDataEssay, setTrendDataEssay] = useState({}); // <-- ADD THIS
  const [years, setYears] = useState([]);
  const questions = ["Q1", "Q2", "Q3", "Q4"];
  const essayQuestions = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7"]; // <-- ADD THIS

  // --- COLOR LOGIC ---
  const getTopicColor = (topic) => {
    const t = topic.toLowerCase();

    // 1. World Wars & Cold War
    if (t.includes('first world war') || t.includes('ww1')) return 'bg-red-100 text-red-800 border-red-200';
    if (t.includes('second world war') || t.includes('ww2')) return 'bg-orange-100 text-orange-800 border-orange-200';
    if (t.includes('cold war')) return 'bg-blue-100 text-blue-800 border-blue-200';

    // 2. Hong Kong (PRIORITIZED over China)
    if (t.includes('hong kong') || t.includes('hk')) return 'bg-purple-100 text-purple-800 border-purple-200';

    // 3. China & Communist Revolution (Only triggers if "Hong Kong" wasn't found)
    if (t.includes('china') || t.includes('communist revolution')) return 'bg-yellow-100 text-yellow-800 border-yellow-200';

    // 4. Elective Topics
    if (t.includes('elective')) return 'bg-white text-slate-700 border-slate-300';

    // 5. Others
    if (t.includes('japan')) return 'bg-pink-100 text-pink-800 border-pink-200';
    if (t.includes('international') || t.includes('cooperation')) return 'bg-teal-100 text-teal-800 border-teal-200';

    // Default
    return 'bg-slate-100 text-slate-600 border-slate-200';
  };

  // --- DATA FETCHING ---
  useEffect(() => {
    const fetchData = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "archives"));
        const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const filtered = data.filter(item => item.origin === "DSE Pastpaper");

        const gridDBQ = {};
        const gridEssay = {};
        const foundYears = new Set(["SP", "PP"]);

        filtered.forEach(item => {
          const year = String(item.year);
          foundYears.add(year);

          if (!gridDBQ[year]) gridDBQ[year] = {};
          if (!gridEssay[year]) gridEssay[year] = {};

          if (item.paperType === "Paper 1 (DBQ)") {
            let qNum = null;
            if (item.title.includes("Q1")) qNum = "Q1";
            else if (item.title.includes("Q2")) qNum = "Q2";
            else if (item.title.includes("Q3")) qNum = "Q3";
            else if (item.title.includes("Q4")) qNum = "Q4";

            if (qNum) {
              gridDBQ[year][qNum] = ensureArray(item.topic);
            }
          } else if (item.paperType === "Paper 2 (Essay)") {
            // Essay topics are stored in the subQuestions
            (item.subQuestions || []).forEach(sq => {
              const qNum = "Q" + sq.label; // e.g., "Q1", "Q2"
              if (essayQuestions.includes(qNum)) {
                gridEssay[year][qNum] = ensureArray(sq.topic);
              }
            });
          }
        });

        const sortedYears = Array.from(foundYears).sort((a, b) => {
          if (a === "SP") return -1;
          if (b === "SP") return 1;
          if (a === "PP") return -1;
          if (b === "PP") return 1;
          return parseInt(a) - parseInt(b);
        });

        setYears(sortedYears);
        setTrendData(gridDBQ);
        setTrendDataEssay(gridEssay);
      } catch (error) {
        console.error("Error fetching trend data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // --- STATS CALCULATION ---
  const { statsDBQ, statsEssay } = useMemo(() => {
    const calculateCounts = (dataObj) => {
      const counts = {
        "First World War": 0,
        "Second World War": 0,
        "Cold War": 0,
        "China": 0,
        "Hong Kong": 0,
        "Japan": 0,
        "Intl. Cooperation": 0
      };

      Object.values(dataObj).forEach(yearData => {
        Object.values(yearData).forEach(topics => {
          const categoriesFoundInThisBox = new Set();

          topics.forEach(rawTopic => {
            const t = rawTopic.toLowerCase();
            if (t.includes('first world war') || t.includes('ww1')) categoriesFoundInThisBox.add("First World War");
            else if (t.includes('second world war') || t.includes('ww2')) categoriesFoundInThisBox.add("Second World War");
            else if (t.includes('cold war')) categoriesFoundInThisBox.add("Cold War");
            else if (t.includes('hong kong') || t.includes('hk')) categoriesFoundInThisBox.add("Hong Kong");
            else if (t.includes('china') || t.includes('communist revolution')) categoriesFoundInThisBox.add("China");
            else if (t.includes('japan')) categoriesFoundInThisBox.add("Japan");
            else if (t.includes('international') || t.includes('cooperation')) categoriesFoundInThisBox.add("Intl. Cooperation");
          });

          categoriesFoundInThisBox.forEach(category => {
            if (counts[category] !== undefined) counts[category]++;
          });
        });
      });
      return counts;
    };

    return {
      statsDBQ: calculateCounts(trendData),
      statsEssay: calculateCounts(trendDataEssay)
    };
  }, [trendData, trendDataEssay]);

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-600" size={40} />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-[1600px] mx-auto">
      {/* DBQ Table Container */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
          Paper 1 (Data-Based Questions)
        </h2>

        {/* DBQ Stats Panel */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-4">
          {Object.entries(statsDBQ).map(([label, count]) => {
            const colorClass = getTopicColor(label);
            return (
              <div key={`dbq-stat-${label}`} className={`p-4 rounded-xl border ${colorClass}`}>
                <div className="text-3xl font-bold mb-1">{count}</div>
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-70 leading-tight">{label}</div>
              </div>
            );
          })}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-bold sticky left-0 bg-slate-50 z-10 border-r border-slate-200 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.1)]">
                  Question
                </th>
                {years.map(year => (
                  <th key={`dbq-th-${year}`} className="px-4 py-4 font-bold min-w-[160px] text-center border-r border-slate-100 last:border-0">
                    {year}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {questions.map((q) => (
                <tr key={`dbq-${q}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                  <td className="px-6 py-4 font-bold text-slate-800 bg-slate-50 sticky left-0 border-r border-slate-200 z-10 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.1)]">
                    {q}
                  </td>
                  {years.map(year => {
                    const topics = trendData[year]?.[q] || [];
                    return (
                      <td key={`dbq-${year}-${q}`} className="px-4 py-4 align-top border-r border-slate-50 last:border-0">
                        {topics.length > 0 ? (
                          <div className="flex flex-wrap gap-2 justify-center">
                            {topics.map((t, i) => (
                              <span key={i} className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-bold border ${getTopicColor(t)}`}>
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center text-slate-200 text-xs">-</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Essay Table Container */}
      <div className="mb-8">
        <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
          Paper 2 (Essay)
        </h2>

        {/* Essay Stats Panel */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-4">
          {Object.entries(statsEssay).map(([label, count]) => {
            const colorClass = getTopicColor(label);
            return (
              <div key={`essay-stat-${label}`} className={`p-4 rounded-xl border ${colorClass}`}>
                <div className="text-3xl font-bold mb-1">{count}</div>
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-70 leading-tight">{label}</div>
              </div>
            );
          })}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 font-bold sticky left-0 bg-slate-50 z-10 border-r border-slate-200 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.1)]">
                  Question
                </th>
                {years.map(year => (
                  <th key={`essay-th-${year}`} className="px-4 py-4 font-bold min-w-[160px] text-center border-r border-slate-100 last:border-0">
                    {year}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {essayQuestions.map((q) => (
                <tr key={`essay-${q}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                  <td className="px-6 py-4 font-bold text-slate-800 bg-slate-50 sticky left-0 border-r border-slate-200 z-10 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.1)]">
                    {q}
                  </td>
                  {years.map(year => {
                    const topics = trendDataEssay[year]?.[q] || [];
                    return (
                      <td key={`essay-${year}-${q}`} className="px-4 py-4 align-top border-r border-slate-50 last:border-0">
                        {topics.length > 0 ? (
                          <div className="flex flex-wrap gap-2 justify-center">
                            {topics.map((t, i) => (
                              <span key={i} className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-bold border ${getTopicColor(t)}`}>
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center text-slate-200 text-xs">-</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 text-xs text-slate-400 flex items-center gap-2">
        <AlertCircle size={14} />
        <span>Data is automatically generated from "DSE Pastpaper" entries.</span>
      </div>
    </div>
  );
}