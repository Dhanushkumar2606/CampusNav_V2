/**
 * Route guard. While auth status is `loading`, render a placeholder so
 * we don't redirect-and-bounce. Once `anonymous`, redirect to /login
 * (preserving the attempted location so we can return after login).
 */
import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { useAuth } from "@/auth/AuthContext";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-brand-deep text-brand-text">
        <Loader2 className="size-8 animate-spin text-brand-cyan" />
      </div>
    );
  }
  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}
