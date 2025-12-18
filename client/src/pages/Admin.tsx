import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, X, RotateCw, Users, ArrowUpFromLine, Check, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface SpinLog {
  timestamp: string;
  stakeId: string;
  wageredAmount: number;
  spinNumber: number;
  result: "WIN" | "LOSE";
  prizeLabel: string;
}

interface AdminLogsResponse {
  mode: "demo" | "sheets";
  message?: string;
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

interface WithdrawalsResponse {
  withdrawals: WithdrawalRequest[];
}

export default function Admin() {
  const { toast } = useToast();
  
  const { data, isLoading, refetch } = useQuery<AdminLogsResponse>({
    queryKey: ["/api/admin/logs"],
    refetchInterval: 5000,
  });

  const { data: withdrawalsData, isLoading: withdrawalsLoading, refetch: refetchWithdrawals } = useQuery<WithdrawalsResponse>({
    queryKey: ["/api/admin/withdrawals"],
    refetchInterval: 5000,
  });

  const processWithdrawal = useMutation({
    mutationFn: async ({ id, status, admin_notes }: { id: number; status: "approved" | "rejected"; admin_notes?: string }) => {
      const response = await fetch("/api/admin/withdrawals/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, admin_notes }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to process withdrawal");
      }
      return response.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/withdrawals"] });
      toast({
        title: "Withdrawal Processed",
        description: `Withdrawal ${variables.status === "approved" ? "approved" : "rejected"} successfully.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleTimeString();
  };

  const formatDate = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const pendingWithdrawals = withdrawalsData?.withdrawals.filter(w => w.status === "pending") || [];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
            <p className="text-muted-foreground">
              {data?.mode === "demo" ? "Demo Mode - Data persists in database" : "Connected to Google Sheets"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="icon" onClick={() => { refetch(); refetchWithdrawals(); }} data-testid="button-refresh">
              <RotateCw className="w-4 h-4" />
            </Button>
            <Link href="/">
              <Button variant="outline" data-testid="link-home">Back to Spin</Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-muted">
                  <RotateCw className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold font-mono" data-testid="text-total-spins">{data?.totalSpins ?? 0}</p>
                  <p className="text-sm text-muted-foreground">Total Spins</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-primary/10">
                  <Trophy className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold font-mono text-primary" data-testid="text-total-wins">{data?.totalWins ?? 0}</p>
                  <p className="text-sm text-muted-foreground">Total Wins</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-muted">
                  <Users className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold font-mono" data-testid="text-win-rate">
                    {data && data.totalSpins > 0 
                      ? ((data.totalWins / data.totalSpins) * 100).toFixed(1) 
                      : "0"}%
                  </p>
                  <p className="text-sm text-muted-foreground">Win Rate</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-md bg-yellow-500/10">
                  <ArrowUpFromLine className="w-5 h-5 text-yellow-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold font-mono text-yellow-500" data-testid="text-pending-withdrawals">
                    {pendingWithdrawals.length}
                  </p>
                  <p className="text-sm text-muted-foreground">Pending Withdrawals</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="spins">
          <TabsList>
            <TabsTrigger value="spins" data-testid="tab-spins">Recent Spins</TabsTrigger>
            <TabsTrigger value="withdrawals" data-testid="tab-withdrawals">
              Withdrawals
              {pendingWithdrawals.length > 0 && (
                <Badge variant="destructive" className="ml-2 h-5 min-w-5 px-1">
                  {pendingWithdrawals.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="spins">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Spins</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : data?.logs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No spins yet. Spins will appear here in real-time.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data?.logs.map((log, index) => (
                      <div
                        key={`${log.timestamp}-${index}`}
                        className={`flex items-center justify-between gap-4 p-3 rounded-md ${
                          log.result === "WIN" ? "bg-primary/10 border border-primary/20" : "bg-muted/50"
                        }`}
                        data-testid={`row-spin-${index}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {log.result === "WIN" ? (
                            <Trophy className="w-5 h-5 text-primary flex-shrink-0" />
                          ) : (
                            <X className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="font-medium truncate" data-testid={`text-stake-id-${index}`}>{log.stakeId}</p>
                            <p className="text-sm text-muted-foreground">
                              Spin #{log.spinNumber} · {formatAmount(log.wageredAmount)} wagered
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {log.result === "WIN" && (
                            <Badge variant="default" className="bg-primary" data-testid={`badge-win-${index}`}>
                              {log.prizeLabel || "WIN"}
                            </Badge>
                          )}
                          <span className="text-sm text-muted-foreground whitespace-nowrap">
                            {formatTime(log.timestamp)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="withdrawals">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Withdrawal Requests</CardTitle>
              </CardHeader>
              <CardContent>
                {withdrawalsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : withdrawalsData?.withdrawals.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No withdrawal requests yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {withdrawalsData?.withdrawals.map((withdrawal, index) => (
                      <div
                        key={withdrawal.id}
                        className={`flex items-center justify-between gap-4 p-3 rounded-md ${
                          withdrawal.status === "pending" 
                            ? "bg-yellow-500/10 border border-yellow-500/20"
                            : withdrawal.status === "approved"
                            ? "bg-primary/10 border border-primary/20"
                            : "bg-muted/50"
                        }`}
                        data-testid={`row-withdrawal-${index}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <ArrowUpFromLine className={`w-5 h-5 flex-shrink-0 ${
                            withdrawal.status === "pending" 
                              ? "text-yellow-500"
                              : withdrawal.status === "approved"
                              ? "text-primary"
                              : "text-muted-foreground"
                          }`} />
                          <div className="min-w-0">
                            <p className="font-medium truncate">{withdrawal.stakeId}</p>
                            <p className="text-sm text-muted-foreground">
                              {formatAmount(withdrawal.amount)} · {formatDate(withdrawal.createdAt)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {withdrawal.status === "pending" ? (
                            <>
                              <Button
                                size="sm"
                                variant="default"
                                disabled={processWithdrawal.isPending}
                                onClick={() => processWithdrawal.mutate({ id: withdrawal.id, status: "approved" })}
                                data-testid={`button-approve-${index}`}
                              >
                                <Check className="w-4 h-4 mr-1" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={processWithdrawal.isPending}
                                onClick={() => processWithdrawal.mutate({ id: withdrawal.id, status: "rejected" })}
                                data-testid={`button-reject-${index}`}
                              >
                                <Ban className="w-4 h-4 mr-1" />
                                Reject
                              </Button>
                            </>
                          ) : (
                            <Badge 
                              variant={withdrawal.status === "approved" ? "default" : "secondary"}
                              className={withdrawal.status === "approved" ? "bg-primary" : ""}
                            >
                              {withdrawal.status.charAt(0).toUpperCase() + withdrawal.status.slice(1)}
                            </Badge>
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
