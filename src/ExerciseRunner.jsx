import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, collection, getDocs, setDoc, onSnapshot, deleteField } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './main';
import { ArrowLeft, Loader2, AlertCircle, Users, Save, CheckSquare, FastForward, Rewind, User, RotateCcw } from 'lucide-react';

import DocumentNotes from './Practice1.jsx';
import MapExercise from './Practice2.jsx';

const COMPONENT_REGISTRY = {
  'DocumentNotes': DocumentNotes,
  'MapExercise': MapExercise,
};

export default function ExerciseRunner() {
  const { exerciseId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [exerciseData, setExerciseData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [currentPart, setCurrentPart] = useState(1);
  const [adminCommand, setAdminCommand] = useState(null);

  // Admin specific state
  const [studentsList, setStudentsList] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentWork, setStudentWork] = useState(null);
  const [adminOwnWork, setAdminOwnWork] = useState(null);

  // 1. The Listener for Admin Commands & Persistent Current Part
  useEffect(() => {
    if (!exerciseId) return;

    const sessionRef = doc(db, 'sessions', exerciseId);

    const unsubscribe = onSnapshot(sessionRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();

        // Sync current part for everyone
        if (data.currentPart) {
          setCurrentPart(data.currentPart);
        }

        if (data.timestamp && Date.now() - data.timestamp < 5000) {
          setAdminCommand({ command: data.command, timestamp: data.timestamp });
        }
      }
    });

    return () => unsubscribe();
  }, [exerciseId]);


  useEffect(() => {
    const fetchData = async () => {
      try {
        const docRef = doc(db, 'exercises', exerciseId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) throw new Error("Exercise not found");

        const exData = docSnap.data();
        setExerciseData(exData);

        const myProgressRef = doc(db, 'user_progress', user.email);
        const myProgressSnap = await getDoc(myProgressRef);
        const myProgress = myProgressSnap.exists() ? myProgressSnap.data()[exerciseId] : null;

        if (user?.isAdmin) {
          setAdminOwnWork(myProgress);
          setStudentWork(myProgress);

          const [studentsSnap, rolesSnap, progressSnap] = await Promise.all([
            getDocs(collection(db, 'students')),
            getDocs(collection(db, 'user_roles')),
            getDocs(collection(db, 'user_progress'))
          ]);

          const studentsData = studentsSnap.docs.map(d => ({ email: (d.data().email || d.id).toLowerCase(), ...d.data() }));
          const rolesData = rolesSnap.docs.map(d => ({ email: d.id.toLowerCase(), role: d.data().role }));

          const allUsers = [];
          rolesData.forEach(r => {
            const studentMatch = studentsData.find(s => s.email === r.email);
            allUsers.push({
              email: r.email,
              name: studentMatch?.englishName || r.email.split('@')[0],
              className: studentMatch?.className || '',
              role: r.role
            });
          });
          studentsData.forEach(s => {
            if (!allUsers.find(u => u.email === s.email)) {
              allUsers.push({
                email: s.email,
                name: s.englishName || s.email.split('@')[0],
                className: s.className || '',
                role: s.role || ''
              });
            }
          });

          const groups = (exData.assignedGroups || []).map(g => String(g).toLowerCase().trim());
          const targetStudents = allUsers.filter(u => {
            if (groups.includes('all')) return true;
            const uClass = String(u.className).toLowerCase().trim();
            const uRole = String(u.role).toLowerCase().trim();
            return groups.includes(uClass) || groups.includes(uRole);
          });

          const progressMap = {};
          progressSnap.forEach(doc => {
            if (doc.data()[exerciseId]) {
              progressMap[doc.id.toLowerCase()] = doc.data()[exerciseId];
            }
          });

          const finalStudentsList = targetStudents.map(s => ({
            ...s,
            progress: progressMap[s.email] || null,
            status: progressMap[s.email] ? 'Attempted' : 'Not Started'
          }));

          setStudentsList(finalStudentsList);
        } else {
          setStudentWork(myProgress);
        }

        setLoading(false);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };
    fetchData();
  }, [exerciseId, user]);

  const handleSelectStudent = (student) => {
    setSelectedStudent(student);
    setStudentWork(student.progress);
  };

  const handleSelectMyView = () => {
    setSelectedStudent(null);
    setStudentWork(adminOwnWork);
  };

  const handleSaveWork = async (dataToSave) => {
    try {
      const targetEmail = selectedStudent ? selectedStudent.email : user.email;
      const progressRef = doc(db, 'user_progress', targetEmail);
      await setDoc(progressRef, { [exerciseId]: dataToSave, updatedAt: new Date().toISOString() }, { merge: true });

      if (!selectedStudent && user.isAdmin) {
        setAdminOwnWork(dataToSave);
      }

      if (!user.isAdmin || !selectedStudent) {
        alert("Progress saved successfully!");
      }
    } catch (err) {
      alert("Error saving progress: " + err.message);
    }
  };

  const handleAdminAction = async (action) => {
    try {
      const sessionRef = doc(db, 'sessions', exerciseId);
      
      let newPart = currentPart;
      if (action === 'Next Part') newPart = Math.min(currentPart + 1, 3);
      if (action === 'Previous Part') newPart = Math.max(currentPart - 1, 1);

      await setDoc(sessionRef, {
        command: action,
        currentPart: newPart,
        timestamp: Date.now()
      }, { merge: true });

    } catch (error) {
      alert("Error sending command: " + error.message);
    }
  };

  const handleResetSession = async () => {
    if (!window.confirm("Are you sure you want to reset the session and DELETE ALL student records for this exercise? This action cannot be undone.")) return;
    
    try {
      // 1. Reset session document
      const sessionRef = doc(db, 'sessions', exerciseId);
      await setDoc(sessionRef, {
        command: 'Reset',
        currentPart: 1,
        timestamp: Date.now()
      });

      // 2. Delete student records from user_progress
      const promises = studentsList.map(student => {
        const progressRef = doc(db, 'user_progress', student.email);
        return setDoc(progressRef, { [exerciseId]: deleteField() }, { merge: true });
      });
      
      // Also delete admin's own work
      const adminProgressRef = doc(db, 'user_progress', user.email);
      promises.push(setDoc(adminProgressRef, { [exerciseId]: deleteField() }, { merge: true }));

      await Promise.all(promises);
      
      alert("Session reset and all records deleted.");
      window.location.reload(); // Reload to clear all local states
    } catch (err) {
      alert("Error resetting session: " + err.message);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" size={40} /></div>;

  if (error) return (
    <div className="p-8 text-center">
      <AlertCircle className="mx-auto text-red-500 mb-4" size={48} />
      <h2 className="text-xl font-bold text-slate-800">Error Loading Exercise</h2>
      <p className="text-slate-500">{error}</p>
      <button onClick={() => navigate('/exercises')} className="mt-4 text-blue-600 font-bold hover:underline">Go Back</button>
    </div>
  );

  const TargetComponent = COMPONENT_REGISTRY[exerciseData.componentName];
  const isReadOnly = user?.isAdmin && selectedStudent !== null;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 flex flex-col md:flex-row gap-6">

      {/* Admin Sidebar */}
      {user?.isAdmin && (
        <div className="w-full md:w-80 flex-shrink-0 flex flex-col gap-4">
          <button onClick={() => navigate('/exercises')} className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors">
            <ArrowLeft size={16} /> Back to Exercises
          </button>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[800px]">
            <div className="bg-slate-800 text-white p-4">
              <h2 className="font-bold flex items-center gap-2"><Users size={18} /> Manage Class</h2>
            </div>

            <div className="p-3 bg-slate-50 border-b border-slate-200 grid grid-cols-2 gap-2">
              <button onClick={() => handleAdminAction('Save All')} className="col-span-2 flex items-center justify-center gap-2 bg-blue-100 text-blue-700 px-3 py-2 rounded text-sm font-bold hover:bg-blue-200">
                <Save size={16} /> Save All Work
              </button>
              <button onClick={() => handleAdminAction('Check Answers')} className="col-span-2 flex items-center justify-center gap-2 bg-green-100 text-green-700 px-3 py-2 rounded text-sm font-bold hover:bg-green-200">
                <CheckSquare size={16} /> Check Answers (Current Part)
              </button>
              <button onClick={() => handleAdminAction('Previous Part')} className="flex items-center justify-center gap-2 bg-orange-100 text-orange-700 px-3 py-2 rounded text-sm font-bold hover:bg-orange-200">
                <Rewind size={16} /> Force Prev
              </button>
              <button onClick={() => handleAdminAction('Next Part')} className="flex items-center justify-center gap-2 bg-purple-100 text-purple-700 px-3 py-2 rounded text-sm font-bold hover:bg-purple-200">
                <FastForward size={16} /> Force Next
              </button>
              <button onClick={handleResetSession} className="col-span-2 flex items-center justify-center gap-2 bg-red-100 text-red-700 px-3 py-2 rounded text-sm font-bold hover:bg-red-200 mt-2">
                <RotateCcw size={16} /> Reset Session & Delete Records
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              <div className="text-xs font-bold text-slate-400 mb-2 px-2 uppercase">Views</div>

              <button
                onClick={handleSelectMyView}
                className={`w-full text-left p-3 rounded-lg mb-4 border transition-colors ${!selectedStudent
                    ? 'bg-blue-50 border-blue-200 shadow-sm'
                    : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
              >
                <div className="font-bold text-sm text-slate-800 flex items-center gap-2">
                  <User size={16} className="text-blue-600" /> My Exercise View
                </div>
              </button>

              <div className="text-xs font-bold text-slate-400 mb-2 px-2 uppercase">Assigned Students</div>
              {studentsList.length === 0 && (
                <div className="text-center text-sm text-slate-400 py-4">No students in assigned groups.</div>
              )}
              {studentsList.map(student => (
                <button
                  key={student.email}
                  onClick={() => handleSelectStudent(student)}
                  className={`w-full text-left p-3 rounded-lg mb-1 border transition-colors ${selectedStudent?.email === student.email
                      ? 'bg-blue-50 border-blue-200'
                      : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-200'
                    }`}
                >
                  <div className="font-bold text-sm text-slate-800">{student.name}</div>
                  <div className="flex justify-between items-center mt-1">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${student.status === 'Attempted' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                      {student.status}
                    </span>
                    {student.progress?.marks !== undefined && (
                      <span className="text-xs font-bold text-blue-600">Marks: {student.progress.marks}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Exercise Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {!user?.isAdmin && (
          <button onClick={() => navigate('/exercises')} className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-800 mb-6 transition-colors">
            <ArrowLeft size={16} /> Back to Exercises
          </button>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 p-4 flex justify-between items-center">
            <h1 className="font-bold text-lg text-slate-800">{exerciseData.title}</h1>
            {user?.isAdmin && (
              <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${selectedStudent ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                }`}>
                {selectedStudent ? (
                  <><AlertCircle size={14} /> Viewing: {selectedStudent.name}</>
                ) : (
                  <><User size={14} /> My Interactive View</>
                )}
              </span>
            )}
          </div>

          <div className="p-6">
            {TargetComponent ? (
              <TargetComponent
                savedData={studentWork}
                onSave={handleSaveWork}
                readOnly={isReadOnly}
                isAdmin={user?.isAdmin}
                currentPart={currentPart}
                adminCommand={adminCommand}
              />
            ) : (
              <div className="p-8 text-center bg-red-50 border border-red-200 rounded-lg text-red-700">
                <AlertCircle className="mx-auto mb-2" size={32} />
                <p className="font-bold">Component Not Found</p>
                <p className="text-sm mt-1">The component <code>{exerciseData.componentName}</code> is not registered.</p>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}