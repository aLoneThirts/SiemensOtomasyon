import { collection, addDoc, Timestamp, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';

export type ActionType = 'CREATE'|'UPDATE'|'STATUS_CHANGE'|'PAYMENT_UPDATE'|'PRODUCTS_UPDATE'|'CANCEL'|'DELETE';
export interface ChangeSetItem { field: string; fieldLabel: string; old: any; new: any; type?: 'added'|'removed'|'modified'; }
export interface SatisAuditLog { id?: string; saleId: string; satisKodu: string; actionType: ActionType; changedAt: any; changedByUserId: string; changedByUserName: string; branchId: string; branchName?: string; dbPath: string; changeSet: ChangeSetItem[]; summary: string; }

const FL: Record<string,string> = { 'musteriBilgileri.isim':'Müşteri İsim','musteriBilgileri.cep':'Müşteri Cep','musteriBilgileri.adres':'Müşteri Adres','musteriBilgileri.faturaAdresi':'Fatura Adresi','musteriBilgileri.vergiNumarasi':'Vergi No','musteriBilgileri.vkNo':'VKN','musteriBilgileri.vd':'Vergi Dairesi','musteriIsim':'Müşteri İsim','musteriCep':'Müşteri Cep','toplamTutar':'Toplam Tutar','manuelSatisTutari':'Manuel Satış Tutarı','odemeDurumu':'Ödeme Durumu','acikHesap':'Açık Hesap','musteriTemsilcisiAd':'Satıcı','musteriTemsilcisi':'Satıcı','not':'Not','teslimatDurumu':'Teslimat Durumu','onayDurumu':'Onay Durumu','iptalNedeni':'İptal Nedeni' };

function deq(a:any,b:any):boolean{ if(a===b)return true; if(a==null&&b==null)return true; if(a==null||b==null)return false; if(typeof a!==typeof b)return String(a)===String(b); if(typeof a!=='object')return a===b; if(Array.isArray(a)!==Array.isArray(b))return false; if(Array.isArray(a)){if(a.length!==b.length)return false;return a.every((v:any,i:number)=>deq(v,b[i]));} const ka=Object.keys(a),kb=Object.keys(b); if(ka.length!==kb.length)return false; return ka.every(k=>deq(a[k],b[k])); }
function ft(v:any):string{ if(v==null)return'-'; const n=typeof v==='number'?v:parseFloat(v); if(isNaN(n))return String(v); return '₺'+n.toLocaleString('tr-TR'); }
function gn(o:any,p:string):any{ return p.split('.').reduce((a,k)=>a?.[k],o); }

const SF=['musteriBilgileri.isim','musteriBilgileri.cep','musteriBilgileri.adres','musteriBilgileri.faturaAdresi','musteriBilgileri.vergiNumarasi','musteriBilgileri.vkNo','musteriBilgileri.vd','musteriIsim','musteriCep','toplamTutar','manuelSatisTutari','odemeDurumu','acikHesap','musteriTemsilcisiAd','musteriTemsilcisi','not','teslimatDurumu','onayDurumu','iptalNedeni'];

function diffS(o:Record<string,any>,n:Record<string,any>):ChangeSetItem[]{ const c:ChangeSetItem[]=[]; for(const f of SF){ const ov=gn(o,f),nv=gn(n,f); if(!deq(ov,nv)&&!f.toLowerCase().includes('tarihi')) c.push({field:f,fieldLabel:FL[f]||f,old:ov??null,new:nv??null,type:'modified'}); } return c; }

function diffP(op:any[]=[],np:any[]=[]):ChangeSetItem[]{ const c:ChangeSetItem[]=[]; const om:Record<string,any>={}; const nm:Record<string,any>={}; op.forEach(p=>{om[p.kod]=p;}); np.forEach(p=>{nm[p.kod]=p;});
  Object.keys(nm).forEach(k=>{ const v=nm[k]; if(!om[k]) c.push({field:'urunler.'+k,fieldLabel:'Ürün Eklendi: '+k,old:null,new:(v.ad||k)+' x'+v.adet,type:'added'}); });
  Object.keys(om).forEach(k=>{ const v=om[k]; if(!nm[k]) c.push({field:'urunler.'+k,fieldLabel:'Ürün Silindi: '+k,old:(v.ad||k)+' x'+v.adet,new:null,type:'removed'}); });
  Object.keys(nm).forEach(k=>{ const o=om[k]; if(!o)return; const v=nm[k]; if(o.adet!==v.adet) c.push({field:'urunler.'+k+'.adet',fieldLabel:k+' Adet',old:o.adet,new:v.adet,type:'modified'}); if(o.alisFiyati!==v.alisFiyati) c.push({field:'urunler.'+k+'.alis',fieldLabel:k+' Alış',old:ft(o.alisFiyati),new:ft(v.alisFiyati),type:'modified'}); });
  return c; }

function diffPay(op:any[]=[],np:any[]=[],t:string):ChangeSetItem[]{ const c:ChangeSetItem[]=[]; const lb=t==='pesinatlar'?'Peşinat':t==='havaleler'?'Havale':'Kart Ödeme'; const fm=(p:any)=>p?.banka?ft(p.tutar)+' ('+p.banka+(p.taksit?' '+p.taksit+'T':'')+')':ft(p?.tutar||p?.miktar);
  const mx=Math.max(op.length,np.length); for(let i=0;i<mx;i++){ const o=op[i],n=np[i]; if(!o&&n) c.push({field:t+'['+i+']',fieldLabel:lb+' Eklendi',old:null,new:fm(n),type:'added'}); else if(o&&!n) c.push({field:t+'['+i+']',fieldLabel:lb+' Silindi',old:fm(o),new:null,type:'removed'}); else if(o&&n&&!deq(o,n)) c.push({field:t+'['+i+']',fieldLabel:lb+' Güncellendi',old:fm(o),new:fm(n),type:'modified'}); } return c; }

export function calculateDiff(o:Record<string,any>,n:Record<string,any>):{actionType:ActionType;changeSet:ChangeSetItem[]}{ const all:ChangeSetItem[]=[]; const sc=diffS(o,n); all.push(...sc); const pc=diffP(o.urunler,n.urunler); all.push(...pc); const pe=diffPay(o.pesinatlar,n.pesinatlar,'pesinatlar'); all.push(...pe); const ha=diffPay(o.havaleler,n.havaleler,'havaleler'); all.push(...ha); const ka=diffPay(o.kartOdemeler,n.kartOdemeler,'kartOdemeler'); all.push(...ka);
  const pay=pe.length+ha.length+ka.length>0; let at:ActionType='UPDATE';
  if(sc.some(c=>['odemeDurumu','onayDurumu','teslimatDurumu'].includes(c.field))&&all.length<=2) at='STATUS_CHANGE';
  if(pay&&pc.length===0&&sc.length<=1) at='PAYMENT_UPDATE'; if(pc.length>0&&!pay&&sc.length<=1) at='PRODUCTS_UPDATE';
  if(n.silindi===true&&o.silindi!==true) at='DELETE'; return{actionType:at,changeSet:all}; }

function buildSum(at:ActionType,cs:ChangeSetItem[]):string{ if(at==='CREATE')return'Satış oluşturuldu'; if(at==='DELETE')return'Satış silindi'; if(at==='CANCEL')return'Satış iptal edildi';
  if(at==='STATUS_CHANGE'){const s=cs.find(c=>['odemeDurumu','onayDurumu'].includes(c.field)); return s?s.fieldLabel+': '+(s.old||'-')+' → '+(s.new||'-'):'Durum değişti';}
  const a=cs.filter(c=>c.type==='added').length,r=cs.filter(c=>c.type==='removed').length,m=cs.filter(c=>c.type==='modified').length;
  if(at==='PAYMENT_UPDATE'){const p:string[]=[];if(a)p.push(a+' ödeme eklendi');if(r)p.push(r+' ödeme silindi');if(m)p.push(m+' güncellendi');return p.join(', ')||'Ödeme güncellendi';}
  if(at==='PRODUCTS_UPDATE'){const p:string[]=[];if(a)p.push(a+' ürün eklendi');if(r)p.push(r+' ürün silindi');if(m)p.push(m+' güncellendi');return p.join(', ')||'Ürünler güncellendi';}
  return cs.length+' alan güncellendi'; }

export async function writeSatisAuditLog(p:{saleId:string;satisKodu:string;dbPath:string;branchId:string;branchName?:string;oldData:Record<string,any>;newData:Record<string,any>;userId:string;userName:string;actionType?:ActionType;}):Promise<void>{
  let cs:ChangeSetItem[]=[],at:ActionType=p.actionType||'UPDATE';
  if(p.actionType==='CREATE'){ cs=[{field:'satisKodu',fieldLabel:'Satış Kodu',old:null,new:p.satisKodu,type:'added'},{field:'toplamTutar',fieldLabel:'Toplam Tutar',old:null,new:ft(p.newData.toplamTutar||p.newData.manuelSatisTutari),type:'added'},{field:'musteri',fieldLabel:'Müşteri',old:null,new:p.newData.musteriBilgileri?.isim||p.newData.musteriIsim||'-',type:'added'},...(p.newData.urunler||[]).map((u:any)=>({field:'urunler.'+u.kod,fieldLabel:'Ürün: '+u.kod,old:null,new:(u.ad||u.kod)+' x'+u.adet,type:'added' as const}))]; }
  else if(p.actionType==='DELETE'){ cs=[{field:'silindi',fieldLabel:'Satış Silindi',old:false,new:true,type:'removed'}]; }
  else{ const d=calculateDiff(p.oldData,p.newData); cs=d.changeSet; if(!p.actionType)at=d.actionType; }
  if(cs.length===0)return;
  try{ await addDoc(collection(db,'satisAuditLogs'),{saleId:p.saleId,satisKodu:p.satisKodu,actionType:at,changedAt:Timestamp.now(),changedByUserId:p.userId,changedByUserName:p.userName,branchId:p.branchId,branchName:p.branchName||p.branchId,dbPath:p.dbPath,changeSet:cs,summary:buildSum(at,cs)}); }catch(e){console.error('Audit log yazma hatası:',e);} }

export async function getSatisAuditLogs(saleId:string):Promise<SatisAuditLog[]>{ try{ const q=query(collection(db,'satisAuditLogs'),where('saleId','==',saleId),orderBy('changedAt','desc')); const s=await getDocs(q); return s.docs.map(d=>({id:d.id,...d.data()} as SatisAuditLog)); }catch(e){console.error(e);return[];} }

export async function getFilteredAuditLogs(f:{startDate?:Date;endDate?:Date;branchId?:string;userId?:string;}):Promise<SatisAuditLog[]>{ try{ const q=query(collection(db,'satisAuditLogs'),orderBy('changedAt','desc')); const s=await getDocs(q); let l=s.docs.map(d=>({id:d.id,...d.data()} as SatisAuditLog));
  if(f.startDate){const t=f.startDate.getTime();l=l.filter(x=>(x.changedAt?.toDate?.()?.getTime()||0)>=t);}
  if(f.endDate){const t=f.endDate.getTime();l=l.filter(x=>(x.changedAt?.toDate?.()?.getTime()||0)<=t);}
  if(f.branchId&&f.branchId!=='TUMU')l=l.filter(x=>x.branchId===f.branchId);
  if(f.userId&&f.userId!=='TUMU')l=l.filter(x=>x.changedByUserId===f.userId);
  return l; }catch(e){console.error(e);return[];} }