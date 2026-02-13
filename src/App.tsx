import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
<<<<<<< Updated upstream
import Login from './Pages/Login';
import Register from './Pages/Register';
import Dashboard from './Pages/Dashboard';
import SatisTeklifPage from './Pages/SatisTeklifPage';
import BekleyenUrunlerPage from './Pages/BekleyenUrunlerPage';
import AdminPanel from './Pages/AdminPanel';
import SatisDetayPage from './Pages/SatisDetayPage';
=======
import Login from '../src/Pages/Login';
import Register from '../src/Pages/Register';
import Dashboard from '../src/Pages/Dashboard';
import SatisTeklifPage from '../src/Pages/SatisTeklifPage';
import BekleyenUrunlerPage from '../src/Pages/BekleyenUrunlerPage';
import AdminPanel from '../src/Pages/AdminPanel';
import SatisDetayPage from './Pages/Satisdetaypage ';
<<<<<<< Updated upstream
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
import './App.css';

const PrivateRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { currentUser } = useAuth();
  return currentUser ? children : <Navigate to="/login" />;
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/dashboard"
            element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            }
          />
          <Route
            path="/satis-teklif"
            element={
              <PrivateRoute>
                <SatisTeklifPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/satis-detay/:subeKodu/:id"
            element={
              <PrivateRoute>
                <SatisDetayPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/bekleyen-urunler"
            element={
              <PrivateRoute>
                <BekleyenUrunlerPage />
              </PrivateRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <PrivateRoute>
                <AdminPanel />
              </PrivateRoute>
            }
          />
          <Route path="/" element={<Navigate to="/login" />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;