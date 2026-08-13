import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, UserRound, Save, Loader2, Ruler, Zap, Moon, Sun } from "lucide-react";

import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { getPreferences, updatePreferences } from "@/api/search";
import type { PreferencesOut } from "@/lib/navigation-types";
import { useTheme } from "@/context/ThemeContext";

export function Profile() {
  const { user, status, logout, getToken } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [prefs, setPrefs] = useState<PreferencesOut | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fetchPrefs = async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const data = await getPreferences(token);
      setPrefs(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (status === "authenticated") fetchPrefs();
  }, [status, user]);

  const handleSave = async () => {
    const token = await getToken();
    if (!token || !prefs) return;
    setSaving(true);
    try {
      await updatePreferences(token, {
        units: prefs.units,
        default_mode: prefs.default_mode,
        default_avoid_stairs: prefs.default_avoid_stairs,
        default_require_accessible: prefs.default_require_accessible,
        theme: prefs.theme,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

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
        {/* Account */}
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

        {/* Preferences */}
        <Card className="border-brand-muted bg-brand-navy/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wider text-brand-subtle">
              <Ruler className="size-4" /> Preferences
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {prefs && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="units">Units</Label>
                  <Select value={prefs.units} onValueChange={(v) => setPrefs({ ...prefs, units: v as "metric" | "imperial" })}>
                    <SelectTrigger id="units"><SelectValue placeholder="Units" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="metric">Metric (meters, km)</SelectItem>
                      <SelectItem value="imperial">Imperial (feet, miles)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="default_mode">Default routing mode</Label>
                  <Select value={prefs.default_mode} onValueChange={(v) => setPrefs({ ...prefs, default_mode: v as "shortest" | "fastest" })}>
                    <SelectTrigger id="default_mode"><SelectValue placeholder="Mode" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shortest"><Zap className="size-3 mr-2" /> Shortest distance</SelectItem>
                      <SelectItem value="fastest"><Zap className="size-3 mr-2" /> Fastest time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Separator className="bg-brand-muted" />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-medium">Avoid stairs by default</Label>
                      <p className="text-xs text-brand-subtle">Prefer routes without stairs when available</p>
                    </div>
                    <Switch
                      checked={prefs.default_avoid_stairs}
                      onCheckedChange={(v) => setPrefs({ ...prefs, default_avoid_stairs: v })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-medium">Require accessible routes</Label>
                      <p className="text-xs text-brand-subtle">Only show routes marked as accessible (unverified)</p>
                    </div>
                    <Switch
                      checked={prefs.default_require_accessible}
                      onCheckedChange={(v) => setPrefs({ ...prefs, default_require_accessible: v })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-medium">Dark theme</Label>
                      <p className="text-xs text-brand-subtle">Toggle dark/light theme</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={toggleTheme} className="h-8">
                      {theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
                    </Button>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    variant="default"
                    onClick={handleSave}
                    disabled={saving}
                    className="gap-2"
                  >
                    {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    {saved ? "Saved!" : "Save preferences"}
                  </Button>
                </div>
              </>
            )}
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