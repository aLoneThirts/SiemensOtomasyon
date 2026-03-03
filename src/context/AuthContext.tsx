import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User as FirebaseUser,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { User } from '../types/user';

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
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

            // ✅ P0-6: Hassas console.log'lar kaldırıldı

            // ✅ FIX: Deaktif kullanıcı kontrolü
            // Admin satıcıyı deaktif ettiğinde giriş engellenir
            if (userData.aktif === false) {
              console.warn('⚠️ Deaktif kullanıcı tespit edildi, çıkış yapılıyor.');
              await signOut(auth);
              setCurrentUser(null);
              setLoading(false);
              return;
            }

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

  // register fonksiyonu kaldırıldı — kullanıcı oluşturma sadece AdminPanel'den
  // secondaryAuth ile yapılıyor (AuthContext'teki eski register mevcut oturumu bozuyordu)

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
    logout,
    resetPassword,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};