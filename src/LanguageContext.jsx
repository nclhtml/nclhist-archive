// LanguageContext.jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from './firebase.js';
import { useAuth } from './main.jsx';
import { uiTranslations } from './translations.js'; // <-- Import the dictionary here

const LanguageContext = createContext(null);

export const LanguageProvider = ({ children }) => {
  const { user } = useAuth();
  const [language, setLangState] = useState('en');

  useEffect(() => {
    if (user?.email) {
      getDoc(doc(db, "user_progress", user.email.toLowerCase().trim()))
        .then(docSnap => {
          if (docSnap.exists() && docSnap.data().language) {
            setLangState(docSnap.data().language);
          }
        }).catch(e => console.warn("Error fetching language:", e));
    }
  }, [user]);

  const setLanguage = async (newLang) => {
    setLangState(newLang);
    if (user?.email) {
      try {
        await setDoc(doc(db, "user_progress", user.email.toLowerCase().trim()), { language: newLang }, { merge: true });
      } catch (e) { console.warn("Error saving language:", e); }
    }
  };

  const t = (text) => {
    if (language === 'zh' && typeof text === 'string') {
      // Automatically catch "4 Marks", "7/8 Marks", "1 Mark", etc.
      const match = text.match(/^([\d\+\/]+)\s*Marks?$/i);
      if (match) return `${match[1]}分`;
    }
    return uiTranslations[language]?.[text] || text;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);