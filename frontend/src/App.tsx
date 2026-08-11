import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AuthProvider } from "@/auth/AuthContext";
import { RequireAuth } from "@/auth/RequireAuth";
import { Landing } from "@/pages/Landing";
import { Login } from "@/pages/Login";
import { MapViewHost } from "@/pages/MapViewHost";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/map"
            element={
              <RequireAuth>
                <MapViewHost />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Landing />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}