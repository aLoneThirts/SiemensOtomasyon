export enum SubeKodu {
  KARTAL = 'KARTAL',
  PENDIK = 'PENDIK',
  SANCAKTEPE = 'SANCAKTEPE',
  BUYAKA_AVM = 'BUYAKA_AVM',
  SOGANLIK = 'SOGANLIK'
}

export interface Sube {
  kod: SubeKodu;
  ad: string;
  satisKoduPrefix: number; 
  dbPath: string;
}

export const SUBELER: Sube[] = [
  {
    kod: SubeKodu.KARTAL,
    ad: 'Kartal Şubesi',
    satisKoduPrefix: 1010,
    dbPath: 'kartal'
  },
  {
    kod: SubeKodu.PENDIK,
    ad: 'Pendik Şubesi',
    satisKoduPrefix: 2030,
    dbPath: 'pendik'
  },
  {
    kod: SubeKodu.SANCAKTEPE,
    ad: 'Sancaktepe Şubesi',
    satisKoduPrefix: 3040,
    dbPath: 'sancaktepe'
  },
  {
    kod: SubeKodu.BUYAKA_AVM,
    ad: 'Buyaka AVM Şubesi',
    satisKoduPrefix: 4050,
    dbPath: 'buyaka'
  },
  {
    kod: SubeKodu.SOGANLIK,
    ad: 'Soğanlık Şubesi',
    satisKoduPrefix: 5060,
    dbPath: 'soganlik'
  }
];

export const getSubeByKod = (kod: SubeKodu): Sube | undefined => {
  return SUBELER.find(s => s.kod === kod);
};