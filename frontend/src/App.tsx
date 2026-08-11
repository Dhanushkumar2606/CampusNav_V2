import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AuthProvider } from "@/auth/AuthContext";
import { RequireAuth } from "@/auth/RequireAuth";
import { ToastProvider } from "@/components/ui/toast";
import { AppShell } from "@/components/layout/AppShell";
import { Landing } from "@/pages/Landing";
import { Login } from "@/pages/Login";
import { MapViewHost } from "@/pages/MapViewHost";
import { Explore } from "@/pages/Explore";
import { Assistant } from "@/pages/Assistant";
import { Saved } from "@/pages/Saved";
import { Profile } from "@/pages/Profile";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route path="/map" element={<MapViewHost />} />
              <Route path="/explore" element={<Explore />} />
              <Route path="/assistant" element={<Assistant />} />
              <Route path="/saved" element={<Saved />} />
              <Route path="/profile" element={<Profile />} />
            </Route>
            <Route path="*" element={<Landing />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
