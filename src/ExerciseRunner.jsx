import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './main';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';

// ============================================================================
// 1. IMPORT YOUR ACTUAL EXERCISE COMPONENTS HERE
// ============================================================================
import DocumentNotes from './Practice1.jsx'; // Ensure this matches your filename exactly

// ============================================================================
// 2. REGISTER THEM IN THIS DICTIONARY
// The keys must match exactly what the Admin types in the "Component Name" box
// ============================================================================
const COMPONENT_REGISTRY = {
  'DocumentNotes': DocumentNotes,
};

export default function ExerciseRunner() {
  const { exerciseId, studentEmail } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [exerciseData, setExerciseData] = useState(null);
  const [savedWork, setSavedWork] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const targetEmail = studentEmail || user?.email;
  const isReadOnly = !!studentEmail && user?.isAdmin;

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 1. Fetch Exercise Metadata
        const docRef = doc(db, 'exercises', exerciseId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) throw new Error("Exercise not found");
        setExerciseData(docSnap.data());

        // 2. Fetch User Progress
        if (targetEmail) {
          const progressRef = doc(db, 'user_progress', targetEmail);
          const progressSnap = await getDoc(progressRef);
          if (progressSnap.exists() && progressSnap.data()[exerciseId]) {
            setSavedWork(progressSnap.data()[exerciseId]);
          }
        }

        setLoading(false);

      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };
    fetchData();
  }, [exerciseId, targetEmail]);

  const handleSaveWork = async (dataToSave) => {
    try {
      const progressRef = doc(db, 'user_progress', user.email);
      await setDoc(progressRef, { [exerciseId]: dataToSave, updatedAt: new Date().toISOString() }, { merge: true });
      alert("Progress saved successfully!");
    } catch (err) {
      alert("Error saving progress: " + err.message);
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

  // 3. LOOK UP THE COMPONENT FROM THE REGISTRY
  const TargetComponent = COMPONENT_REGISTRY[exerciseData.componentName];

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      <button
        onClick={() => navigate('/exercises')}
        className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-800 mb-6 transition-colors"
      >
        <ArrowLeft size={16} /> Back to Exercises
      </button>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 border-b border-slate-200 p-4">
          <h1 className="font-bold text-lg text-slate-800">{exerciseData.title}</h1>
        </div>

        <div className="p-6">
          {/* 4. RENDER THE COMPONENT DYNAMICALLY */}
          {TargetComponent ? (
            <>
              {isReadOnly && (
                <div className="mb-4 p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg text-sm font-bold flex items-center gap-2">
                  <AlertCircle size={16} /> Viewing work for: {studentEmail} (Read Only)
                </div>
              )}
              <TargetComponent savedData={savedWork} onSave={handleSaveWork} readOnly={isReadOnly} />
            </>
          ) : (
            <div className="p-8 text-center bg-red-50 border border-red-200 rounded-lg text-red-700">
              <AlertCircle className="mx-auto mb-2" size={32} />
              <p className="font-bold">Component Not Found</p>
              <p className="text-sm mt-1">The component <code>{exerciseData.componentName}</code> is not registered in ExerciseRunner.jsx.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}