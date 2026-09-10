import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Save, CheckCircle, Eye, EyeOff, ArrowRight } from 'lucide-react';

// 💡 AI REFERENCE: DATA STRUCTURE
// Always separate static data (options, correct answers, drop zones) outside the component 
// to prevent unnecessary re-renders and keep the component clean.
const COUNTRIES = [
  '英國', '德國', '俄羅斯', '法國',
  '奧匈帝國', '意大利', '塞爾維亞', '鄂圖曼帝國'
];

const DROP_ZONES = [
  { id: 'uk', correct: '英國', top: '25%', left: '20%' },
  { id: 'germany', correct: '德國', top: '35%', left: '44%' },
  { id: 'russia', correct: '俄羅斯', top: '20%', left: '74%' },
  { id: 'france', correct: '法國', top: '53%', left: '28%' },
  { id: 'austria', correct: '奧匈帝國', top: '51%', left: '60%' },
  { id: 'italy', correct: '意大利', top: '75%', left: '48%' },
  { id: 'serbia', correct: '塞爾維亞', top: '70%', left: '64%' },
  { id: 'ottoman', correct: '鄂圖曼帝國', top: '80%', left: '84%' },
];

const SEQ_OPTIONS = [
  { id: 'A', text: '奧匈帝國向塞爾維亞宣戰；德、法、俄參戰。' },
  { id: 'B', text: '奧匈帝國向塞爾維亞發出最後通牒。' },
  { id: 'C', text: '奧地利王位繼承人斐迪南大公遭普林西普暗殺。' },
  { id: 'D', text: '塞爾維亞拒絕允許奧地利官員進入該國。' }
];

// 💡 AI REFERENCE: SEQUENCING FORMAT (CORRECT ANSWERS)
// For sequencing, keep a simple array of IDs representing the correct order.
const CORRECT_ORDER = ['C', 'B', 'D', 'A'];

// PART 3 DATA
const PART3_BASE = [
  { id: 'C', text: '奧地利王位繼承人斐迪南大公遭普林西普暗殺。' },
  { id: 'B', text: '奧匈帝國向塞爾維亞發出最後通牒。' },
  { id: 'D', text: '塞爾維亞拒絕允許奧地利官員進入該國。' },
  { id: 'A', text: '奧匈帝國向塞爾維亞宣戰；德、法、俄參戰。' }
];

const PART3_EXTRA_OPTIONS = [
  { id: 'E1', text: '奧匈帝國獲得了盟友德國的無條件支持（「空白支票」）' },
  { id: 'E2', text: '法國總統與總理訪問俄國並鼓勵其動員支持塞國' },
  { id: 'E3', text: '塞爾維亞獲得俄國的支持' },
  { id: 'E4', text: '德軍公然入侵比利時以攻擊法國，英國向德國宣戰。' }
];

// 繪製列與列之間的分支箭頭
function BranchingArrows({ leftCount, rightCount }) {
  const lines = [];
  for (let i = 0; i < leftCount; i++) {
    for (let j = 0; j < rightCount; j++) {
      const y1 = ((i + 0.5) / leftCount) * 100;
      const y2 = ((j + 0.5) / rightCount) * 100;
      lines.push(
        <line
          key={`${i}-${j}`}
          x1="0"
          y1={`${y1}%`}
          x2="100%"
          y2={`${y2}%`}
          stroke="#94a3b8"
          strokeWidth="2"
          markerEnd="url(#arrowhead-right)"
        />
      );
    }
  }
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ minWidth: '30px' }}>
      <defs>
        <marker id="arrowhead-right" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
        </marker>
      </defs>
      {lines}
    </svg>
  );
}

