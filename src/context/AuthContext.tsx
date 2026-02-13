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
  login: (email: string, password: string, subeKodu: SubeKodu) => Promise<void>;
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
        try {
          // DÜZELTİLDİ: 'users' koleksiyonundan oku (kullanicilar DEĞİL!)
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          
          console.log('Firestore sorgusu yapılıyor:', 'users', firebaseUser.uid);
          console.log('Doküman var mı?', userDoc.exists());
          
          if (userDoc.exists()) {
            const userData = userDoc.data();
            console.log('Firestore\'dan gelen kullanıcı:', userData);
            
            setCurrentUser({
              uid: firebaseUser.uid,
              email: firebaseUser.email!,
              ad: userData.ad,
              soyad: userData.soyad,
              role: userData.role,
              subeKodu: userData.subeKodu || userData.subKodu, // subKodu varsa onu da dene
              createdAt: userData.createdAt?.toDate?.() || new Date()
            });
          } else {
            console.error('Kullanıcı Firestore\'da bulunamadı!');
            setCurrentUser(null);
          }
        } catch (error) {
          console.error('Kullanıcı bilgileri alınamadı:', error);
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
    
    // DÜZELTİLDİ: 'users' koleksiyonuna kaydet
    await setDoc(doc(db, 'users', userCredential.user.uid), {
      email: data.email,
      ad: data.ad,
      soyad: data.soyad,
      role: UserRole.CALISAN,
      subeKodu: data.subeKodu,
      createdAt: new Date()
    });
    
    console.log('Kullanıcı kaydedildi:', data.email);
  };

  const login = async (email: string, password: string, subeKodu: SubeKodu) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      console.log('Auth giriş başarılı:', userCredential.user.uid);
      
      // DÜZELTİLDİ: 'users' koleksiyonundan oku
      const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
      console.log('Firestore sorgusu yapıldı, var mı?', userDoc.exists());
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        console.log('Kullanıcı verileri:', userData);
        
        // Admin kontrolü
        if (userData.role === UserRole.ADMIN) {
          console.log('Admin girişi başarılı');
          return;
        }
        
        // Çalışan için şube kontrolü (subKodu veya subeKodu)
        const kullaniciSube = userData.subeKodu || userData.subKodu;
        if (kullaniciSube !== subeKodu) {
          console.log('Şube uyuşmazlığı:', kullaniciSube, '!=', subeKodu);
          await signOut(auth);
          throw new Error('Bu şubeye giriş yetkiniz yok!');
        }
        
        console.log('Çalışan girişi başarılı');
      } else {
        console.error('Kullanıcı Firestore\'da bulunamadı!');
        await signOut(auth);
        throw new Error('Kullanıcı bilgileri bulunamadı!');
      }
    } catch (error: any) {
      console.error('Login hatası:', error);
      if (error.code === 'auth/user-not-found') {
        throw new Error('Bu e-posta adresiyle kayıtlı kullanıcı bulunamadı!');
      } else if (error.code === 'auth/wrong-password') {
        throw new Error('Hatalı şifre!');
      } else if (error.code === 'auth/invalid-email') {
        throw new Error('Geçersiz e-posta formatı!');
      } else if (error.code === 'auth/invalid-credential') {
        throw new Error('E-posta veya şifre hatalı!');
      }
      throw error;
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