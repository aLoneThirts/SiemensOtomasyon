// ================================================
//  apiService.ts — Firebase'in yerini alan API servisi
//  Tüm Firebase çağrılarını bu dosya üzerinden yap
// ================================================

const API_URL = "http://localhost:8000"; // VPS'e geçince değişecek

// ─── Token Yönetimi ──────────────────────────────────────────────────────────

export const getToken = (): string | null => localStorage.getItem("token");

const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${getToken()}`,
});

// ─── Genel Fetch Helper ───────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "API hatası");
  }
  return res.json();
}

// ─── AUTH ────────────────────────────────────────────────────────────────────

export const login = async (email: string, password: string) => {
  const data = await apiFetch<{ access_token: string; user: any }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  localStorage.setItem("token", data.access_token);
  return data.user;
};

export const logout = () => localStorage.removeItem("token");

export const getMe = () => apiFetch<any>("/auth/me");

export const getUsers = () => apiFetch<any[]>("/auth/users");

export const registerUser = (data: {
  email: string; password: string;
  ad: string; soyad: string; sube_kodu: string;
}) => apiFetch("/auth/register", { method: "POST", body: JSON.stringify(data) });

// ─── SATIŞLAR ─────────────────────────────────────────────────────────────────

export const getSatislar = (subeKodu: string, baslangic?: string, bitis?: string) => {
  const params = new URLSearchParams({ sube_kodu: subeKodu });
  if (baslangic) params.append("baslangic", baslangic);
  if (bitis) params.append("bitis", bitis);
  return apiFetch<any[]>(`/satislar?${params}`);
};

export const getSatis = (satisId: string) => apiFetch<any>(`/satislar/${satisId}`);

export const createSatis = (data: any) =>
  apiFetch("/satislar", { method: "POST", body: JSON.stringify(data) });

export const satisIptal = (satisId: string, iptalYapan: string, iptalYapanId: string) => {
  const params = new URLSearchParams({ iptal_yapan: iptalYapan, iptal_yapan_id: iptalYapanId });
  return apiFetch(`/satislar/${satisId}/iptal?${params}`, { method: "PUT" });
};

export const getSonSatisKodu = (subeKodu: string) =>
  apiFetch<{ son_kod: string | null }>(`/satislar/son-kod/${subeKodu}`);

// ─── KASA ─────────────────────────────────────────────────────────────────────

export const getBugununKasaGunu = (subeKodu: string, acilisYapan: string, testTarih?: string) => {
  const params = new URLSearchParams({ acilis_yapan: acilisYapan });
  if (testTarih) params.append("test_tarih", testTarih);
  return apiFetch<any>(`/kasa/bugun/${subeKodu}?${params}`);
};

export const getKasaGecmisi = (subeKodu: string, gunSayisi = 90) =>
  apiFetch<any[]>(`/kasa/gecmis/${subeKodu}?gun_sayisi=${gunSayisi}`);

export const kasaHareketEkle = (subeKodu: string, kasaGunId: string, hareket: any) =>
  apiFetch(`/kasa/hareket/${subeKodu}/${kasaGunId}`, {
    method: "POST",
    body: JSON.stringify(hareket),
  });

export const getKasaSatislar = (subeKodu: string, gun: string, filtre: "bugun" | "tahsilatlar" = "bugun") => {
  const params = new URLSearchParams({ gun, filtre });
  return apiFetch<any>(`/kasa/satislar/${subeKodu}?${params}`);
};