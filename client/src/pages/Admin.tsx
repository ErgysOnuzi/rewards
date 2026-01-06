import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Trophy, X, RotateCw, Users, ArrowUpFromLine, Check, Ban, 
  Search, Shield, AlertTriangle, Settings, Download, Database,
  Eye, Lock, LogOut, RefreshCw, Copy, FileDown, Activity, UserCheck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, safeJsonParse } from "@/lib/queryClient";

interface SpinLog {
  timestamp: string;
  stakeId: string;
  wageredAmount: number;
  spinNumber: number;
  result: "WIN" | "LOSE";
  prizeLabel: string;
}

interface AdminLogsResponse {
  logs: SpinLog[];
  totalSpins: number;
  totalWins: number;
}

interface WithdrawalRequest {
  id: number;
  stakeId: string;
  amount: number;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  processedAt: string | null;
  adminNotes: string | null;
}

interface UserFlag {
  id: number;
  stakeId: string;
  isBlacklisted: boolean;
  isAllowlisted: boolean;
  isDisputed: boolean;
  notes: string | null;
  updatedAt: string;
}

interface WeightedSheetStatus {
  sheetId: string;
  tabName: string;
  loaded: boolean;
  rowCount: number;
}

interface DataStatus {
  sheetId: string;
  tabName: string;
  loaded: boolean;
  rowCount: number;
  lastFetchTime: string | null;
  cacheTtlMs: number;
  cacheAge: number;
  isExpired: boolean;
  duplicateCount: number;
  duplicates: string[];
  backgroundRefreshActive: boolean;
  nextRefreshIn: number;
  weightedSheets?: {
    us: WeightedSheetStatus;
    com: WeightedSheetStatus;
    lastRefresh: string | null;
  };
}

interface RateStats {
  spinsLastHour: number;
  bonusDenials: number;
  topSpinners: { stakeId: string; count: number }[];
  ipAnomalies: { ipHash: string; stakeIds: string; idCount: number }[];
}

interface UserLookup {
  found: boolean;
  wagerData: { stakeId: string; wageredAmount: number; periodLabel: string } | null;
  sheetLastUpdated: string | null;
  computedTickets: number;
  localStats: {
    totalSpins: number;
    wins: number;
    lastSpinTime: string | null;
    walletBalance: number;
    spinBalances: { bronze: number; silver: number; gold: number };
  };
  flags: UserFlag | null;
  recentTransactions: { type: string; amount: number; description: string; createdAt: string }[];
}

interface FeatureToggles {
  [key: string]: { value: string; description: string };
}

interface Payout {
  id: number;
  stakeId: string;
  amount: number;
  prize: string | null;
  status: string;
  transactionHash: string | null;
  createdAt: string;
  processedAt: string | null;
}

interface ExportLog {
  id: number;
  campaign: string;
  weekLabel: string;
  ticketUnit: number;
  rowCount: number;
  totalTickets: number;
  dataHash: string | null;
  createdAt: string;
}

interface VerificationRequest {
  id: number;
  userId: string;
  stakeUsername: string;
  stakePlatform: string;
  betId: string;
  status: string;
  adminNotes: string | null;
  createdAt: string;
  processedAt: string | null;
  userEmail: string | null;
  userFirstName: string | null;
}

