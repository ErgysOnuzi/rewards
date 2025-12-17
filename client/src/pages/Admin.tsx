import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, X, RotateCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

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

export default function Admin() {
  const { data, isLoading, refetch } = useQuery<AdminLogsResponse>({
    queryKey: ["/api/admin/logs"],
    refetchInterval: 5000,
  });

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleTimeString();
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
            <p className="text-muted-foreground">
              {data?.mode === "demo" ? "Demo Mode - Data resets on server restart" : "Connected to Google Sheets"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="icon" onClick={() => refetch()} data-testid="button-refresh">
              <RotateCw className="w-4 h-4" />
            </Button>
            <Link href="/">
              <Button variant="outline" data-testid="link-home">Back to Spin</Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
        </div>

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
      </div>
    </div>
  );
}
