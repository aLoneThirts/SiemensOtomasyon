import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc, getDoc, query, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SUBELER, getSubeByKod, SubeKodu } from '../types/sube';
import { getSatisAuditLogs, getFilteredAuditLogs, writeSatisAuditLog, SatisAuditLog, ChangeSetItem } from '../services/satisLogService';
import './AuditLog.css';

interface Satici { id?: string; ad: string; soyad: string; email: string; subeKodu: string; aktif: boolean; role?: string; }
interface SatisLog {
  id: string; satisKodu: string; subeKodu: string; subeAd?: string; dbPath?: string;
  musteriBilgileri?: { isim: string; cep?: string; };
  musteriIsim?: string; musteriCep?: string;
  urunler?: Array<{ kod: string; ad: string; adet: number; alisFiyati: number; }>;
  musteriTemsilcisiId?: string; musteriTemsilcisiAd?: string; musteriTemsilcisi?: string;
  toplamTutar?: number; manuelSatisTutari?: number; olusturmaTarihi?: any;
  odemeDurumu?: string; acikHesap?: number; silindi?: boolean;
}

const subeRenk = (k: string) => { const r: Record<string,string> = { KARTAL:'#0ea5e9', PENDIK:'#8b5cf6', SANCAKTEPE:'#f59e0b', BUYAKA:'#10b981', SOGANLIK:'#ef4444' }; return r[k] || '#009999'; };
const fmtTarih = (t: any): string => { if (!t) return '-'; try { const d = t?.toDate ? t.toDate() : new Date(t); return d.toLocaleString('tr-TR', { day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit' }); } catch { return '-'; } };
const actIcon = (t: string) => ({ CREATE:'fa-plus-circle',UPDATE:'fa-edit',STATUS_CHANGE:'fa-exchange-alt',PAYMENT_UPDATE:'fa-credit-card',PRODUCTS_UPDATE:'fa-box',DELETE:'fa-trash',CANCEL:'fa-ban' }[t] || 'fa-info-circle');
const actColor = (t: string) => ({ CREATE:'#10b981',UPDATE:'#3b82f6',STATUS_CHANGE:'#f59e0b',PAYMENT_UPDATE:'#8b5cf6',PRODUCTS_UPDATE:'#0ea5e9',DELETE:'#ef4444',CANCEL:'#ef4444' }[t] || '#6b7280');
const actLabel = (t: string) => ({ CREATE:'OLUŞTURMA',UPDATE:'GÜNCELLEME',STATUS_CHANGE:'DURUM',PAYMENT_UPDATE:'ÖDEME',PRODUCTS_UPDATE:'ÜRÜN',DELETE:'SİLME',CANCEL:'İPTAL' }[t] || t);

interface Props { currentUser: any; }

const AuditLogSection: React.FC<Props> = ({ currentUser }) => {
  const [satislar, setSatislar] = useState<SatisLog[]>([]);
  const [yuklendi, setYuklendi] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [filtre, setFiltre] = useState({ baslangic: new Date(new Date().getFullYear(), new Date().getMonth(), 1), bitis: new Date(), sube: 'TUMU', satici: 'TUMU', musteri: '' });
  const [saticilar, setSaticilar] = useState<Satici[]>([]);
  const [mesaj, setMesaj] = useState<{ text: string; tip: string } | null>(null);
  const [selected, setSelected] = useState<SatisLog | null>(null);
  const [logs, setLogs] = useState<SatisAuditLog[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [detail, setDetail] = useState<SatisAuditLog | null>(null);
  const [viewMode, setViewMode] = useState<'satislar'|'timeline'>('satislar');
  const [allLogs, setAllLogs] = useState<SatisAuditLog[]>([]);

  useEffect(() => { loadSaticilar(); loadSatislar(); }, []);

  const loadSaticilar = async () => { try { const s = await getDocs(collection(db, 'users')); setSaticilar(s.docs.map(d => ({ id: d.id, ...d.data() } as Satici)).filter(u => u.role?.toString().toUpperCase() !== 'ADMIN').sort((a, b) => (a.ad || '').localeCompare(b.ad || ''))); } catch (e) { console.error(e); } };

  const loadSatislar = async () => {
    setYukleniyor(true); setYuklendi(false); setMesaj(null); setSelected(null);
    try {
      const subeler = filtre.sube === 'TUMU' ? SUBELER : SUBELER.filter(s => s.kod === filtre.sube);
      let all: SatisLog[] = [];
      for (const sube of subeler) {
        try {
          const ref = collection(db, `subeler/${sube.dbPath}/satislar`);
          const b = new Date(filtre.baslangic); b.setHours(0,0,0,0);
          const e = new Date(filtre.bitis); e.setHours(23,59,59,999);
          const q = query(ref, where('olusturmaTarihi', '>=', b), where('olusturmaTarihi', '<=', e));
          const snap = await getDocs(q);
          let sl = snap.docs.map(d => ({ id: d.id, ...d.data(), subeAd: sube.ad, subeKodu: sube.kod, dbPath: sube.dbPath } as SatisLog));
          if (filtre.satici !== 'TUMU') sl = sl.filter(l => l.musteriTemsilcisiId === filtre.satici);
          if (filtre.musteri.trim()) { const a = filtre.musteri.toLowerCase(); sl = sl.filter(l => (l.musteriBilgileri?.isim || l.musteriIsim || '').toLowerCase().includes(a)); }
          all = [...all, ...sl];
        } catch (e) { console.error(e); }
      }
      all.sort((a, b) => { const tA = a.olusturmaTarihi?.toDate?.() || new Date(0); const tB = b.olusturmaTarihi?.toDate?.() || new Date(0); return tB.getTime() - tA.getTime(); });
      setSatislar(all); setYuklendi(true);
      setMesaj(all.length > 0 ? { text: `✅ ${all.length} satış bulundu`, tip: 'success' } : { text: 'ℹ️ Satış bulunamadı', tip: 'info' });
    } catch (e: any) { setMesaj({ text: `❌ Hata: ${e.message}`, tip: 'error' }); } finally { setYukleniyor(false); }
  };

  const openTimeline = async (s: SatisLog) => { setSelected(s); setLogLoading(true); setDetail(null); try { setLogs(await getSatisAuditLogs(s.id)); } catch { setLogs([]); } finally { setLogLoading(false); } };

  const loadAllLogs = async () => { setLogLoading(true); try { const b = new Date(filtre.baslangic); b.setHours(0,0,0,0); const e = new Date(filtre.bitis); e.setHours(23,59,59,999); setAllLogs(await getFilteredAuditLogs({ startDate: b, endDate: e, branchId: filtre.sube, userId: filtre.satici })); } catch { setAllLogs([]); } finally { setLogLoading(false); } };

  const deleteSatis = async (s: SatisLog) => {
    if (!window.confirm(`"${s.satisKodu}" satışını silmek istediğinize emin misiniz?`)) return;
    try {
      const ref = doc(db, `subeler/${s.dbPath}/satislar`, s.id);
      const snap = await getDoc(ref); const old = snap.data() || {};
      await updateDoc(ref, { silindi: true, silinmeTarihi: new Date(), silenAdmin: currentUser?.email || '' });
      await writeSatisAuditLog({ saleId: s.id, satisKodu: s.satisKodu, dbPath: s.dbPath || '', branchId: s.subeKodu, branchName: s.subeAd, oldData: old, newData: { ...old, silindi: true }, userId: currentUser?.uid || '', userName: `${currentUser?.ad || ''} ${currentUser?.soyad || ''}`.trim(), actionType: 'DELETE' });
      setSatislar(p => p.filter(x => x.id !== s.id)); setMesaj({ text: '✅ Satış silindi', tip: 'success' });
    } catch (e: any) { setMesaj({ text: `❌ ${e.message}`, tip: 'error' }); }
  };

  const getDurum = (s: SatisLog) => { if (s.odemeDurumu === 'ODENDI') return { t: '✅ Ödendi', c: 'green' }; if (s.acikHesap && s.acikHesap > 0) return { t: `⚠️ Açık: ₺${s.acikHesap.toLocaleString('tr-TR')}`, c: 'orange' }; return { t: '⏳ Beklemede', c: 'gray' }; };

  const ChangePreview: React.FC<{ c: ChangeSetItem }> = ({ c }) => (
    <div className="al-change-row">
      <i className={`fas ${c.type === 'added' ? 'fa-plus' : c.type === 'removed' ? 'fa-minus' : 'fa-pencil-alt'}`} style={{ color: c.type === 'added' ? '#10b981' : c.type === 'removed' ? '#ef4444' : '#f59e0b', fontSize: 9, width: 14 }} />
      <span className="al-change-field">{c.fieldLabel}:</span>
      {c.old != null && <span className="al-val-old">{String(c.old)}</span>}
      {c.old != null && c.new != null && <span className="al-arrow">→</span>}
      {c.new != null && <span className="al-val-new">{String(c.new)}</span>}
    </div>
  );

  const TimelineItem: React.FC<{ log: SatisAuditLog; showCode?: boolean }> = ({ log, showCode }) => (
    <div className="al-tl-item" onClick={() => setDetail(log)}>
      <div className="al-tl-dot" style={{ background: actColor(log.actionType) }}><i className={`fas ${actIcon(log.actionType)}`} /></div>
      <div className="al-tl-content">
        <div className="al-tl-meta">
          <span className="al-action-badge" style={{ background: actColor(log.actionType) + '18', color: actColor(log.actionType), borderColor: actColor(log.actionType) + '40' }}>{actLabel(log.actionType)}</span>
          {showCode && <strong style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>{log.satisKodu}</strong>}
          {showCode && log.branchName && <span className="ap-sube-badge" style={{ background: subeRenk(log.branchId) + '20', color: subeRenk(log.branchId) }}>{log.branchName}</span>}
          <span className="al-tl-date">{fmtTarih(log.changedAt)}</span>
        </div>
        <div className="al-tl-user"><i className="fas fa-user" /> {log.changedByUserName || '?'}</div>
        <div className="al-tl-summary">{log.summary}</div>
        {log.changeSet?.slice(0, 3).map((c, i) => <ChangePreview key={i} c={c} />)}
        {(log.changeSet?.length || 0) > 3 && <div className="al-more">+{log.changeSet!.length - 3} daha — tıklayın</div>}
      </div>
    </div>
  );

  return (
    <div className="ap-one-col" style={{ position: 'relative' }}>
      {mesaj && <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999, padding: '12px 20px', borderRadius: 8, backgroundColor: mesaj.tip === 'success' ? '#10b981' : mesaj.tip === 'error' ? '#ef4444' : '#3b82f6', color: 'white', fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', maxWidth: 400 }}>{mesaj.text}</div>}

      <div className="ap-panel">
        <div className="ap-panel-header">
          <i className="fas fa-history" /><h3>Satış Logları & Değişiklik Geçmişi</h3>
          <div className="ap-panel-actions">
            <div className="al-toggle">
              <button className={`al-toggle-btn ${viewMode === 'satislar' ? 'active' : ''}`} onClick={() => { setViewMode('satislar'); setSelected(null); }}><i className="fas fa-list" /> Satışlar</button>
              <button className={`al-toggle-btn ${viewMode === 'timeline' ? 'active' : ''}`} onClick={() => { setViewMode('timeline'); loadAllLogs(); }}><i className="fas fa-stream" /> Değişiklik Akışı</button>
            </div>
          </div>
        </div>
        <div className="ap-panel-body">
          {/* Filtreler */}
          <div className="ap-filters-grid">
            <div className="ap-filter-group"><label>Başlangıç</label><input type="date" value={filtre.baslangic.toISOString().split('T')[0]} onChange={e => setFiltre(p => ({ ...p, baslangic: new Date(e.target.value) }))} /></div>
            <div className="ap-filter-group"><label>Bitiş</label><input type="date" value={filtre.bitis.toISOString().split('T')[0]} onChange={e => setFiltre(p => ({ ...p, bitis: new Date(e.target.value) }))} /></div>
            <div className="ap-filter-group"><label>Şube</label><select value={filtre.sube} onChange={e => setFiltre(p => ({ ...p, sube: e.target.value, satici: 'TUMU' }))}><option value="TUMU">Tüm Şubeler</option>{SUBELER.map(s => <option key={s.kod} value={s.kod}>{s.ad}</option>)}</select></div>
            <div className="ap-filter-group"><label>Satıcı</label><select value={filtre.satici} onChange={e => setFiltre(p => ({ ...p, satici: e.target.value }))}><option value="TUMU">Tüm Satıcılar</option>{saticilar.filter(s => filtre.sube === 'TUMU' || s.subeKodu === filtre.sube).map(s => <option key={s.id} value={s.id}>{s.ad} {s.soyad}</option>)}</select></div>
            <div className="ap-filter-group"><label>Müşteri</label><input type="text" placeholder="İsim ara..." value={filtre.musteri} onChange={e => setFiltre(p => ({ ...p, musteri: e.target.value }))} /></div>
            <div className="ap-filter-group ap-filter-action"><button className="ap-btn-primary" onClick={() => { loadSatislar(); if (viewMode === 'timeline') loadAllLogs(); }} disabled={yukleniyor}><i className="fas fa-search" /> {yukleniyor ? 'Aranıyor...' : 'Filtrele'}</button></div>
          </div>

          {/* A) Satışlar Listesi */}
          {viewMode === 'satislar' && yuklendi && (
            <div className="al-split">
              <div className={`al-left ${selected ? 'has-sel' : ''}`}>
                <div className="ap-table-label"><i className="fas fa-list" /> {satislar.length} satış</div>
                {satislar.length === 0 ? <div className="ap-empty"><p>Satış bulunamadı</p></div> : (
                  <div className="ap-table-scroll">
                    <table className="ap-table">
                      <thead><tr><th>Tarih</th><th>Şube</th><th>Kod</th><th>Müşteri</th><th>Ürünler</th><th>Satıcı</th><th>Tutar</th><th>Durum</th><th></th></tr></thead>
                      <tbody>
                        {satislar.map(s => { const d = getDurum(s); return (
                          <tr key={s.id} className={selected?.id === s.id ? 'al-row-sel' : ''} onClick={() => openTimeline(s)} style={{ cursor: 'pointer' }}>
                            <td data-label="Tarih">{fmtTarih(s.olusturmaTarihi)}</td>
                            <td data-label="Şube"><span className="ap-sube-badge" style={{ background: subeRenk(s.subeKodu) + '20', color: subeRenk(s.subeKodu) }}>{s.subeAd || s.subeKodu}</span></td>
                            <td data-label="Kod"><strong>{s.satisKodu}</strong></td>
                            <td data-label="Müşteri">{s.musteriBilgileri?.isim || s.musteriIsim || '-'}</td>
                            <td data-label="Ürünler">{s.urunler?.map((u, i) => <div key={i} style={{ fontSize: 11 }}>{u.kod} x{u.adet}</div>)}</td>
                            <td data-label="Satıcı">{s.musteriTemsilcisiAd || s.musteriTemsilcisi || '-'}</td>
                            <td data-label="Tutar">₺{(s.toplamTutar || s.manuelSatisTutari || 0).toLocaleString('tr-TR')}</td>
                            <td data-label="Durum"><span className={`ap-pill ${d.c}`}>{d.t}</span></td>
                            <td><button className="ap-delete-btn" onClick={e => { e.stopPropagation(); deleteSatis(s); }} title="Sil"><i className="fas fa-trash" /></button></td>
                          </tr>);
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {selected && (
                <div className="al-right">
                  <div className="al-tl-header">
                    <div className="al-tl-title"><i className="fas fa-history" style={{ color: 'var(--teal)' }} /><div><strong>{selected.satisKodu}</strong><span className="al-tl-sub">{selected.musteriBilgileri?.isim || selected.musteriIsim || '-'} — {selected.subeAd}</span></div></div>
                    <button className="al-close" onClick={() => setSelected(null)}><i className="fas fa-times" /></button>
                  </div>
                  <div className="al-tl-body">
                    {logLoading ? <div className="ap-loading"><i className="fas fa-spinner fa-spin" /> Yükleniyor...</div>
                    : logs.length === 0 ? <div className="al-empty-tl"><i className="fas fa-inbox" /><p>Henüz değişiklik kaydı yok.</p><small>Satış güncellendiğinde burada görünecek.</small></div>
                    : <div className="al-timeline">{logs.map((l, i) => <TimelineItem key={l.id || i} log={l} />)}</div>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* B) Değişiklik Akışı */}
          {viewMode === 'timeline' && (
            <div className="al-full-tl">
              {logLoading ? <div className="ap-loading"><i className="fas fa-spinner fa-spin" /> Yükleniyor...</div>
              : allLogs.length === 0 ? <div className="ap-empty"><i className="fas fa-stream" /><p>Değişiklik kaydı bulunamadı.</p></div>
              : <><div className="ap-table-label"><i className="fas fa-stream" /> {allLogs.length} kayıt</div><div className="al-timeline">{allLogs.map((l, i) => <TimelineItem key={l.id || i} log={l} showCode />)}</div></>}
            </div>
          )}
        </div>
      </div>

      {/* Detay Modal */}
      {detail && (
        <div className="al-overlay" onClick={() => setDetail(null)}>
          <div className="al-modal" onClick={e => e.stopPropagation()}>
            <div className="al-modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="al-modal-icon" style={{ background: actColor(detail.actionType) }}><i className={`fas ${actIcon(detail.actionType)}`} /></div>
                <div><h3 style={{ margin: 0, fontSize: 15 }}>{actLabel(detail.actionType)} — {detail.satisKodu}</h3><div style={{ fontSize: 12, color: '#80868b', marginTop: 2 }}>{fmtTarih(detail.changedAt)} • {detail.changedByUserName} • {detail.branchName}</div></div>
              </div>
              <button className="al-close" onClick={() => setDetail(null)}><i className="fas fa-times" /></button>
            </div>
            <div className="al-modal-body">
              <table className="al-detail-tbl">
                <thead><tr><th>Alan</th><th>Eski Değer</th><th>Yeni Değer</th></tr></thead>
                <tbody>
                  {detail.changeSet?.map((c, i) => (
                    <tr key={i} className={`al-drow al-d-${c.type || 'modified'}`}>
                      <td className="al-dfld"><i className={`fas ${c.type === 'added' ? 'fa-plus' : c.type === 'removed' ? 'fa-minus' : 'fa-pencil-alt'}`} style={{ color: c.type === 'added' ? '#10b981' : c.type === 'removed' ? '#ef4444' : '#f59e0b', marginRight: 8, fontSize: 10 }} />{c.fieldLabel}</td>
                      <td className="al-dold">{c.old != null ? String(c.old) : <span style={{ color: '#bdc1c6' }}>—</span>}</td>
                      <td className="al-dnew">{c.new != null ? String(c.new) : <span style={{ color: '#bdc1c6' }}>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditLogSection;
