export enum SubeKodu {
  KARTAL = 'KARTAL',
  PENDIK = 'PENDIK',
  SANCAKTEPE = 'SANCAKTEPE',
  BUYAKA_AVM = 'BUYAKA_AVM',
  SOGANLIK = 'SOGANLIK',
  HEPSIBURADA = 'HEPSIBURADA',
  N11 = 'N11',
  TICARI = 'TICARI'
}

export interface Sube {
  kod: SubeKodu;
  ad: string;
  satisKoduPrefix: number;
  dbPath: string;
  tip?: 'magaza' | 'online' | 'ticari';
}

export const SUBELER: Sube[] = [
  {
    kod: SubeKodu.KARTAL,
    ad: 'Kartal Şubesi',
    satisKoduPrefix: 1010,
    dbPath: 'kartal',
    tip: 'magaza'
  },
  {
    kod: SubeKodu.PENDIK,
    ad: 'Pendik Şubesi',
    satisKoduPrefix: 2030,
    dbPath: 'pendik',
    tip: 'magaza'
  },
  {
    kod: SubeKodu.SANCAKTEPE,
    ad: 'Sancaktepe Şubesi',
    satisKoduPrefix: 3040,
    dbPath: 'sancaktepe',
    tip: 'magaza'
  },
  {
    kod: SubeKodu.BUYAKA_AVM,
    ad: 'Buyaka AVM Şubesi',
    satisKoduPrefix: 4050,
    dbPath: 'buyaka',
    tip: 'magaza'
  },
  {
    kod: SubeKodu.SOGANLIK,
    ad: 'Soğanlık Şubesi',
    satisKoduPrefix: 5060,
    dbPath: 'soganlik',
    tip: 'magaza'
  },
  {
    kod: SubeKodu.HEPSIBURADA,
    ad: 'Hepsiburada',
    satisKoduPrefix: 6070,
    dbPath: 'hepsiburada',
    tip: 'online'
  },
  {
    kod: SubeKodu.N11,
    ad: 'N11',
    satisKoduPrefix: 7080,
    dbPath: 'n11',
    tip: 'online'
  },
  {
    kod: SubeKodu.TICARI,
    ad: 'Ticari Satış',
    satisKoduPrefix: 8090,
    dbPath: 'ticari',
    tip: 'ticari'
  }
];

export const MAGAZA_SUBELER = SUBELER.filter(s => s.tip === 'magaza');
export const ONLINE_SUBELER = SUBELER.filter(s => s.tip === 'online');
export const TICARI_SUBELER = SUBELER.filter(s => s.tip === 'ticari');

export const getSubeByKod = (kod: SubeKodu): Sube | undefined => {
  return SUBELER.find(s => s.kod === kod);
};