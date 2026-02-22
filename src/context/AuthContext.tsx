import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User as FirebaseUser,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { User, RegisterData, UserRole } from '../types/user';

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => {
  return useContext(AuthContext);
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();

            console.log('🔍 Firestore User Data:', userData);
            console.log('📊 Role from Firestore:', userData.role);

            // createdAt veya olusturmaTarihi hangisi varsa onu kullan
            // ikisi de yoksa new Date() koy - patlamaması için
            const createdAt =
              userData.createdAt?.toDate?.() ??
              userData.olusturmaTarihi?.toDate?.() ??
              new Date();

            setCurrentUser({
              uid: firebaseUser.uid,
              email: firebaseUser.email!,
              ad: userData.ad ?? '',
              soyad: userData.soyad ?? '',
              role: userData.role ?? 'SATICI',
              subeKodu: userData.subeKodu ?? '',
              createdAt,
            });

            console.log('✅ Current User Set:', {
              ad: userData.ad,
              role: userData.role,
            });
          } else {
            // Firestore'da döküman yok - kullanıcıyı null yap
            console.warn('⚠️ Firestore kullanıcı dökümanı bulunamadı:', firebaseUser.uid);
            setCurrentUser(null);
          }
        } catch (err) {
          console.error('❌ Kullanıcı verisi alınamadı:', err);
          setCurrentUser(null);
        }
      } else {
        setCurrentUser(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const register = async (data: RegisterData) => {
    const userCredential = await createUserWithEmailAndPassword(auth, data.email, data.password);
    await setDoc(doc(db, 'users', userCredential.user.uid), {
      email: data.email,
      ad: data.ad,
      soyad: data.soyad,
      role: UserRole.CALISAN,
      subeKodu: data.subeKodu,
      createdAt: new Date(),
    });
  };

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const logout = async () => {
    await signOut(auth);
  };

  const value = {
    currentUser,
    loading,
    login,
    register,
    logout,
    resetPassword,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};