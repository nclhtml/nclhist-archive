import React, { useState, useEffect } from 'react';
import { Save, Calendar, Loader2, Link as LinkIcon, CheckCircle, Trash2, Copy } from 'lucide-react';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './main.jsx';

export default function Timetable() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  const [jsonInput, setJsonInput] = useState('');
  const [schedule, setSchedule] = useState([]);
  const [uniqueLabels, setUniqueLabels] = useState([]);
  
  const [availableClasses, setAvailableClasses] = useState([]);
  const [mappings, setMappings] = useState({});
  const [hasSavedTimetable, setHasSavedTimetable] = useState(false);

  const aiPrompt = `Please analyze this timetable image and convert it into a JSON array. Each lesson should be an object with 'day' (Mon, Tue, Wed, Thu, Fri), 'start' (HH:MM format, 24-hour), 'end' (HH:MM format), and 'label' (the exact text in the cell). Ignore breaks, lunch, assemblies, and empty cells. Only include actual lessons. Output ONLY the JSON array, with no markdown formatting or extra text. Example format: [{"day": "Mon", "start": "08:20", "end": "09:00", "label": "S6 HIST 003"}]`;

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Fetch classes to map to
        const classDocRef = doc(db, "settings", "classes");
        const classDocSnap = await getDoc(classDocRef);
        let loadedClasses = [];
        if (classDocSnap.exists()) {
          const rawList = classDocSnap.data().list || [];
          let classObjects = rawList.map(c => typeof c === 'string' ? { name: c, owner: 'clng@ktls.edu.hk', isArchived: false } : c);
          
          if (user?.email !== 'clng@ktls.edu.hk') {
            classObjects = classObjects.filter(c => c.owner === user?.email && !c.isArchived);
          } else {
            classObjects = classObjects.filter(c => !c.isArchived);
          }
          loadedClasses = classObjects.map(c => c.name.replace(/\u200B/g, ''));
          setAvailableClasses(loadedClasses);
        }

        // Fetch existing timetable for this admin
        if (user?.email) {
          const ttDocRef = doc(db, "admin_timetables", user.email);
          const ttDocSnap = await getDoc(ttDocRef);
          if (ttDocSnap.exists()) {
            const data = ttDocSnap.data();
            if (data.schedule && data.schedule.length > 0) {
              setSchedule(data.schedule);
              setMappings(data.mappings || {});
              setHasSavedTimetable(true);
            }
          }
        }
      } catch (error) {
        console.error("Error fetching timetable data:", error);
      }
      setIsLoading(false);
    };

    fetchData();
  }, [user]);

  const handleParseJson = () => {
    try {
      const parsed = JSON.parse(jsonInput);
      if (!Array.isArray(parsed)) throw new Error("JSON must be an array of lessons.");
      
      setSchedule(parsed);
      
      const labels = [...new Set(parsed.map(s => s.label))];
      setUniqueLabels(labels);
      
      // Auto-map Junior Forms (1A, 2B, 3C, etc.)
      const newMappings = { ...mappings };
      labels.forEach(label => {
        if (!newMappings[label]) {
          const match = label.match(/([1-3][A-Z])/);
          if (match) {
            const potentialClass = match[1];
            if (availableClasses.includes(potentialClass)) {
              newMappings[label] = potentialClass;
            }
          }
        }
      });
      setMappings(newMappings);
      setJsonInput('');
      setHasSavedTimetable(false); // It's parsed but not saved yet
      alert("Timetable parsed successfully! Please review the mappings below.");
    } catch (e) {
      alert("Invalid JSON format. Please ensure it matches the required structure.");
      console.error(e);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const ttDocRef = doc(db, "admin_timetables", user.email);
      await setDoc(ttDocRef, {
        schedule,
        mappings,
        updatedAt: new Date().toISOString()
      });
      setHasSavedTimetable(true);
      setUniqueLabels([]); // Hide mapping UI after saving
      alert("Timetable and mappings saved successfully!");
    } catch (e) {
      console.error("Error saving timetable:", e);
      alert("Failed to save timetable.");
    }
    setIsSaving(false);
  };

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete your saved timetable?")) return;
    setIsSaving(true);
    try {
      await deleteDoc(doc(db, "admin_timetables", user.email));
      setSchedule([]);
      setMappings({});
      setHasSavedTimetable(false);
      setUniqueLabels([]);
      alert("Timetable deleted successfully.");
    } catch (e) {
      console.error("Error deleting timetable:", e);
      alert("Failed to delete timetable.");
    }
    setIsSaving(false);
  };

  const copyPrompt = () => {
    navigator.clipboard.writeText(aiPrompt);
    alert("Prompt copied to clipboard!");
  };

  // Helper to render the timetable grid
  const renderTimetableGrid = () => {
    if (schedule.length === 0) return null;

    // Get unique time slots sorted
    const timeSlots = [...new Set(schedule.map(s => `${s.start}-${s.end}`))].sort();
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

    return (
      <div className="overflow-x-auto bg-white rounded-lg shadow-sm border border-gray-200 mt-6">
        <table className="w-full text-center border-collapse min-w-[600px]">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-3 border border-gray-200 text-gray-600 font-bold w-24">Time</th>
              {days.map(day => (
                <th key={day} className="p-3 border border-gray-200 text-gray-600 font-bold">{day}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {timeSlots.map(slot => {
              const [start, end] = slot.split('-');
              return (
                <tr key={slot}>
                  <td className="p-3 border border-gray-200 text-sm font-medium text-gray-500 bg-gray-50">
                    {start}<br/>|<br/>{end}
                  </td>
                  {days.map(day => {
                    const lesson = schedule.find(s => s.day === day && s.start === start && s.end === end);
                    return (
                      <td key={`${day}-${slot}`} className="p-3 border border-gray-200">
                        {lesson ? (
                          <div className="flex flex-col items-center justify-center h-full">
                            <span className="font-bold text-gray-800 text-sm">{lesson.label}</span>
                            {mappings[lesson.label] && (
                              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded mt-1">
                                Linked: {mappings[lesson.label]}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-blue-600 w-10 h-10" /></div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-6 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800 flex items-center">
          <Calendar className="w-8 h-8 mr-3 text-blue-600" />
          Timetable Integration
        </h1>
        {hasSavedTimetable && (
          <button
            onClick={handleDelete}
            disabled={isSaving}
            className="flex items-center px-4 py-2 bg-red-50 text-red-600 rounded-md font-bold hover:bg-red-100 border border-red-200 transition-colors"
          >
            <Trash2 className="w-4 h-4 mr-2" /> Delete Timetable
          </button>
        )}
      </div>

      {hasSavedTimetable ? (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg flex items-start">
            <CheckCircle className="w-5 h-5 text-blue-600 mr-3 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-bold text-blue-800">Timetable Active</h3>
              <p className="text-sm text-blue-700 mt-1">
                Your timetable is currently active. The system will automatically track your ongoing lessons and display quick shortcuts at the bottom of the screen when you are teaching a linked class.
              </p>
            </div>
          </div>
          {renderTimetableGrid()}
        </div>
      ) : (
        <>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-6">
            <h2 className="text-lg font-bold text-gray-800 mb-2">1. Generate JSON with AI</h2>
            <p className="text-sm text-gray-600 mb-4">
              Copy the prompt below and paste it into ChatGPT/Gemini along with a screenshot of your timetable.
            </p>
            <div className="bg-gray-100 p-3 rounded-md border border-gray-200 relative group mb-6">
              <p className="text-sm text-gray-700 font-mono whitespace-pre-wrap pr-10">{aiPrompt}</p>
              <button 
                onClick={copyPrompt}
                className="absolute top-3 right-3 p-2 bg-white rounded-md shadow-sm text-gray-500 hover:text-blue-600 border border-gray-200"
                title="Copy Prompt"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>

            <h2 className="text-lg font-bold text-gray-800 mb-2">2. Paste AI-Generated JSON</h2>
            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              className="w-full h-40 border border-gray-300 rounded-md p-3 font-mono text-sm focus:ring-2 focus:ring-blue-500 outline-none mb-3"
              placeholder='[{"day": "Mon", "start": "08:20", "end": "09:00", "label": "S6 HIST 003"}]'
            />
            <button
              onClick={handleParseJson}
              disabled={!jsonInput.trim()}
              className="bg-blue-600 text-white px-4 py-2 rounded-md font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Parse JSON
            </button>
          </div>

          {uniqueLabels.length > 0 && (
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
                <LinkIcon className="w-5 h-5 mr-2 text-blue-600" />
                3. Map Timetable Labels to Classes
              </h2>
              <p className="text-sm text-gray-600 mb-6">
                Junior forms are auto-mapped if possible. Please manually select the correct class for senior forms or unmapped items. 
                Only active classes created by you are shown.
              </p>

              <div className="space-y-4">
                {uniqueLabels.map(label => (
                  <div key={label} className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-md">
                    <span className="font-bold text-gray-700 w-1/2 truncate" title={label}>{label}</span>
                    <div className="w-1/2 flex items-center">
                      <select
                        value={mappings[label] || ''}
                        onChange={(e) => setMappings({ ...mappings, [label]: e.target.value })}
                        className="w-full border border-gray-300 rounded p-2 text-sm outline-none focus:border-blue-500"
                      >
                        <option value="">-- Do not link / Ignore --</option>
                        {availableClasses.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      {mappings[label] && <CheckCircle className="w-5 h-5 ml-3 text-green-500 flex-shrink-0" />}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-8 pt-6 border-t border-gray-200 flex justify-end">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="bg-green-600 text-white px-6 py-2 rounded-md font-bold hover:bg-green-700 flex items-center disabled:opacity-50 shadow-sm"
                >
                  {isSaving ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
                  Save Timetable & Mappings
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}