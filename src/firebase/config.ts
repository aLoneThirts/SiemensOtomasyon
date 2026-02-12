import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyD634I1HYvXqe0hbu7xMAlbdr8Sof3VNM8",
  authDomain: "siemensotomasyon-a4039.firebaseapp.com",
  projectId: "siemensotomasyon-a4039",
  storageBucket: "siemensotomasyon-a4039.firebasestorage.app",
  messagingSenderId: "257431439512",
  appId: "1:257431439512:web:c1376e8edfe16535d368ed",
  measurementId: "G-6CL2MGBP3G"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and Firestore
export const auth = getAuth(app);
export const db = getFirestore(app);

export default app;