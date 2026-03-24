import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ToastProvider } from "./components/Toast.jsx";
import { ThemeProvider } from "./theme.jsx";
import Login from "./pages/Login.jsx";
import { ForgotPassword, ResetPassword } from "./pages/Auth.jsx";
import Agent from "./pages/Agent.jsx";
import Approvals from "./pages/Approvals.jsx";
import Admin from "./pages/Admin.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Settings from "./pages/Settings.jsx";
import "./index.css";

const AuthRoute = ({ children, roles }) => {
  const token = localStorage.getItem("token");
  const role  = localStorage.getItem("role");
  if (!token) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(role)) return <Navigate to="/login" replace />;
  return children;
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <ThemeProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login"           element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password"  element={<ResetPassword />} />
          <Route path="/agent"     element={<AuthRoute roles={["agent"]}><Agent /></AuthRoute>} />
          <Route path="/approvals" element={<AuthRoute roles={["team_lead","division_manager","sales_director"]}><Approvals /></AuthRoute>} />
          <Route path="/admin"     element={<AuthRoute roles={["admin"]}><Admin /></AuthRoute>} />
          <Route path="/dashboard" element={<AuthRoute roles={["sales_director","division_manager","admin"]}><Dashboard /></AuthRoute>} />
          <Route path="/settings"  element={<AuthRoute><Settings /></AuthRoute>} />
          <Route path="*"          element={<Navigate to="/login" replace />} />
        </Routes>
      </ToastProvider>
    </ThemeProvider>
  </BrowserRouter>
);
