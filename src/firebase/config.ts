import { initializeApp, getApps } from 'firebase/app';
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

// Ana app
const app = initializeApp(firebaseConfig);

// İkinci app - admin oturumunu bozmadan kullanıcı oluşturmak için
const secondaryApp = getApps().find(a => a.name === 'Secondary')
  || initializeApp(firebaseConfig, 'Secondary');

// Auth ve Firestore
export const auth = getAuth(app);
export const secondaryAuth = getAuth(secondaryApp);
export const db = getFirestore(app);

export default app;