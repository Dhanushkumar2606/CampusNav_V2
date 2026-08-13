import { Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AuthProvider } from "@/auth/AuthContext";
import { RequireAuth } from "@/auth/RequireAuth";
import { ToastProvider } from "@/components/ui/toast";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { lazyNamed } from "@/lib/lazy-named";

// Heavy pages are code-split; each loads on first visit and stays cached.
const Landing = lazyNamed(() => import("@/pages/Landing"), "Landing");
const Login = lazyNamed(() => import("@/pages/Login"), "Login");
const MapViewHost = lazyNamed(() => import("@/pages/MapViewHost"), "MapViewHost");
const Explore = lazyNamed(() => import("@/pages/Explore"), "Explore");
const Assistant = lazyNamed(() => import("@/pages/Assistant"), "Assistant");
const Saved = lazyNamed(() => import("@/pages/Saved"), "Saved");
const Profile = lazyNamed(() => import("@/pages/Profile"), "Profile");

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<LoadingScreen />}>
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
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}