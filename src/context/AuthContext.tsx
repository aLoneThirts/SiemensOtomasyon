import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User as FirebaseUser,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import { User, RegisterData, UserRole } from '../types/user';
import { SubeKodu } from '../types/sube';

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
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
        // Kullanıcı bilgilerini Firestore'dan al
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          
          console.log('🔍 Firestore User Data:', userData);
          console.log('📊 Role from Firestore:', userData.role);
          
          setCurrentUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email!,
            ad: userData.ad,
            soyad: userData.soyad,
            role: userData.role,
            subeKodu: userData.subeKodu,
            createdAt: userData.createdAt.toDate()
          });
          
          console.log('✅ Current User Set:', {
            ad: userData.ad,
            role: userData.role
          });
        }
      } else {
        setCurrentUser(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const register = async (data: RegisterData) => {
    // Firebase Authentication ile kullanıcı oluştur
    const userCredential = await createUserWithEmailAndPassword(auth, data.email, data.password);
    
    // Firestore'da kullanıcı bilgilerini kaydet
    await setDoc(doc(db, 'users', userCredential.user.uid), {
      email: data.email,
      ad: data.ad,
      soyad: data.soyad,
      role: UserRole.CALISAN, // Varsayılan olarak çalışan
      subeKodu: data.subeKodu,
      createdAt: new Date()
    });
  };

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };
    
    // Kullanıcının şube bilgisini kontrol et
    const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
    if (userDoc.exists()) {
      const userData = userDoc.data();
      
      // Admin değilse ve farklı şubeye giriş yapmaya çalışıyorsa hata ver
      if (userData.role !== UserRole.ADMIN && userData.subeKodu !== subeKodu) {
        await signOut(auth);
        throw new Error('Bu şubeye giriş yetkiniz yok!');
      }
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  const value = {
    currentUser,
    loading,
    login,
    register,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};