function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { toast } = useToast();

  const loginMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Login failed");
      }
      return res.json();
    },
    onSuccess: () => {
      onLogin();
      toast({ title: "Logged in", description: "Welcome to the admin panel" });
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Lock className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
          <CardTitle>Admin Access</CardTitle>
          <CardDescription>Enter the admin password to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); loginMutation.mutate(password); }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                data-testid="input-admin-password"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loginMutation.isPending} data-testid="button-admin-login">
              {loginMutation.isPending ? "Logging in..." : "Login"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Admin() {
  const { toast } = useToast();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [lookupId, setLookupId] = useState("");
  const [lookupResult, setLookupResult] = useState<UserLookup | null>(null);
  const [newFlag, setNewFlag] = useState({ stakeId: "", isBlacklisted: false, isAllowlisted: false, isDisputed: false, notes: "" });
  const [exportParams, setExportParams] = useState({ campaign: "", weekLabel: "", ticketUnit: 1000, wagerField: "Wagered_Weekly" });
  const [exportPreview, setExportPreview] = useState<any>(null);

  useEffect(() => {
    fetch("/api/admin/verify", { credentials: "include" })
      .then(res => res.json())
      .then(data => setIsAuthenticated(data.authenticated))
      .catch(() => setIsAuthenticated(false));
  }, []);

  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    setIsAuthenticated(false);
  };

  const { data: logsData, refetch: refetchLogs } = useQuery<AdminLogsResponse>({
    queryKey: ["/api/admin/logs"],
    enabled: isAuthenticated === true,
    refetchInterval: 10000,
  });

  const { data: withdrawalsData, refetch: refetchWithdrawals } = useQuery<{ withdrawals: WithdrawalRequest[] }>({
    queryKey: ["/api/admin/withdrawals"],
    enabled: isAuthenticated === true,
  });

  const { data: dataStatus, refetch: refetchStatus } = useQuery<DataStatus>({
    queryKey: ["/api/admin/data-status"],
    enabled: isAuthenticated === true,
  });

  const { data: rateStats, refetch: refetchRateStats } = useQuery<RateStats>({
    queryKey: ["/api/admin/rate-stats"],
    enabled: isAuthenticated === true,
  });

  const { data: userFlags, refetch: refetchFlags } = useQuery<{ flags: UserFlag[] }>({
    queryKey: ["/api/admin/user-flags"],
    enabled: isAuthenticated === true,
  });

  const { data: togglesData, refetch: refetchToggles } = useQuery<{ toggles: FeatureToggles }>({
    queryKey: ["/api/admin/toggles"],
    enabled: isAuthenticated === true,
  });

  const { data: payoutsData, refetch: refetchPayouts } = useQuery<{ payouts: Payout[] }>({
    queryKey: ["/api/admin/payouts"],
    enabled: isAuthenticated === true,
  });

  const { data: exportLogs } = useQuery<{ logs: ExportLog[] }>({
    queryKey: ["/api/admin/export/logs"],
    enabled: isAuthenticated === true,
  });

  const { data: verificationsData, refetch: refetchVerifications } = useQuery<{ verifications: VerificationRequest[] }>({
    queryKey: ["/api/admin/verifications"],
    enabled: isAuthenticated === true,
  });

  const pendingVerifications = verificationsData?.verifications?.filter(v => v.status === "pending") || [];

  const processVerification = useMutation({
    mutationFn: async ({ id, status, admin_notes }: { id: number; status: "approved" | "rejected"; admin_notes?: string }) => {
      return apiRequest("POST", "/api/admin/verifications/process", { id, status, admin_notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/verifications"] });
      toast({ title: "Verification processed" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to process verification", description: err.message, variant: "destructive" });
    },
  });

  const processWithdrawal = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "approved" | "rejected" }) => {
      return apiRequest("POST", "/api/admin/withdrawals/process", { id, status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/withdrawals"] });
      toast({ title: "Withdrawal processed" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to process withdrawal", description: err.message, variant: "destructive" });
    },
  });

  const refreshCache = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/refresh-cache", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed to refresh");
      return res.json();
    },
    onSuccess: (data) => {
      refetchStatus();
      toast({ title: "Cache refreshed", description: `Loaded ${data.rowCount} rows` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to refresh cache", description: err.message, variant: "destructive" });
    },
  });

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const resetData = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/reset-data", { 
        method: "POST", 
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESET_ALL_DATA" })
      });
      if (!res.ok) throw new Error("Failed to reset data");
      return res.json();
    },
    onSuccess: (data) => {
      setShowResetConfirm(false);
      toast({ title: "Data Reset Complete", description: data.message });
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to reset data", description: err.message, variant: "destructive" });
    },
  });

  const userLookup = async () => {
    if (!lookupId.trim()) return;
    const res = await fetch(`/api/admin/user-lookup/${encodeURIComponent(lookupId)}`, { credentials: "include" });
    const data = await res.json();
    setLookupResult(data);
  };

  const saveFlag = useMutation({
    mutationFn: async (flag: typeof newFlag) => {
      return apiRequest("POST", "/api/admin/user-flags", flag);
    },
    onSuccess: () => {
      refetchFlags();
      setNewFlag({ stakeId: "", isBlacklisted: false, isAllowlisted: false, isDisputed: false, notes: "" });
      toast({ title: "Flag saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save flag", description: err.message, variant: "destructive" });
    },
  });

  const deleteFlag = useMutation({
    mutationFn: async (stakeId: string) => {
      const res = await fetch(`/api/admin/user-flags/${encodeURIComponent(stakeId)}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete flag");
    },
    onSuccess: () => {
      refetchFlags();
      toast({ title: "Flag removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove flag", description: err.message, variant: "destructive" });
    },
  });

  const updateToggle = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      return apiRequest("POST", "/api/admin/toggles", { key, value });
    },
    onSuccess: () => {
      refetchToggles();
      toast({ title: "Toggle updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update toggle", description: err.message, variant: "destructive" });
    },
  });

  const generateExport = async () => {
    const res = await fetch("/api/admin/export/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exportParams),
      credentials: "include",
    });
    const data = await res.json();
    
    const csv = "stake_id,tickets,campaign,week_label,generated_at\n" + 
      data.entries.map((e: any) => `${e.stake_id},${e.tickets},${e.campaign},${e.week_label},${e.generated_at}`).join("\n");
    
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `raffle_export_${exportParams.campaign}_${exportParams.weekLabel}.csv`;
    a.click();
    
    queryClient.invalidateQueries({ queryKey: ["/api/admin/export/logs"] });
    toast({ title: "Export generated", description: `${data.rowCount} entries, ${data.totalTickets} tickets` });
  };

  const previewExport = async () => {
    const res = await fetch("/api/admin/export/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exportParams),
      credentials: "include",
    });
    const data = await res.json();
    setExportPreview(data);
  };

  const downloadBackup = async () => {
    const res = await fetch("/api/admin/backup-export", { credentials: "include" });
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup_${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    toast({ title: "Backup downloaded" });
  };

  const formatDate = (iso: string) => new Date(iso).toLocaleString();
  const formatAmount = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(n);

  if (isAuthenticated === null) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
  }

  if (!isAuthenticated) {
    return <AdminLogin onLogin={() => setIsAuthenticated(true)} />;
  }

  const pendingWithdrawals = withdrawalsData?.withdrawals.filter(w => w.status === "pending") || [];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Admin Control Panel</h1>
            <p className="text-muted-foreground">Manage users, exports, and system settings</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="icon" onClick={() => { refetchLogs(); refetchWithdrawals(); refetchStatus(); refetchRateStats(); }} data-testid="button-refresh-all">
              <RotateCw className="w-4 h-4" />
            </Button>
            <Button variant="outline" onClick={logout} data-testid="button-logout">
              <LogOut className="w-4 h-4 mr-2" /> Logout
            </Button>
            <Link href="/">
              <Button variant="outline" data-testid="link-home">Back to Site</Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-muted"><RotateCw className="w-5 h-5 text-muted-foreground" /></div>
                <div>
                  <p className="text-2xl font-bold font-mono">{logsData?.totalSpins ?? 0}</p>
                  <p className="text-sm text-muted-foreground">Total Spins</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-primary/10"><Trophy className="w-5 h-5 text-primary" /></div>
                <div>
                  <p className="text-2xl font-bold font-mono text-primary">{logsData?.totalWins ?? 0}</p>
                  <p className="text-sm text-muted-foreground">Total Wins</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-muted"><Activity className="w-5 h-5 text-muted-foreground" /></div>
                <div>
                  <p className="text-2xl font-bold font-mono">{rateStats?.spinsLastHour ?? 0}</p>
                  <p className="text-sm text-muted-foreground">Spins/Hour</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-yellow-500/10"><ArrowUpFromLine className="w-5 h-5 text-yellow-500" /></div>
                <div>
                  <p className="text-2xl font-bold font-mono text-yellow-500">{pendingWithdrawals.length}</p>
                  <p className="text-sm text-muted-foreground">Pending Withdrawals</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="status">
          <div className="overflow-x-auto -mx-4 px-4 pb-2">
            <TabsList className="inline-flex min-w-max">
              <TabsTrigger value="status" data-testid="tab-status" className="text-xs sm:text-sm"><Database className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline"> Data</span></TabsTrigger>
              <TabsTrigger value="lookup" data-testid="tab-lookup" className="text-xs sm:text-sm"><Search className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline"> Lookup</span></TabsTrigger>
              <TabsTrigger value="flags" data-testid="tab-flags" className="text-xs sm:text-sm"><Shield className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline"> Flags</span></TabsTrigger>
              <TabsTrigger value="rate" data-testid="tab-rate" className="text-xs sm:text-sm"><AlertTriangle className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline"> Abuse</span></TabsTrigger>
              <TabsTrigger value="withdrawals" data-testid="tab-withdrawals" className="text-xs sm:text-sm">
                <ArrowUpFromLine className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline"> Withdrawals</span>
                {pendingWithdrawals.length > 0 && <Badge variant="destructive" className="ml-1 text-xs">{pendingWithdrawals.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="export" data-testid="tab-export" className="text-xs sm:text-sm"><Download className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline"> Export</span></TabsTrigger>
              <TabsTrigger value="toggles" data-testid="tab-toggles" className="text-xs sm:text-sm"><Settings className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline"> Toggles</span></TabsTrigger>
              <TabsTrigger value="spins" data-testid="tab-spins" className="text-xs sm:text-sm"><Eye className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline"> Spins</span></TabsTrigger>
              <TabsTrigger value="verifications" data-testid="tab-verifications" className="text-xs sm:text-sm">
                <UserCheck className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline"> Verify</span>
                {pendingVerifications.length > 0 && <Badge variant="destructive" className="ml-1 text-xs">{pendingVerifications.length}</Badge>}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="status" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                <div>
                  <CardTitle className="text-lg sm:text-xl">NGR Sheet (Lifetime Data)</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">Shows lifetime wagered amounts for display purposes only</p>
                </div>
                <Button onClick={() => refreshCache.mutate()} disabled={refreshCache.isPending} size="sm" data-testid="button-refresh-cache">
                  <RefreshCw className={`w-4 h-4 mr-2 ${refreshCache.isPending ? "animate-spin" : ""}`} />
                  Refresh Cache
                </Button>
              </CardHeader>
              <CardContent className="grid md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-2">
                  <div><span className="text-muted-foreground">Sheet ID:</span> <span className="break-all">{dataStatus?.sheetId}</span></div>
                  <div><span className="text-muted-foreground">Tab:</span> {dataStatus?.tabName}</div>
                  <div><span className="text-muted-foreground">Rows Loaded:</span> {dataStatus?.rowCount ?? 0}</div>
                  <div><span className="text-muted-foreground">Cache TTL:</span> {dataStatus?.cacheTtlMs ? `${dataStatus.cacheTtlMs / 1000}s` : "N/A"}</div>
                </div>
                <div className="space-y-2">
                  <div><span className="text-muted-foreground">Last Fetch:</span> {dataStatus?.lastFetchTime ? formatDate(dataStatus.lastFetchTime) : "Never"}</div>
                  <div><span className="text-muted-foreground">Cache Age:</span> {dataStatus?.cacheAge ? `${Math.round(dataStatus.cacheAge / 1000)}s` : "N/A"}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground">Status:</span>
                    <Badge variant={dataStatus?.isExpired ? "destructive" : "default"}>{dataStatus?.isExpired ? "Expired" : "Fresh"}</Badge>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground">Auto-Refresh:</span>
                    <Badge variant={dataStatus?.backgroundRefreshActive ? "default" : "secondary"}>{dataStatus?.backgroundRefreshActive ? "Active" : "Inactive"}</Badge>
                    {dataStatus?.backgroundRefreshActive && dataStatus.nextRefreshIn > 0 && (
                      <span className="text-xs text-muted-foreground">(next in {Math.round(dataStatus.nextRefreshIn / 1000)}s)</span>
                    )}
                  </div>
                  <div><span className="text-muted-foreground">Duplicates:</span> {dataStatus?.duplicateCount ?? 0}</div>
                </div>
                {dataStatus?.duplicates && dataStatus.duplicates.length > 0 && (
                  <div className="md:col-span-2">
                    <p className="text-sm text-destructive">Duplicate usernames: {dataStatus.duplicates.join(", ")}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {dataStatus?.weightedSheets && (
              <div className="grid md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Database className="w-4 h-4" />
                      Weighted Sheet (US)
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">Used to calculate tickets for Stake.us users</p>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div><span className="text-muted-foreground">Sheet ID:</span> <span className="break-all">{dataStatus.weightedSheets.us.sheetId}</span></div>
                    <div><span className="text-muted-foreground">Tab:</span> {dataStatus.weightedSheets.us.tabName}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-muted-foreground">Status:</span>
                      <Badge variant={dataStatus.weightedSheets.us.loaded ? "default" : "destructive"}>
                        {dataStatus.weightedSheets.us.loaded ? "Loaded" : "Not Loaded"}
                      </Badge>
                    </div>
                    <div><span className="text-muted-foreground">Rows Loaded:</span> {dataStatus.weightedSheets.us.rowCount}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-muted-foreground">Auto-Refresh:</span>
                      <Badge variant={dataStatus?.backgroundRefreshActive ? "default" : "secondary"}>
                        {dataStatus?.backgroundRefreshActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Database className="w-4 h-4" />
                      Weighted Sheet (COM)
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">Used to calculate tickets for Stake.com users</p>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div><span className="text-muted-foreground">Sheet ID:</span> <span className="break-all">{dataStatus.weightedSheets.com.sheetId}</span></div>
                    <div><span className="text-muted-foreground">Tab:</span> {dataStatus.weightedSheets.com.tabName}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-muted-foreground">Status:</span>
                      <Badge variant={dataStatus.weightedSheets.com.loaded ? "default" : "destructive"}>
                        {dataStatus.weightedSheets.com.loaded ? "Loaded" : "Not Loaded"}
                      </Badge>
                    </div>
                    <div><span className="text-muted-foreground">Rows Loaded:</span> {dataStatus.weightedSheets.com.rowCount}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-muted-foreground">Auto-Refresh:</span>
                      <Badge variant={dataStatus?.backgroundRefreshActive ? "default" : "secondary"}>
                        {dataStatus?.backgroundRefreshActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                {dataStatus.weightedSheets.lastRefresh && (
                  <div className="md:col-span-2 text-sm text-muted-foreground">
                    Last weighted data refresh: {formatDate(dataStatus.weightedSheets.lastRefresh)}
                  </div>
                )}
              </div>
            )}

            <Card className="border-destructive/50">
              <CardHeader>
                <CardTitle className="text-destructive flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  Danger Zone
                </CardTitle>
                <CardDescription>These actions cannot be undone</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 bg-muted rounded-lg text-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-muted-foreground">Current Environment:</span>
                    <Badge variant={window.location.hostname.includes('replit.app') || window.location.hostname.includes('lukerewards') ? "destructive" : "secondary"}>
                      {window.location.hostname.includes('replit.dev') ? "Development" : "Production"}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {window.location.hostname.includes('replit.dev') 
                      ? "You are in development mode. Reset will only affect the development database."
                      : "You are in production mode. Reset will affect the LIVE production database."}
                  </p>
                </div>
                {!showResetConfirm ? (
                  <Button 
                    variant="destructive" 
                    onClick={() => setShowResetConfirm(true)}
                    data-testid="button-reset-data"
                  >
                    Reset All User Data
                  </Button>
                ) : (
                  <div className="space-y-3 p-4 bg-destructive/10 rounded-lg">
                    <p className="text-sm text-destructive font-medium">
                      This will permanently delete all spin logs, wallets, withdrawals, and user data
                      {!window.location.hostname.includes('replit.dev') && " from the PRODUCTION database"}.
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      <Button 
                        variant="destructive" 
                        onClick={() => resetData.mutate()}
                        disabled={resetData.isPending}
                        data-testid="button-confirm-reset"
                      >
                        {resetData.isPending ? "Resetting..." : "Yes, Reset Everything"}
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => setShowResetConfirm(false)}
                        data-testid="button-cancel-reset"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="lookup" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>User Lookup</CardTitle>
                <CardDescription>Search for a Stake ID to view all details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input 
                    placeholder="Enter Stake ID" 
                    value={lookupId} 
                    onChange={(e) => setLookupId(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && userLookup()}
                    className="flex-1"
                    data-testid="input-lookup-id"
                  />
                  <Button onClick={userLookup} className="shrink-0" data-testid="button-lookup">
                    <Search className="w-4 h-4 mr-2" /> Lookup
                  </Button>
                </div>

                {lookupResult && (
                  <div className="space-y-4 pt-4 border-t">
                    {!lookupResult.found ? (
                      <div className="text-destructive">User not found in sheet data</div>
                    ) : (
                      <>
                        <div className="grid md:grid-cols-2 gap-4 text-sm">
                          <div className="space-y-1">
                            <h4 className="font-medium mb-2">Sheet Data</h4>
                            <div><span className="text-muted-foreground">Stake ID:</span> {lookupResult.wagerData?.stakeId}</div>
                            <div><span className="text-muted-foreground">Wagered:</span> {formatAmount(lookupResult.wagerData?.wageredAmount ?? 0)}</div>
                            <div><span className="text-muted-foreground">Period:</span> {lookupResult.wagerData?.periodLabel}</div>
                            <div><span className="text-muted-foreground">Tickets:</span> {lookupResult.computedTickets}</div>
                            <div><span className="text-muted-foreground">Last Updated:</span> {lookupResult.sheetLastUpdated ? formatDate(lookupResult.sheetLastUpdated) : "N/A"}</div>
                          </div>
                          <div className="space-y-1">
                            <h4 className="font-medium mb-2">Local Stats</h4>
                            <div><span className="text-muted-foreground">Spins:</span> {lookupResult.localStats.totalSpins}</div>
                            <div><span className="text-muted-foreground">Wins:</span> {lookupResult.localStats.wins}</div>
                            <div><span className="text-muted-foreground">Wallet:</span> {formatAmount(lookupResult.localStats.walletBalance)}</div>
                            <div><span className="text-muted-foreground">Bronze:</span> {lookupResult.localStats.spinBalances.bronze}</div>
                            <div><span className="text-muted-foreground">Silver:</span> {lookupResult.localStats.spinBalances.silver}</div>
                            <div><span className="text-muted-foreground">Gold:</span> {lookupResult.localStats.spinBalances.gold}</div>
                          </div>
                        </div>
                        {lookupResult.flags && (
                          <div className="flex gap-2 flex-wrap">
                            {lookupResult.flags.isBlacklisted && <Badge variant="destructive">Blacklisted</Badge>}
                            {lookupResult.flags.isAllowlisted && <Badge variant="default">Allowlisted</Badge>}
                            {lookupResult.flags.isDisputed && <Badge variant="secondary">Disputed</Badge>}
                            {lookupResult.flags.notes && <span className="text-sm text-muted-foreground">Notes: {lookupResult.flags.notes}</span>}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="flags" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>User Flags</CardTitle>
                <CardDescription>Manage blacklist, allowlist, and disputed users</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4 p-4 border rounded-md">
                  <div className="space-y-2">
                    <Label>Stake ID</Label>
                    <Input value={newFlag.stakeId} onChange={(e) => setNewFlag({ ...newFlag, stakeId: e.target.value })} placeholder="Enter Stake ID" data-testid="input-flag-stake-id" />
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Input value={newFlag.notes} onChange={(e) => setNewFlag({ ...newFlag, notes: e.target.value })} placeholder="Optional notes" data-testid="input-flag-notes" />
                  </div>
                  <div className="flex items-center gap-4 flex-wrap">
                    <label className="flex items-center gap-2">
                      <Switch checked={newFlag.isBlacklisted} onCheckedChange={(v) => setNewFlag({ ...newFlag, isBlacklisted: v })} />
                      <span>Blacklist</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <Switch checked={newFlag.isAllowlisted} onCheckedChange={(v) => setNewFlag({ ...newFlag, isAllowlisted: v })} />
                      <span>Allowlist</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <Switch checked={newFlag.isDisputed} onCheckedChange={(v) => setNewFlag({ ...newFlag, isDisputed: v })} />
                      <span>Disputed</span>
                    </label>
                  </div>
                  <div className="flex items-end">
                    <Button onClick={() => saveFlag.mutate(newFlag)} disabled={!newFlag.stakeId || saveFlag.isPending} data-testid="button-save-flag">
                      Save Flag
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  {userFlags?.flags.map((flag) => (
                    <div key={flag.id} className="flex items-start sm:items-center justify-between gap-2 p-3 border rounded-md">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm break-all">{flag.stakeId}</span>
                          {flag.isBlacklisted && <Badge variant="destructive" className="text-xs">Blacklisted</Badge>}
                          {flag.isAllowlisted && <Badge className="text-xs">Allowlisted</Badge>}
                          {flag.isDisputed && <Badge variant="secondary" className="text-xs">Disputed</Badge>}
                        </div>
                        {flag.notes && <span className="text-xs text-muted-foreground mt-1 block">{flag.notes}</span>}
                      </div>
                      <Button variant="ghost" size="icon" className="shrink-0" onClick={() => deleteFlag.mutate(flag.stakeId)} data-testid={`button-delete-flag-${flag.stakeId}`}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  {(!userFlags?.flags || userFlags.flags.length === 0) && (
                    <p className="text-center text-muted-foreground py-4">No user flags set</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rate" className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Top Spinners (Last Hour)</CardTitle>
                </CardHeader>
                <CardContent>
                  {rateStats?.topSpinners.length === 0 ? (
                    <p className="text-muted-foreground">No spins in the last hour</p>
                  ) : (
                    <div className="space-y-2">
                      {rateStats?.topSpinners.map((s, i) => (
                        <div key={s.stakeId} className="flex justify-between items-center p-2 border rounded-md">
                          <span className="font-medium">{s.stakeId}</span>
                          <Badge variant="secondary">{s.count} spins</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>IP Anomalies</CardTitle>
                  <CardDescription>Same IP using multiple Stake IDs</CardDescription>
                </CardHeader>
                <CardContent>
                  {rateStats?.ipAnomalies.length === 0 ? (
                    <p className="text-muted-foreground">No anomalies detected</p>
                  ) : (
                    <div className="space-y-2">
                      {rateStats?.ipAnomalies.map((a, i) => (
                        <div key={a.ipHash} className="p-2 border rounded-md">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-mono text-sm">{a.ipHash.slice(0, 12)}...</span>
                            <Badge variant="destructive">{a.idCount} IDs</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground truncate">{a.stakeIds}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="withdrawals" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Withdrawal Requests</CardTitle>
              </CardHeader>
              <CardContent>
                {withdrawalsData?.withdrawals.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No withdrawal requests</p>
                ) : (
                  <div className="space-y-2">
                    {withdrawalsData?.withdrawals.map((w) => (
                      <div key={w.id} className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 p-3 rounded-md border ${w.status === "pending" ? "border-yellow-500/50 bg-yellow-500/5" : ""}`}>
                        <div className="min-w-0">
                          <div className="font-medium text-sm break-all">{w.stakeId}</div>
                          <div className="text-xs text-muted-foreground">{formatAmount(w.amount)} - {formatDate(w.createdAt)}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {w.status === "pending" ? (
                            <>
                              <Button size="sm" onClick={() => processWithdrawal.mutate({ id: w.id, status: "approved" })} disabled={processWithdrawal.isPending}>
                                <Check className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">Approve</span>
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => processWithdrawal.mutate({ id: w.id, status: "rejected" })} disabled={processWithdrawal.isPending}>
                                <Ban className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">Reject</span>
                              </Button>
                            </>
                          ) : (
                            <Badge variant={w.status === "approved" ? "default" : "secondary"} className="text-xs">{w.status}</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="export" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                <div>
                  <CardTitle className="text-lg sm:text-xl">Raffle Export</CardTitle>
                  <CardDescription>Generate ticket entries for raffle</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={downloadBackup} className="w-full sm:w-auto" data-testid="button-backup">
                  <FileDown className="w-4 h-4 mr-2" /> Backup Data
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Campaign Name</Label>
                    <Input value={exportParams.campaign} onChange={(e) => setExportParams({ ...exportParams, campaign: e.target.value })} placeholder="e.g. December Raffle" data-testid="input-campaign" />
                  </div>
                  <div className="space-y-2">
                    <Label>Week Label</Label>
                    <Input value={exportParams.weekLabel} onChange={(e) => setExportParams({ ...exportParams, weekLabel: e.target.value })} placeholder="e.g. 2024-12-15_to_2024-12-22" data-testid="input-week-label" />
                  </div>
                  <div className="space-y-2">
                    <Label>Ticket Unit ($/ticket)</Label>
                    <Input type="number" value={exportParams.ticketUnit} onChange={(e) => setExportParams({ ...exportParams, ticketUnit: parseInt(e.target.value) || 1000 })} data-testid="input-ticket-unit" />
                  </div>
                  <div className="space-y-2">
                    <Label>Wager Field</Label>
                    <Select value={exportParams.wagerField} onValueChange={(v) => setExportParams({ ...exportParams, wagerField: v })}>
                      <SelectTrigger data-testid="select-wager-field">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Wagered_Weekly">Wagered_Weekly</SelectItem>
                        <SelectItem value="Wagered_Monthly">Wagered_Monthly</SelectItem>
                        <SelectItem value="Wagered_Overall">Wagered_Overall</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" onClick={previewExport} disabled={!exportParams.campaign || !exportParams.weekLabel} data-testid="button-preview">
                    <Eye className="w-4 h-4 mr-2" /> Preview
                  </Button>
                  <Button onClick={generateExport} disabled={!exportParams.campaign || !exportParams.weekLabel} data-testid="button-export">
                    <Download className="w-4 h-4 mr-2" /> Export CSV
                  </Button>
                </div>

                {exportPreview && (
                  <div className="p-3 sm:p-4 border rounded-md space-y-2">
                    <h4 className="font-medium text-sm sm:text-base">Preview Summary</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-4 text-xs sm:text-sm">
                      <div><span className="text-muted-foreground">Eligible Users:</span> {exportPreview.summary.eligibleUsers}</div>
                      <div><span className="text-muted-foreground">Total Tickets:</span> {exportPreview.summary.totalTickets}</div>
                      <div><span className="text-muted-foreground">Total Wager:</span> {formatAmount(exportPreview.summary.totalWager)}</div>
                      <div><span className="text-muted-foreground">Min Wager:</span> {formatAmount(exportPreview.summary.minWager)}</div>
                      <div><span className="text-muted-foreground">Max Wager:</span> {formatAmount(exportPreview.summary.maxWager)}</div>
                      <div><span className="text-muted-foreground">Avg Wager:</span> {formatAmount(exportPreview.summary.avgWager)}</div>
                    </div>
                    <div>
                      <h5 className="text-xs sm:text-sm font-medium mt-2">Top 10:</h5>
                      <div className="flex gap-1 sm:gap-2 flex-wrap mt-1">
                        {exportPreview.summary.top10.map((e: any) => (
                          <Badge key={e.stakeId} variant="outline" className="text-xs">{e.stakeId}: {e.tickets}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {exportLogs?.logs && exportLogs.logs.length > 0 && (
                  <div className="pt-4 border-t">
                    <h4 className="font-medium mb-2 text-sm sm:text-base">Recent Exports</h4>
                    <div className="space-y-2">
                      {exportLogs.logs.slice(0, 5).map((log) => (
                        <div key={log.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2 text-xs sm:text-sm p-2 border rounded-md">
                          <div>
                            <span className="font-medium">{log.campaign}</span> - {log.weekLabel}
                          </div>
                          <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-muted-foreground">
                            <span>{log.rowCount} entries, {log.totalTickets} tickets</span>
                            <span className="hidden sm:inline">-</span>
                            <span>{formatDate(log.createdAt)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="toggles" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Feature Toggles</CardTitle>
                <CardDescription>Runtime configuration settings</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {togglesData?.toggles && Object.entries(togglesData.toggles).map(([key, toggle]) => (
                    <div key={key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 p-3 border rounded-md">
                      <div className="min-w-0">
                        <div className="font-medium font-mono text-xs sm:text-sm break-all">{key}</div>
                        <div className="text-xs sm:text-sm text-muted-foreground">{toggle.description}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {toggle.value === "true" || toggle.value === "false" ? (
                          <Switch 
                            checked={toggle.value === "true"} 
                            onCheckedChange={(v) => updateToggle.mutate({ key, value: v ? "true" : "false" })}
                          />
                        ) : (
                          <Input 
                            className="w-20 sm:w-24 text-sm" 
                            value={toggle.value} 
                            onChange={(e) => updateToggle.mutate({ key, value: e.target.value })}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="spins" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg sm:text-xl">Recent Spins</CardTitle>
              </CardHeader>
              <CardContent>
                {logsData?.logs.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">No spins yet</div>
                ) : (
                  <div className="space-y-2">
                    {logsData?.logs.map((log, i) => (
                      <div key={`${log.timestamp}-${i}`} className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 p-3 rounded-md ${log.result === "WIN" ? "bg-primary/10" : "bg-muted/50"}`}>
                        <div className="flex items-center gap-2 sm:gap-3">
                          {log.result === "WIN" ? <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-primary shrink-0" /> : <X className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground shrink-0" />}
                          <div className="min-w-0">
                            <div className="font-medium text-sm break-all">{log.stakeId}</div>
                            <div className="text-xs text-muted-foreground">Spin #{log.spinNumber} - {formatAmount(log.wageredAmount)} wagered</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-6 sm:ml-0">
                          {log.result === "WIN" && <Badge className="text-xs">{log.prizeLabel}</Badge>}
                          <span className="text-xs text-muted-foreground">{new Date(log.timestamp).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="verifications" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle className="text-lg sm:text-xl">Verification Requests</CardTitle>
                  <CardDescription>Review and approve user Stake account verifications</CardDescription>
                </div>
                <Button onClick={() => refetchVerifications()} size="sm" variant="outline" data-testid="button-refresh-verifications">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh
                </Button>
              </CardHeader>
              <CardContent>
                {verificationsData?.verifications?.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">No verification requests</div>
                ) : (
                  <div className="space-y-3">
                    {verificationsData?.verifications?.map((v) => (
                      <div key={v.id} className={`p-4 rounded-md border ${v.status === "pending" ? "bg-yellow-500/5 border-yellow-500/20" : v.status === "approved" ? "bg-green-500/5 border-green-500/20" : "bg-destructive/5 border-destructive/20"}`}>
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{v.stakeUsername}</span>
                              <Badge variant="outline" className="text-xs">{v.stakePlatform.toUpperCase()}</Badge>
                              <Badge variant={v.status === "pending" ? "secondary" : v.status === "approved" ? "default" : "destructive"} className="text-xs">
                                {v.status}
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              Bet ID: <span className="font-mono">{v.betId}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              User: {v.userEmail || v.userFirstName || "Unknown"} | Submitted: {new Date(v.createdAt).toLocaleString()}
                            </div>
                          </div>
                          {v.status === "pending" && (
                            <div className="flex gap-2 shrink-0">
                              <Button
                                size="sm"
                                onClick={() => processVerification.mutate({ id: v.id, status: "approved" })}
                                disabled={processVerification.isPending}
                                data-testid={`button-approve-verification-${v.id}`}
                              >
                                <Check className="w-4 h-4 mr-1" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => processVerification.mutate({ id: v.id, status: "rejected" })}
                                disabled={processVerification.isPending}
                                data-testid={`button-reject-verification-${v.id}`}
                              >
                                <Ban className="w-4 h-4 mr-1" />
                                Reject
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
