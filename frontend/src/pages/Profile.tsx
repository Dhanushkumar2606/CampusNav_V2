import { LogOut, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/** Profile — account info + preferences (preferences UI lands in Phase 4). */
export function Profile() {
  const { user, status, logout } = useAuth();
  const navigate = useNavigate();

  if (status !== "authenticated" || !user) {
    return (
      <div className="h-full overflow-y-auto p-4 md:p-6">
        <EmptyState
          icon={UserRound}
          title="Not signed in"
          description="Sign in to manage your profile and preferences."
          action={
            <Button variant="outline" size="sm" onClick={() => navigate("/login")}>
              Sign in
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <h1 className="text-lg font-semibold text-brand-text">Profile</h1>

      <div className="mt-6 max-w-xl space-y-4">
        <Card className="border-brand-muted bg-brand-navy/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wider text-brand-subtle">
              <UserRound className="size-4" /> Account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-brand-subtle">Name</span>
              <span className="font-medium text-brand-text">{user.full_name}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-brand-subtle">Email</span>
              <span className="font-medium text-brand-text">{user.email}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-brand-subtle">Role</span>
              <span className="font-medium capitalize text-brand-text">{user.role}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-brand-subtle">Member since</span>
              <span className="font-medium text-brand-text">
                {new Date(user.created_at).toLocaleDateString()}
              </span>
            </div>
          </CardContent>
        </Card>

        <Button
          variant="outline"
          onClick={() => {
            logout();
            navigate("/", { replace: true });
          }}
        >
          <LogOut className="size-4" aria-hidden />
          Sign out
        </Button>
      </div>
    </div>
  );
}