// 💡 AI REFERENCE: COMPONENT PROPS & THREE-PART FORMAT
// Future components MUST accept these exact props to interface with the ExerciseRunner:
// - savedData: The student's previously saved work from Firebase.
// - onSave: Function to trigger saving work to Firebase.
// - readOnly: Boolean indicating if the user is an admin viewing a student's work.
// - isAdmin: Boolean indicating if the current user is an admin.
// - currentPart: Number (1, 2, or 3) dictating which section of the exercise to display.
// - adminCommand: Object containing real-time commands from the admin panel.
export default function Practice2Combined({ savedData, onSave, readOnly, isAdmin, currentPart = 1, adminCommand }) {
  const partNum = Number(currentPart);

  // State
  const [mapPlacements, setMapPlacements] = useState({});
  const [seqPlacements, setSeqPlacements] = useState([null, null, null, null]);
  const [part3Steps, setPart3Steps] = useState([[['C']], [['B']], [['D']], [['A']]]);

  const [isSaving, setIsSaving] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  const [draggedPart3Item, setDraggedPart3Item] = useState(null);
  const [activeDropZone, setActiveDropZone] = useState(null);

  const mapRef = useRef(null);
  const effectiveReadOnly = readOnly || isLocked;

  // Reset locks and answers when switching parts
  useEffect(() => {
    setShowAnswers(false);
    setIsLocked(false);
  }, [currentPart]);

  // 💡 AI REFERENCE: RECEIVING COMMANDS FROM ADMIN & PROPER REACTION
  // This useEffect listens to `adminCommand`. 
  // CRITICAL: When receiving 'Check Answers', the component MUST call `handleSaveClick()` 
  // BEFORE setting `showAnswers(true)` and `isLocked(true)`. This ensures that if a student 
  // hasn't manually saved, their latest progress is automatically pushed to the database 
  // so the admin sees exactly what the student was doing at the moment of checking.
  useEffect(() => {
    if (adminCommand) {
      if (adminCommand.command === 'Check Answers') {
        handleSaveClick(); // Automatically save the student's current progress before checking
        setShowAnswers(true);
        setIsLocked(true);
      } else if (adminCommand.command === 'Save All') {
        handleSaveClick();
      } else if (adminCommand.command === 'Reset') {
        setShowAnswers(false);
        setIsLocked(false);
      }
    }
  }, [adminCommand]);

  // Load saved data
  useEffect(() => {
    if (savedData) {
      if (savedData.mapPlacements) setMapPlacements(savedData.mapPlacements);
      if (savedData.seqPlacements) setSeqPlacements(savedData.seqPlacements);
      if (savedData.part3Steps) {
        let loadedSteps = savedData.part3Steps;
        if (typeof loadedSteps === 'string') {
          try {
            loadedSteps = JSON.parse(loadedSteps);
          } catch (e) {
            console.error("Failed to parse part3Steps", e);
            loadedSteps = [[['C']], [['B']], [['D']], [['A']]];
          }
        }
        if (Array.isArray(loadedSteps) && loadedSteps.length > 0 && typeof loadedSteps[0][0] === 'string') {
          setPart3Steps(loadedSteps.map(col => col.map(item => [item])));
        } else if (Array.isArray(loadedSteps)) {
          setPart3Steps(loadedSteps);
        }
      }
    } else {
      setMapPlacements({});
      setSeqPlacements([null, null, null, null]);
      setPart3Steps([[['C']], [['B']], [['D']], [['A']]]);
    }
  }, [savedData]);

  const handleSaveClick = async () => {
    if (effectiveReadOnly) return;
    setIsSaving(true);
    if (onSave) {
      await onSave({
        mapPlacements,
        seqPlacements,
        part3Steps: JSON.stringify(part3Steps)
      });
    }
    setIsSaving(false);
  };

  // --- PART 1 & 2 Drag Handlers (Framer Motion) ---
  const handleMapDragEnd = (e, info, country) => {
    if (effectiveReadOnly) return;
    const dropZones = document.querySelectorAll('.map-drop-zone');
    let droppedZoneId = null;
    const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;

    dropZones.forEach((zone) => {
      const rect = zone.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        droppedZoneId = zone.dataset.zoneId;
      }
    });

    setMapPlacements((prev) => {
      const newPlacements = { ...prev };
      Object.keys(newPlacements).forEach((key) => {
        if (newPlacements[key] === country) delete newPlacements[key];
      });
      if (droppedZoneId) newPlacements[droppedZoneId] = country;
      return newPlacements;
    });
  };

  // 💡 AI REFERENCE: SEQUENCING DRAG LOGIC
  // Uses Framer Motion drag. Calculates drop based on bounding client rects.
  // Swaps items if dropping onto an already occupied zone.
  const handleSeqDragEnd = (e, info, optionId) => {
    if (effectiveReadOnly) return;
    const dropZones = document.querySelectorAll('.seq-drop-zone');
    let droppedIndex = null;
    const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
    const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;

    dropZones.forEach((zone) => {
      const rect = zone.getBoundingClientRect();
      if (clientX >= rect.left - 20 && clientX <= rect.right + 20 && clientY >= rect.top - 20 && clientY <= rect.bottom + 20) {
        droppedIndex = parseInt(zone.dataset.index, 10);
      }
    });

    setSeqPlacements((prev) => {
      const newPlacements = [...prev];
      const oldIndex = newPlacements.indexOf(optionId);
      if (oldIndex !== -1) newPlacements[oldIndex] = null;
      if (droppedIndex !== null) {
        if (newPlacements[droppedIndex] !== null && oldIndex !== -1) {
          newPlacements[oldIndex] = newPlacements[droppedIndex];
        }
        newPlacements[droppedIndex] = optionId;
      }
      return newPlacements;
    });
  };

  // --- PART 3: HTML5 Drag & Drop Handlers ---
  const handlePart3DragStart = (e, optionId) => {
    if (effectiveReadOnly) {
      e.preventDefault();
      return;
    }
    setDraggedPart3Item(optionId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', optionId);
  };

  const handlePart3DragOver = (e, zoneId) => {
    e.preventDefault();
    e.stopPropagation();
    if (effectiveReadOnly || !draggedPart3Item) return;
    e.dataTransfer.dropEffect = 'move';
    if (activeDropZone !== zoneId) {
      setActiveDropZone(zoneId);
    }
  };

  const handlePart3DragLeave = (e, zoneId) => {
    e.preventDefault();
    e.stopPropagation();
    if (activeDropZone === zoneId) {
      setActiveDropZone(null);
    }
  };

  const handlePart3Drop = (e, targetType, targetData) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveDropZone(null);
    if (effectiveReadOnly || !draggedPart3Item) return;

    const optionId = draggedPart3Item;
    setDraggedPart3Item(null);

    setPart3Steps((prev) => {
      let newSteps = prev.map(col => col.map(branch => [...branch]));

      for (let c = 0; c < newSteps.length; c++) {
        for (let b = 0; b < newSteps[c].length; b++) {
          newSteps[c][b] = newSteps[c][b].filter(id => id !== optionId);
        }
        newSteps[c] = newSteps[c].filter(branch => branch.length > 0);
      }
      newSteps = newSteps.filter(col => col.length > 0);

      if (targetType === 'append') {
        if (newSteps[targetData.col] && newSteps[targetData.col][targetData.branch]) {
          newSteps[targetData.col][targetData.branch].push(optionId);
        }
      } else if (targetType === 'parallel') {
        if (newSteps[targetData.col]) {
          newSteps[targetData.col].push([optionId]);
        }
      } else if (targetType === 'insert') {
        newSteps.splice(targetData.index, 0, [[optionId]]);
      }

      return newSteps;
    });
  };

  const availableCountries = COUNTRIES.filter(c => !Object.values(mapPlacements).includes(c));
  const availableSeqOptions = SEQ_OPTIONS.filter(opt => !seqPlacements.includes(opt.id));
  const placedPart3Options = part3Steps.flat(3);
  const availablePart3Options = PART3_EXTRA_OPTIONS.filter(opt => !placedPart3Options.includes(opt.id));

  return (
    <div className="w-full max-w-7xl mx-auto bg-slate-50 p-4 md:p-6 rounded-lg font-sans flex flex-col gap-8">

      {/* Global Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200 sticky top-0 z-20">
        <div>
          <h2 className="text-xl font-bold text-slate-800">第一次世界大戰：綜合練習</h2>
          <p className="text-slate-600 text-sm">
            {partNum === 1 && '第一部分：地圖識別'}
            {partNum === 2 && '第二部分：事件排序'}
            {partNum === 3 && '第三部分：事件關聯與分支'}
          </p>
          {isLocked && <p className="text-red-500 text-xs font-bold mt-1">已鎖定：正在顯示答案</p>}
        </div>

        <div className="flex gap-3 w-full md:w-auto">
          {isAdmin && (
            <button
              onClick={() => { setShowAnswers(!showAnswers); setIsLocked(!isLocked); }}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-amber-100 text-amber-700 px-4 py-2 rounded-lg font-bold hover:bg-amber-200 transition-colors"
            >
              {showAnswers ? <EyeOff size={18} /> : <Eye size={18} />}
              {showAnswers ? '解鎖並隱藏答案' : '鎖定並檢查答案'}
            </button>
          )}
          {!effectiveReadOnly && (
            <button
              onClick={handleSaveClick}
              disabled={isSaving}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Save size={18} />
              {isSaving ? '儲存中...' : '儲存作業'}
            </button>
          )}
        </div>
      </div>

      {/* 💡 AI REFERENCE: THREE-PART FORMAT RENDERING */}
      {/* Conditionally render sections based on `partNum`. Wrap each in an animated section. */}
      
      {/* ================= PART 1: MAP ================= */}
      {partNum === 1 && (
        <section className="animate-in fade-in duration-500">
          <h3 className="text-lg font-bold text-slate-800 mb-2">第一部分：地圖識別</h3>
          <p className="text-slate-600 text-sm mb-4">將國家名稱拖放到地圖上正確的方塊中。</p>
          {/* Map implementation omitted for brevity in comments, but follows standard drag/drop */}
          <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 mb-6 min-h-[80px] flex flex-wrap gap-3 items-center">
            <span className="text-sm font-bold text-slate-400 mr-2">可選項：</span>
            {availableCountries.map((country) => (
              <motion.div
                key={country}
                drag={!effectiveReadOnly}
                dragSnapToOrigin
                onDragEnd={(e, info) => handleMapDragEnd(e, info, country)}
                whileDrag={{ scale: 1.1, zIndex: 50, cursor: 'grabbing' }}
                className={`px-4 py-2 bg-white border-2 border-slate-300 rounded shadow-sm font-bold text-slate-700 ${!effectiveReadOnly ? 'cursor-grab' : 'cursor-not-allowed opacity-70'}`}
              >
                {country}
              </motion.div>
            ))}
          </div>
          <div className="relative w-full max-w-4xl mx-auto border-4 border-slate-200 rounded-xl overflow-hidden bg-blue-50" ref={mapRef}>
            <img src="https://i.imgur.com/TBqjLvZ.png" alt="Europe Map WWI" className="w-full h-auto pointer-events-none select-none" />
            {DROP_ZONES.map((zone) => {
              const placedCountry = mapPlacements[zone.id];
              const isCorrect = placedCountry === zone.correct;
              return (
                <div
                  key={zone.id}
                  data-zone-id={zone.id}
                  className={`map-drop-zone absolute w-24 h-10 -ml-12 -mt-5 border-2 border-dashed flex items-center justify-center bg-white/80 backdrop-blur-sm transition-colors
                    ${placedCountry && !showAnswers ? 'border-blue-500 shadow-md' : 'border-slate-400'}
                    ${showAnswers && isCorrect ? '!border-green-500 !bg-green-50' : ''}
                    ${showAnswers && !isCorrect ? '!border-red-500 !bg-red-50' : ''}
                  `}
                  style={{ top: zone.top, left: zone.left }}
                >
                  {placedCountry && (
                    <motion.div
                      drag={!effectiveReadOnly}
                      dragSnapToOrigin
                      onDragEnd={(e, info) => handleMapDragEnd(e, info, placedCountry)}
                      whileDrag={{ scale: 1.1, zIndex: 50 }}
                      className={`w-full h-full flex items-center justify-center font-bold text-sm ${!effectiveReadOnly ? 'cursor-grab' : 'cursor-default'}
                        ${showAnswers && isCorrect ? 'text-green-700' : ''}
                        ${showAnswers && !isCorrect ? 'text-red-700' : 'text-slate-800'}
                      `}
                    >
                      {placedCountry}
                    </motion.div>
                  )}
                  {showAnswers && !isCorrect && (
                    <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-bold px-2 py-1 rounded bg-slate-800 text-white z-50 shadow-md">
                      正確: {zone.correct}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ================= PART 2: SEQUENCE ================= */}
      {/* 💡 AI REFERENCE: SEQUENCING UI FORMAT */}
      {/* Notice how it maps over a fixed array [0, 1, 2, 3] to create the drop zones. */}
      {/* It dynamically checks `placedId === CORRECT_ORDER[index]` to apply green/red styling when `showAnswers` is true. */}
      {/* If `showAnswers` is true and the answer is wrong, it displays the correct answer block below the zone. */}
      {partNum === 2 && (
        <section className="animate-in fade-in duration-500">
          <h3 className="text-lg font-bold text-slate-800 mb-2">第二部分：事件排序</h3>
          <p className="text-slate-600 text-sm mb-4">將事件拖放到正確的先後順序中。</p>
          <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 mb-8 min-h-[120px] flex flex-col gap-3">
            <span className="text-sm font-bold text-slate-400">可選項：</span>
            <div className="flex flex-col gap-2">
              {availableSeqOptions.map((opt) => (
                <motion.div
                  key={opt.id}
                  drag={!effectiveReadOnly}
                  dragSnapToOrigin
                  onDragEnd={(e, info) => handleSeqDragEnd(e, info, opt.id)}
                  whileDrag={{ scale: 1.02, zIndex: 50, cursor: 'grabbing' }}
                  className={`p-3 bg-white border-2 border-slate-300 rounded shadow-sm font-bold text-slate-700 ${!effectiveReadOnly ? 'cursor-grab' : 'cursor-not-allowed opacity-70'}`}
                >
                  {opt.id}. {opt.text}
                </motion.div>
              ))}
            </div>
          </div>
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 w-full pb-12">
            {[0, 1, 2, 3].map((index) => {
              const placedId = seqPlacements[index];
              const placedOpt = SEQ_OPTIONS.find(o => o.id === placedId);
              const isCorrect = placedId === CORRECT_ORDER[index];
              const correctOpt = SEQ_OPTIONS.find(o => o.id === CORRECT_ORDER[index]);

              return (
                <React.Fragment key={index}>
                  <div
                    data-index={index}
                    className={`seq-drop-zone relative w-full md:w-1/4 h-32 border-2 border-dashed rounded-lg flex items-center justify-center bg-white transition-colors p-2
                      ${placedId && !showAnswers ? 'border-blue-500 shadow-md' : 'border-slate-400'}
                      ${showAnswers && isCorrect ? '!border-green-500 !bg-green-50' : ''}
                      ${showAnswers && !isCorrect ? '!border-red-500 !bg-red-50' : ''}
                    `}
                  >
                    <div className="absolute top-2 left-2 text-xs font-bold text-slate-400">步驟 {index + 1}</div>
                    {placedOpt && (
                      <motion.div
                        drag={!effectiveReadOnly}
                        dragSnapToOrigin
                        onDragEnd={(e, info) => handleSeqDragEnd(e, info, placedId)}
                        whileDrag={{ scale: 1.05, zIndex: 50 }}
                        className={`w-full h-full mt-4 flex items-center justify-center text-center font-bold text-sm p-1 ${!effectiveReadOnly ? 'cursor-grab' : 'cursor-default'}
                          ${showAnswers && isCorrect ? 'text-green-700' : ''}
                          ${showAnswers && !isCorrect ? 'text-red-700' : 'text-slate-800'}
                        `}
                      >
                        {placedOpt.id}. {placedOpt.text}
                      </motion.div>
                    )}
                    {/* Show correct answer block if wrong or empty while checking answers */}
                    {showAnswers && !isCorrect && (
                      <div className="absolute -bottom-14 left-0 w-full text-xs font-bold p-2 rounded bg-slate-800 text-white z-50 text-center shadow-md">
                        正確: {correctOpt.id}. {correctOpt.text}
                      </div>
                    )}
                  </div>
                  {index < 3 && <div className="hidden md:flex text-slate-400"><ArrowRight size={24} /></div>}
                </React.Fragment>
              );
            })}
          </div>
        </section>
      )}

      {/* ================= PART 3: BRANCHING ================= */}
      {partNum === 3 && (
        <section className="animate-in fade-in duration-500">
          <h3 className="text-lg font-bold text-slate-800 mb-2">第三部分：事件關聯與分支</h3>
          <p className="text-slate-600 text-sm mb-4">
            將額外的事件拖放到主軸事件上，建立歷史事件的分支與關聯。<br />
            • 拖曳至<b>現有事件上方</b>：產生平行分支。<br />
            • 拖曳至<b>分支右側的加號</b>：在該分支中接續新事件。<br />
            • 拖曳至<b>箭頭上方的加號</b>：在序列中插入新步驟。
          </p>

          {/* 可選項區域 */}
          <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 mb-8 min-h-[120px] flex flex-col gap-3">
            <span className="text-sm font-bold text-slate-400">可選項：</span>
            <div className="flex flex-col gap-2">
              {availablePart3Options.map((opt) => (
                <div
                  key={opt.id}
                  draggable={!effectiveReadOnly}
                  onDragStart={(e) => handlePart3DragStart(e, opt.id)}
                  className={`p-3 bg-blue-50 border-2 border-blue-300 rounded shadow-sm font-bold text-blue-900 transition-transform hover:scale-[1.01] ${!effectiveReadOnly ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed opacity-70'}`}
                >
                  {opt.text}
                </div>
              ))}
              {availablePart3Options.length === 0 && (
                <span className="text-green-600 text-sm font-bold flex items-center gap-1">
                  <CheckCircle size={16} /> 已全部放置！
                </span>
              )}
            </div>
          </div>

          {/* 分支畫布 (Single Horizontal Scroll) */}
          <div className="flex flex-row items-stretch justify-start gap-2 w-full bg-white rounded-xl border-2 border-slate-200 shadow-inner p-4 overflow-x-auto min-h-[300px]">

            {/* 開頭插入區 */}
            <div className="flex flex-col items-center justify-center relative flex-shrink-0 w-16 gap-2 z-0">
              <div
                className={`w-12 h-10 flex items-center justify-center rounded-lg border-2 border-dashed transition-all cursor-pointer z-10
                  ${activeDropZone === `insert-0` ? 'bg-blue-100 border-blue-500 scale-110' : 'border-blue-300 hover:border-blue-400 hover:bg-blue-50'}
                `}
                onDragOver={(e) => handlePart3DragOver(e, `insert-0`)}
                onDragLeave={(e) => handlePart3DragLeave(e, `insert-0`)}
                onDrop={(e) => handlePart3Drop(e, 'insert', { index: 0 })}
              >
                <span className={`font-bold text-xl ${activeDropZone === `insert-0` ? 'text-blue-600' : 'text-blue-400'}`}>+</span>
              </div>
            </div>

            {/* 所有的欄位 (Columns) */}
            {part3Steps.map((colBranches, globalIndex) => (
              <React.Fragment key={`col-${globalIndex}`}>
                <div className="flex flex-col justify-around gap-6 min-w-[180px] w-max flex-shrink-0 p-2 relative z-10 py-4">
                  {colBranches.map((branchItems, branchIndex) => (
                    <div key={`branch-${branchIndex}`} className="flex flex-row items-center w-max bg-white rounded-xl shadow-sm border border-slate-100 p-2">

                      {/* 分支內的項目 */}
                      {branchItems.map((itemId, itemIndex) => {
                        const isBase = PART3_BASE.find(o => o.id === itemId);
                        const isExtra = PART3_EXTRA_OPTIONS.find(o => o.id === itemId);
                        const opt = isBase || isExtra;
                        if (!opt) return null;

                        const zoneId = `parallel-${globalIndex}-${branchIndex}-${itemIndex}`;

                        return (
                          <React.Fragment key={itemId}>
                            <div
                              draggable={!effectiveReadOnly && !!isExtra}
                              onDragStart={(e) => isExtra && handlePart3DragStart(e, itemId)}
                              onDragOver={(e) => handlePart3DragOver(e, zoneId)}
                              onDragLeave={(e) => handlePart3DragLeave(e, zoneId)}
                              onDrop={(e) => handlePart3Drop(e, 'parallel', { col: globalIndex })}
                              className={`w-32 md:w-40 p-3 rounded-lg shadow-sm font-bold text-xs md:text-sm text-center flex items-center justify-center aspect-square flex-shrink-0 transition-all z-20
                                ${isBase ? 'bg-slate-50 border-2 border-slate-300 text-slate-800' : 'bg-blue-50 border-2 border-blue-400 text-blue-900 cursor-grab'}
                                ${activeDropZone === zoneId ? 'ring-4 ring-blue-400 scale-105 bg-blue-100' : ''}
                              `}
                            >
                              {isBase ? `${opt.id}. ` : ''}{opt.text}
                            </div>

                            {/* 項目間的箭頭 - Only appears if there's another item following, OR if the append box is visible */}
                            {(itemIndex < branchItems.length - 1 || colBranches.length > 1) && (
                              <div className="text-[#94a3b8] flex-shrink-0 mx-1">
                                <ArrowRight size={16} />
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })}

                      {/* 分支尾端的接續區 (Append) - 只有在使用者建立平行分支後才會顯示 */}
                      {colBranches.length > 1 && (
                        <div
                          className={`w-10 h-16 flex-shrink-0 flex items-center justify-center rounded-lg border-2 border-dashed transition-all cursor-pointer z-30
                            ${activeDropZone === `append-${globalIndex}-${branchIndex}` ? 'bg-blue-100 border-blue-500 scale-110' : 'border-blue-200 hover:border-blue-400 hover:bg-blue-50'}
                          `}
                          onDragOver={(e) => handlePart3DragOver(e, `append-${globalIndex}-${branchIndex}`)}
                          onDragLeave={(e) => handlePart3DragLeave(e, `append-${globalIndex}-${branchIndex}`)}
                          onDrop={(e) => handlePart3Drop(e, 'append', { col: globalIndex, branch: branchIndex })}
                        >
                          <span className={`font-bold text-xl ${activeDropZone === `append-${globalIndex}-${branchIndex}` ? 'text-blue-600' : 'text-blue-400'}`}>+</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* 欄與欄之間的插入區 (Insert Box Above Arrow) */}
                <div className="flex flex-col items-center justify-center relative flex-shrink-0 w-16 z-0">
                  <div
                    className={`w-12 h-10 flex items-center justify-center rounded-lg border-2 border-dashed transition-all cursor-pointer z-10
                      ${activeDropZone === `insert-${globalIndex + 1}` ? 'bg-blue-100 border-blue-500 scale-110' : 'border-blue-300 hover:border-blue-400 hover:bg-blue-50'}
                    `}
                    onDragOver={(e) => handlePart3DragOver(e, `insert-${globalIndex + 1}`)}
                    onDragLeave={(e) => handlePart3DragLeave(e, `insert-${globalIndex + 1}`)}
                    onDrop={(e) => handlePart3Drop(e, 'insert', { index: globalIndex + 1 })}
                  >
                    <span className={`font-bold text-xl ${activeDropZone === `insert-${globalIndex + 1}` ? 'text-blue-600' : 'text-blue-400'}`}>+</span>
                  </div>

                  {globalIndex < part3Steps.length - 1 && (
                    <div className="absolute inset-0 w-full pointer-events-none z-0 py-4">
                      <BranchingArrows leftCount={colBranches.length} rightCount={part3Steps[globalIndex + 1].length} />
                    </div>
                  )}
                </div>
              </React.Fragment>
            ))}
          </div>
        </section>
      )}

    </div>
  );
}