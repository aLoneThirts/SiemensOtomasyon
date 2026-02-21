import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './Pages/Login';
import Register from './Pages/Register';
import Dashboard from './Pages/Dashboard';
import SatisTeklifPage from './Pages/SatisTeklifPage';
import BekleyenUrunlerPage from './Pages/BekleyenUrunlerPage';
import AdminPanel from './Pages/AdminPanel';
import SatisDetayPage from './Pages/SatisDetayPage';
import Kasa from './Pages/Kasa';
import CiroPerformansPage from './Pages/CiroPerformans';
import SatisDuzenlePage from './Pages/SatisDuzenlePage';
import KontrolEt from './Pages/KontrolEt';
import './App.css';

const PrivateRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { currentUser } = useAuth();
  return currentUser ? children : <Navigate to="/login" replace />;
};

const AdminRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { currentUser } = useAuth();
  if (!currentUser) return <Navigate to="/login" replace />;
  const isAdmin = currentUser.role?.toString().trim().toUpperCase() === 'ADMIN';
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return children;
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          {/* PUBLIC */}
          <Route path="/login"    element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* PRIVATE */}
          <Route path="/dashboard"                   element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/satis-teklif"                element={<PrivateRoute><SatisTeklifPage /></PrivateRoute>} />
          <Route path="/satis-detay/:subeKodu/:id"   element={<PrivateRoute><SatisDetayPage /></PrivateRoute>} />
          <Route path="/satis-duzenle/:subeKodu/:id" element={<PrivateRoute><SatisDuzenlePage /></PrivateRoute>} />
          <Route path="/bekleyen-urunler"            element={<PrivateRoute><BekleyenUrunlerPage /></PrivateRoute>} />
          <Route path="/kasa"                        element={<PrivateRoute><Kasa /></PrivateRoute>} />
          <Route path="/ciro/performans"             element={<PrivateRoute><CiroPerformansPage /></PrivateRoute>} />

          {/* SADECE ADMİN */}
          <Route path="/kontrol" element={<AdminRoute><KontrolEt /></AdminRoute>} />
          <Route path="/admin"   element={<AdminRoute><AdminPanel /></AdminRoute>} />

          {/* DEFAULT */}
          <Route path="/"  element={<Navigate to="/login" replace />} />
          <Route path="*"  element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;