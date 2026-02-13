import { SubeKodu } from './sube';

// types/user.ts
export enum UserRole {
  ADMIN = 'ADMIN',  // Burada 'ADMIN' büyük harf ve tırnak içinde mi?
  CALISAN = 'CALISAN'
}

export interface User {
  uid: string;
  email: string;
  ad: string;
  soyad: string;
  role: UserRole;
  subeKodu: SubeKodu;
  createdAt: Date;
}

export interface RegisterData {
  email: string;
  password: string;
  ad: string;
  soyad: string;
  subeKodu: SubeKodu;
}
