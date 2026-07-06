import React, { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, deleteDoc, doc, getDoc } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { BookOpen, Plus, Trash2, Users, Code, Loader2, X, Clock } from 'lucide-react';
import { db } from './firebase';
import { useAuth } from './main';

export default function Exercises() {
  const { user } = useAuth();
  const [exercises, setExercises] = useState([]);
  const [studentClass, setStudentClass] = useState('');
  const [loading, setLoading] = useState(true);

  // Admin Form State
  const [showForm, setShowForm] = useState(false);
  const [availableGroups, setAvailableGroups] = useState([]);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    componentName: '',
    assignedGroups: []
  });

  // Student Progress Modal State
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [selectedExerciseId, setSelectedExerciseId] = useState(null);
  const [studentProgressList, setStudentProgressList] = useState([]);
  const [loadingProgress, setLoadingProgress] = useState(false);

  useEffect(() => {
    fetchData();
  }, [user?.email, user?.role, user?.isAdmin]); // <-- FIX 1: Track primitive values to stop infinite loop

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch the student's class from the 'students' collection (if not admin)
      let currentStudentClass = '';
      if (user && !user.isAdmin) {
        // MOCK: In your real code, use getDocs to find the student's class
        // const studentSnap = await getDocs(query(collection(db, "students"), where("email", "==", user.email)));
        // if (!studentSnap.empty) currentStudentClass = studentSnap.docs[0].data().className;
        currentStudentClass = 'Class 4A'; // Mocked
        setStudentClass(currentStudentClass);
      }

      // 2. Fetch all exercises from REAL Firebase
      const snap = await getDocs(collection(db, 'exercises'));
      const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      // NEW: Fetch available custom roles (access groups) for the checkboxes
      if (user?.isAdmin) {
        const configDocSnap = await getDoc(doc(db, "system_settings", "config"));
        if (configDocSnap.exists()) setAvailableGroups(configDocSnap.data().roles || []);
      }

      // 3. Filter exercises based on user role/class (Case-Insensitive Fix)
      const filtered = fetched.filter(ex => {
        if (user?.isAdmin) return true; // Admins see everything

        const groups = (ex.assignedGroups || []).map(g => String(g).toLowerCase().trim());
        const studentClassLower = String(currentStudentClass).toLowerCase().trim();
        const userRoleLower = String(user?.role || '').toLowerCase().trim();

        return groups.includes('all') || groups.includes(studentClassLower) || groups.includes(userRoleLower);
      });

      setExercises(filtered);
    } catch (error) {
      console.error("Error fetching exercises:", error);
    }
    setLoading(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const newExercise = {
        title: formData.title,
        description: formData.description,
        componentName: formData.componentName,
        assignedGroups: formData.assignedGroups,
        createdAt: new Date().toISOString()
      };

      await addDoc(collection(db, 'exercises'), newExercise);
      alert("Exercise saved to database!");
      setShowForm(false);
      setFormData({ title: '', description: '', componentName: '', assignedGroups: [] });
      fetchData();
    } catch (error) {
      alert("Error saving: " + error.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this exercise?")) return;
    try {
      await deleteDoc(doc(db, 'exercises', id));
      alert("Deleted!");
      fetchData();
    } catch (error) {
      alert("Error deleting: " + error.message);
    }
  };

  const handleOpenProgressModal = async (exercise) => {
    setSelectedExerciseId(exercise.id);
    setShowProgressModal(true);
    setLoadingProgress(true);
    setStudentProgressList([]);
    try {
      // 1. Fetch students, roles, and progress simultaneously
      const [studentsSnap, rolesSnap, progressSnap] = await Promise.all([
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'user_roles')),
        getDocs(collection(db, 'user_progress'))
      ]);

      const studentsData = studentsSnap.docs.map(d => ({ email: (d.data().email || d.id).toLowerCase(), ...d.data() }));
      const rolesData = rolesSnap.docs.map(d => ({ email: d.id.toLowerCase(), role: d.data().role }));

      // 2. Build a unified list of users (combining roles and student profiles)
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

      // 3. Filter by assigned groups
      const groups = (exercise.assignedGroups || []).map(g => String(g).toLowerCase().trim());
      const targetStudents = allUsers.filter(u => {
        if (groups.includes('all')) return true;
        const uClass = String(u.className).toLowerCase().trim();
        const uRole = String(u.role).toLowerCase().trim();
        return groups.includes(uClass) || groups.includes(uRole);
      });

      // 4. Map progress
      const progressMap = {};
      progressSnap.forEach(doc => {
        const data = doc.data();
        if (data[exercise.id]) {
          progressMap[doc.id.toLowerCase()] = data[exercise.id].updatedAt || 'Unknown time';
        }
      });

      // 5. Merge students with their progress
      const progressDataMap = new Map();
      targetStudents.forEach(u => {
        progressDataMap.set(u.email, {
          email: u.email,
          name: u.name,
          updatedAt: progressMap[u.email] || null
        });
      });

      // Add ANY user who actually has progress (even if not in target group)
      Object.keys(progressMap).forEach(email => {
        if (!progressDataMap.has(email)) {
          const studentMatch = studentsData.find(s => s.email === email);
          progressDataMap.set(email, {
            email: email,
            name: studentMatch?.englishName || email.split('@')[0],
            updatedAt: progressMap[email]
          });
        }
      });

      const progressData = Array.from(progressDataMap.values());

      // Sort: Students with progress first (newest to oldest), then students without progress
      progressData.sort((a, b) => {
        if (a.updatedAt && b.updatedAt) return new Date(b.updatedAt) - new Date(a.updatedAt);
        if (a.updatedAt) return -1;
        if (b.updatedAt) return 1;
        return a.email.localeCompare(b.email);
      });

      setStudentProgressList(progressData);
    } catch (error) {
      console.error("Error fetching progress:", error);
      alert("Failed to load student progress.");
    }
    setLoadingProgress(false);
  };

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin text-blue-600" /></div>;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <BookOpen className="text-blue-600" /> Interactive Exercises
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {user?.isAdmin ? "Manage and assign exercises to students." : "Complete the exercises assigned to your class."}
          </p>
        </div>

        {user?.isAdmin && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} /> Add Exercise
          </button>
        )}
      </div>

      {/* Admin Form */}
      {showForm && user?.isAdmin && (
        <form onSubmit={handleCreate} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8">
          <h2 className="font-bold text-lg mb-4 text-slate-800">Create New Exercise Assignment</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Display Title</label>
              <input required type="text" value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} className="w-full p-2 border rounded-md text-sm" placeholder="e.g. Chapter 1 Quiz" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1"><Code size={14} /> React Component Name</label>
              <input required type="text" value={formData.componentName} onChange={e => setFormData({ ...formData, componentName: e.target.value })} className="w-full p-2 border rounded-md text-sm font-mono" placeholder="e.g. MathQuiz1" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-500 mb-1">Description</label>
              <input required type="text" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} className="w-full p-2 border rounded-md text-sm" placeholder="Brief instructions..." />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-500 mb-2 flex items-center gap-1"><Users size={14} /> Assigned Groups</label>
              <div className="flex flex-wrap gap-2 p-3 border rounded-md bg-slate-50 max-h-40 overflow-y-auto">
                <label className="flex items-center gap-1 text-sm bg-white px-2 py-1 rounded border cursor-pointer hover:bg-blue-50">
                  <input
                    type="checkbox"
                    checked={formData.assignedGroups.includes('all')}
                    onChange={(e) => {
                      if (e.target.checked) setFormData({ ...formData, assignedGroups: [...formData.assignedGroups, 'all'] });
                      else setFormData({ ...formData, assignedGroups: formData.assignedGroups.filter(g => g !== 'all') });
                    }}
                  />
                  All Students
                </label>
                {availableGroups.map(group => (
                  <label key={group} className="flex items-center gap-1 text-sm bg-white px-2 py-1 rounded border cursor-pointer hover:bg-blue-50">
                    <input
                      type="checkbox"
                      checked={formData.assignedGroups.includes(group)}
                      onChange={(e) => {
                        if (e.target.checked) setFormData({ ...formData, assignedGroups: [...formData.assignedGroups, group] });
                        else setFormData({ ...formData, assignedGroups: formData.assignedGroups.filter(g => g !== group) });
                      }}
                    />
                    {group}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-md">Cancel</button>
            <button type="submit" className="px-4 py-2 text-sm font-bold bg-blue-600 text-white rounded-md hover:bg-blue-700">Save Assignment</button>
          </div>
        </form>
      )}

      {/* Exercise List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {exercises.length === 0 && (
          <div className="col-span-full py-12 text-center text-slate-500 bg-white border border-slate-200 rounded-xl border-dashed">
            No exercises assigned to you currently.
          </div>
        )}
        {exercises.map(ex => (
          <div key={ex.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col">
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-bold text-slate-800 text-lg">{ex.title}</h3>
              {user?.isAdmin && (
                <button onClick={() => handleDelete(ex.id)} className="text-slate-400 hover:text-red-600 transition-colors"><Trash2 size={16} /></button>
              )}
            </div>
            <p className="text-slate-600 text-sm flex-1 mb-4">{ex.description}</p>

            {user?.isAdmin && (
              <div className="mb-4 bg-slate-50 p-2 rounded text-xs text-slate-500 font-mono border border-slate-100">
                <div>Comp: {ex.componentName}</div>
                <div>Groups: {ex.assignedGroups?.join(', ')}</div>
              </div>
            )}

            <div className="flex gap-2 w-full mt-auto">
              <Link
                to={`/exercise/${ex.id}`}
                className="flex-1 text-center bg-blue-50 text-blue-700 font-bold py-2 rounded-lg hover:bg-blue-600 hover:text-white transition-colors"
              >
                Attempt
              </Link>
              {user?.isAdmin && (
                <button
                  onClick={() => handleOpenProgressModal(ex)}
                  className="flex-1 text-center bg-amber-50 text-amber-700 font-bold py-2 rounded-lg hover:bg-amber-600 hover:text-white transition-colors"
                >
                  View Work
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Student Progress Modal */}
      {showProgressModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-lg overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h2 className="font-bold text-slate-800 flex items-center gap-2"><Users size={18} /> Student Progress</h2>
              <button onClick={() => setShowProgressModal(false)} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {loadingProgress ? (
                <div className="flex justify-center py-8"><Loader2 className="animate-spin text-blue-600" size={32} /></div>
              ) : studentProgressList.length === 0 ? (
                <div className="text-center py-8 text-slate-500">No students found in the assigned groups for this exercise.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {studentProgressList.map((student, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg hover:bg-slate-50">
                      <div>
                        <div className="font-bold text-slate-700 text-sm">{student.name}</div>
                        <div className="text-slate-500 text-[10px]">{student.email}</div>
                        <div className={`text-xs flex items-center gap-1 mt-1 ${student.updatedAt ? 'text-green-600 font-medium' : 'text-slate-400'}`}>
                          <Clock size={12} />
                          {student.updatedAt
                            ? (student.updatedAt !== 'Unknown time' ? new Date(student.updatedAt).toLocaleString() : 'Unknown time')
                            : 'Not started yet'}
                        </div>
                      </div>
                      {student.updatedAt && (
                        <Link
                          to={`/exercise/${selectedExerciseId}/${encodeURIComponent(student.email)}`}
                          className="bg-blue-100 text-blue-700 px-3 py-1 rounded text-xs font-bold hover:bg-blue-200 transition-colors"
                        >
                          View Work
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}