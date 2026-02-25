import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getSubeByKod, SubeKodu } from '../types/sube';
import NotificationBell from './NotificationBell';
import './Layout.css';

interface LayoutProps {
  children: React.ReactNode;
  pageTitle: string;
  headerExtra?: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children, pageTitle, headerExtra }) => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isAdmin = currentUser?.role?.toString().trim().toUpperCase() === 'ADMIN';
  const kullaniciAdi = currentUser?.ad || '';
  const kullaniciSoyadi = currentUser?.soyad || '';
  const kullaniciSube = getSubeByKod(currentUser?.subeKodu as SubeKodu)?.ad || '';

  // Sayfa değişince sidebar'ı kapat
  useEffect(() => { 
    setSidebarOpen(false); 
  }, [location.pathname]);

  // Sidebar açıkken body scroll'u engelle
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Çıkış yapılamadı:', error);
    }
  };

  const isActive = (path: string) => location.pathname === path;
  const isActivePrefix = (prefix: string) => location.pathname.startsWith(prefix);

  // Herkesin gördüğü menü öğeleri
  const navItems = [
    { path: '/dashboard',       icon: 'fa-chart-line',     label: 'SATIŞLAR' },
    { path: '/satis-teklif',    icon: 'fa-plus-circle',    label: 'YENİ SATIŞ TEKLİFİ' },
    { path: '/bekleyen-urunler',icon: 'fa-clock',          label: 'İLERİ TESLİM' },
    { path: '/kasa',            icon: 'fa-cash-register',  label: 'KASA' },
    { path: '/ciro/performans', icon: 'fa-tachometer-alt', label: 'CİRO/PERFORMANS' },
  ];

  return (
    <div className="layout-container">
      {/* Overlay - mobilde sidebar açıkken gözükür */}
      <div
        className={`layout-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar - açık/kapalı state'e göre className alır */}
      <aside className={`layout-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h1>TÜFEKÇİ HOME<span>SIEMENS</span></h1>
        </div>

        <nav className="sidebar-nav">
          {/* Herkesin gördüğü linkler */}
          {navItems.map(item => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`sidebar-nav-item ${
                item.path === '/ciro/performans'
                  ? isActivePrefix('/ciro') ? 'active' : ''
                  : isActive(item.path) ? 'active' : ''
              }`}
            >
              <i className={`fas ${item.icon}`}></i>
              {item.label}
            </button>
          ))}

          {/* Sadece ADMIN görür */}
          {isAdmin && (
            <>
              <button
                onClick={() => navigate('/kontrol')}
                className={`sidebar-nav-item ${isActive('/kontrol') ? 'active' : ''}`}
              >
                <i className="fas fa-check-circle"></i>
                KONTROL ET
              </button>

              <button
                onClick={() => navigate('/admin')}
                className={`sidebar-nav-item ${isActive('/admin') ? 'active' : ''}`}
              >
                <i className="fas fa-shield-alt"></i>
                ADMIN PANEL
              </button>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-icon">
              {kullaniciAdi.charAt(0)}{kullaniciSoyadi.charAt(0)}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{kullaniciAdi} {kullaniciSoyadi}</div>
              <div className="sidebar-user-role">
                <span>{isAdmin ? 'Admin' : 'Çalışan'}</span>
                <span className="sidebar-user-sube">{kullaniciSube}</span>
              </div>
            </div>
          </div>
          <button onClick={handleLogout} className="sidebar-logout">
            <i className="fas fa-sign-out-alt"></i> ÇIKIŞ
          </button>
        </div>
      </aside>

      {/* Ana içerik */}
      <div className="layout-main">
        <header className="layout-header">
          <div className="layout-header-left">
            <button
              className="hamburger-btn"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Menüyü aç/kapat"
            >
              <i className={`fas ${sidebarOpen ? 'fa-times' : 'fa-bars'}`}></i>
            </button>
            <h2 className="layout-page-title">{pageTitle}</h2>
          </div>
          <div className="layout-header-right">
            {headerExtra}
            <NotificationBell />
          </div>
        </header>

        <main className="layout-content">
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;