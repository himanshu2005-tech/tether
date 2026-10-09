import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import Layout from './components/Layout';
import Login from './components/Login';
import Register from './components/Register';
import ForgotPassword from './components/ForgotPassword';
import Home from './components/Home';
import Dashboard from './components/Dashboard';
import Profile from './components/Profile';
import ProtectedRoute from './components/ProtectedRoute';
import MyProducts from './components/MyProducts';
import CompanyLimits from './components/CompanyLimits';
import SupplierRequests from './components/SupplierRequests';
import MyOrders from './components/MyOrders';
import Payments from './components/Payments';
import Checkout from './components/Checkout';
import Tenders from './components/Tenders';
import TenderDetail from './components/TenderDetail';
import Contracts from './components/Contracts';
import RiskCenter from './components/RiskCenter';

import AuthLayout from './components/AuthLayout';
import Approvals from './components/Approvals';
import Bids from './components/Bids';
import Suppliers from './components/Suppliers';
import Verification from './components/Verification';
import Fraud from './components/Fraud';
import Analytics from './components/Analytics';
import AuditTrail from './components/AuditTrail';
import Settings from './components/Settings';
import SupplierInvoices from './components/SupplierInvoices';
import NotificationsPage from './components/Notifications';

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <Routes>
            {/* Main App Routes */}
            <Route element={<Layout />}>
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Home />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/search"
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <Profile />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/my-products"
                element={
                  <ProtectedRoute>
                    <MyProducts />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/company-limits"
                element={
                  <ProtectedRoute>
                    <CompanyLimits />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/requests"
                element={
                  <ProtectedRoute>
                    <SupplierRequests />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/my-orders"
                element={
                  <ProtectedRoute>
                    <MyOrders />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/payments"
                element={
                  <ProtectedRoute>
                    <Payments />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/checkout/:billId"
                element={
                  <ProtectedRoute>
                    <Checkout />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/tenders"
                element={
                  <ProtectedRoute>
                    <Tenders />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/tenders/:tenderId"
                element={
                  <ProtectedRoute>
                    <TenderDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/contracts"
                element={
                  <ProtectedRoute>
                    <Contracts />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/risk"
                element={
                  <ProtectedRoute>
                    <RiskCenter />
                  </ProtectedRoute>
                }
              />
              <Route path="/approvals" element={<ProtectedRoute><Approvals /></ProtectedRoute>} />
              <Route path="/bids" element={<ProtectedRoute><Bids /></ProtectedRoute>} />
              <Route path="/suppliers" element={<ProtectedRoute><Suppliers /></ProtectedRoute>} />
              <Route path="/verification" element={<ProtectedRoute><Verification /></ProtectedRoute>} />
              <Route path="/fraud" element={<ProtectedRoute><Fraud /></ProtectedRoute>} />
              <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
              <Route path="/audit" element={<ProtectedRoute><AuditTrail /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              <Route path="/my-invoices" element={<ProtectedRoute><SupplierInvoices /></ProtectedRoute>} />
              <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
            </Route>

            {/* Auth Routes */}
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
            </Route>
          </Routes>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
