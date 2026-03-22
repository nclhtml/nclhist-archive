import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

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
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();