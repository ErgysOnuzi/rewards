import { useState, useEffect } from "react";
import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import TicketStatus, { TicketData, SpinBalances } from "@/components/TicketStatus";
import CaseOpening, { CaseSpinResult, BonusStatus } from "@/components/CaseOpening";
import DemoSpin from "@/components/DemoSpin";
import Footer from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";
import { safeJsonParse, getAuthToken } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

function getAuthHeaders(): HeadersInit {
  const token = getAuthToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, LogIn, ShieldCheck, Gift, Copy, Check, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface BonusEventStatus {
  active: boolean;
  multiplier: number;
  name: string;
}

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketData, setTicketData] = useState<TicketData | null>(null);
  const [bonusStatus, setBonusStatus] = useState<BonusStatus | null>(null);
  const [bonusEvent, setBonusEvent] = useState<BonusEventStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  
  const copyReferralLink = () => {
    const username = user?.username;
    if (!username) return;
    const referralLink = `${window.location.origin}/register?ref=${username}`;
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    toast({ title: "Copied!", description: "Referral link copied to clipboard" });
    setTimeout(() => setCopied(false), 2000);
  };

  const updateBonusStatusFromTicketData = (data: { can_daily_bonus: boolean; next_bonus_at?: string }) => {
    const nextBonusAt = data.next_bonus_at ? new Date(data.next_bonus_at) : null;
    const remainingMs = nextBonusAt ? Math.max(0, nextBonusAt.getTime() - Date.now()) : 0;
    setBonusStatus({
      available: data.can_daily_bonus,
      remainingMs,
      nextBonusAt: data.next_bonus_at ?? null,
    });
  };
  
  const refreshBonusStatus = async () => {
    try {
      const response = await fetch("/api/spin/bonus/check", {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!response.ok) return; // Silently fail if not authenticated
      const data = await safeJsonParse(response);
      setBonusStatus({
        available: data.available,
        remainingMs: data.remaining_ms,
        nextBonusAt: data.next_bonus_at ?? null,
      });
    } catch (err) {
      console.error("Failed to check bonus status:", err);
    }
  };

  const fetchTicketData = async (stakeId: string, domain: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/lookup", {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({ stake_id: stakeId, domain }),
      });

      const data = await safeJsonParse(response);

      if (!response.ok) {
        throw new Error(data.message || "Failed to load ticket data");
      }

      setTicketData({
        stakeId: data.stake_id,
        periodLabel: data.period_label,
        wageredAmount: data.wagered_amount,
        lifetimeWagered: data.lifetime_wagered || data.wagered_amount,
        ticketsTotal: data.tickets_total,
        ticketsUsed: data.tickets_used,
        ticketsRemaining: data.tickets_remaining,
        walletBalance: data.wallet_balance || 0,
        spinBalances: data.spin_balances || { bronze: 0, silver: 0, gold: 0 },
        pendingWithdrawals: data.pending_withdrawals || 0,
        canDailyBonus: data.can_daily_bonus ?? true,
        nextBonusAt: data.next_bonus_at,
      });

      updateBonusStatusFromTicketData(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "An error occurred";
      setError(message);
      setTicketData(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-fetch ticket data when user is verified
  useEffect(() => {
    if (!authLoading && isAuthenticated && user?.verificationStatus === "verified" && user?.stakeUsername) {
      fetchTicketData(user.stakeUsername, user.stakePlatform || "com");
    }
  }, [authLoading, isAuthenticated, user?.verificationStatus, user?.stakeUsername, user?.stakePlatform]);

  // Fetch bonus event status
  useEffect(() => {
    const fetchBonusEvent = async () => {
      try {
        const response = await fetch("/api/bonus-event");
        if (response.ok) {
          const data = await response.json();
          setBonusEvent(data);
        }
      } catch (err) {
        console.error("Failed to fetch bonus event:", err);
      }
    };
    fetchBonusEvent();
    // Refresh every 5 minutes
    const interval = setInterval(fetchBonusEvent, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSpin = async (): Promise<CaseSpinResult> => {
    if (!ticketData) {
      throw new Error("No ticket data available");
    }

    // Optimistically update ticket count immediately
    setTicketData({
      ...ticketData,
      ticketsRemaining: ticketData.ticketsRemaining - 1,
      ticketsUsed: ticketData.ticketsUsed + 1,
    });

    const response = await fetch("/api/spin", {
      method: "POST",
      headers: getAuthHeaders(),
      credentials: "include",
      body: JSON.stringify({ stake_id: ticketData.stakeId }),
    });

    const data = await safeJsonParse(response);

    if (!response.ok) {
      // Revert on error
      setTicketData({
        ...ticketData,
        ticketsRemaining: ticketData.ticketsRemaining,
        ticketsUsed: ticketData.ticketsUsed,
      });
      throw new Error(data.message || "Spin failed");
    }

    return {
      result: data.result,
      prizeLabel: data.prize_label || "$0",
      prizeValue: data.prize_value || 0,
      prizeColor: data.prize_color || "grey",
      ticketsTotal: data.tickets_total,
      ticketsUsedAfter: data.tickets_used_after,
      ticketsRemainingAfter: data.tickets_remaining_after,
      walletBalance: data.wallet_balance || 0,
    };
  };

  const handleSpinComplete = (result: CaseSpinResult) => {
    if (ticketData) {
      setTicketData({
        ...ticketData,
        ticketsTotal: result.ticketsTotal,
        ticketsUsed: result.ticketsUsedAfter,
        ticketsRemaining: result.ticketsRemainingAfter,
        walletBalance: result.walletBalance,
      });
    }

    if (result.result === "WIN") {
      toast({
        title: "Congratulations!",
        description: `You won: ${result.prizeLabel}`,
      });
    }
  };

  const handleSpinError = (error: Error) => {
    toast({
      title: "Spin Failed",
      description: error.message,
      variant: "destructive",
    });
  };

  const handleBonusSpin = async () => {
    if (!ticketData) throw new Error("No ticket data");

    const response = await fetch("/api/spin/bonus", {
      method: "POST",
      headers: getAuthHeaders(),
      credentials: "include",
      body: JSON.stringify({}),
    });

    const data = await safeJsonParse(response);

    if (!response.ok) {
      throw new Error(data.message || "Bonus spin failed");
    }

    if (data.result === "WIN") {
      setTicketData({
        ...ticketData,
        walletBalance: data.wallet_balance,
      });
      toast({
        title: "Bonus Win!",
        description: data.prize_label,
      });
    }

    return data;
  };

  const handleBonusUsed = () => {
    refreshBonusStatus();
  };

  const handleWithdraw = async (amount: number) => {
    if (!ticketData) return;

    try {
      const response = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({ amount }),
      });

      const data = await safeJsonParse(response);

      if (!response.ok) {
        throw new Error(data.message || "Withdrawal failed");
      }

      setTicketData({
        ...ticketData,
        pendingWithdrawals: data.pending_withdrawals,
      });

      toast({
        title: "Withdrawal Requested",
        description: `Your request for $${amount} to your Stake account is pending admin approval.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Withdrawal failed";
      toast({
        title: "Withdrawal Failed",
        description: message,
        variant: "destructive",
      });
    }
  };

  // Show loading state while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </main>
        <Footer />
      </div>
    );
  }

  // Show demo spin and login prompt if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <main className="flex-1">
          <div className="max-w-4xl mx-auto px-4 space-y-8">
            <HeroSection />
            
            <div className="max-w-md mx-auto">
              <DemoSpin onLoginClick={() => navigate("/register")} />
            </div>

            <Card className="max-w-md mx-auto">
              <CardContent className="pt-6 text-center space-y-4">
                <LogIn className="w-12 h-12 mx-auto text-muted-foreground" />
                <h3 className="text-lg font-semibold">Already have an account?</h3>
                <p className="text-sm text-muted-foreground">
                  Login to check your tickets and spin for real prizes.
                </p>
                <Button onClick={() => navigate("/login")} className="w-full" data-testid="button-login-prompt">
                  Login
                </Button>
                <p className="text-xs text-muted-foreground">
                  Don't have an account?{" "}
                  <button 
                    onClick={() => navigate("/register")} 
                    className="text-primary underline"
                    data-testid="link-register-prompt"
                  >
                    Register here
                  </button>
                </p>
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Show verification prompt if not verified
  if (user?.verificationStatus !== "verified") {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <main className="flex-1">
          <div className="max-w-4xl mx-auto px-4 space-y-12">
            <HeroSection />
            <Card className="max-w-md mx-auto">
              <CardContent className="pt-6 text-center space-y-4">
                <ShieldCheck className="w-12 h-12 mx-auto text-muted-foreground" />
                <h3 className="text-lg font-semibold">Verification Required</h3>
                <p className="text-sm text-muted-foreground">
                  {user?.verificationStatus === "pending" 
                    ? "Your verification is pending admin review. Please check back later."
                    : "Please complete account verification to access spins."}
                </p>
                {user?.verificationStatus !== "pending" && (
                  <Button onClick={() => navigate("/verify")} className="w-full" data-testid="button-verify-prompt">
                    Complete Verification
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header 
        walletBalance={ticketData?.walletBalance}
        ticketsRemaining={ticketData?.ticketsRemaining}
        stakeId={ticketData?.stakeId}
      />
      
      <main className="flex-1">
        <div className="max-w-4xl mx-auto px-4 space-y-12">
          <HeroSection />
          
          {isLoading ? (
            <Card className="max-w-md mx-auto">
              <CardContent className="pt-6 text-center space-y-4">
                <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Loading your ticket data...</p>
              </CardContent>
            </Card>
          ) : error ? (
            <Card className="max-w-md mx-auto">
              <CardContent className="pt-6 text-center space-y-4">
                <p className="text-sm text-destructive">{error}</p>
                <Button 
                  onClick={() => user?.stakeUsername && fetchTicketData(user.stakeUsername, user.stakePlatform || "com")}
                  variant="outline"
                  data-testid="button-retry-load"
                >
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : ticketData ? (
            <div className="space-y-8 animate-fade-in-up">
              <TicketStatus 
                data={ticketData}
                onWithdraw={handleWithdraw}
              />
              
              {bonusEvent?.active && (
                <Card className="max-w-2xl mx-auto bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-primary/30">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-center gap-3 text-center">
                      <Sparkles className="w-5 h-5 text-primary animate-pulse" />
                      <div>
                        <span className="font-bold text-lg">{bonusEvent.name}</span>
                        <Badge variant="secondary" className="ml-2">
                          {bonusEvent.multiplier}x Odds
                        </Badge>
                      </div>
                      <Sparkles className="w-5 h-5 text-primary animate-pulse" />
                    </div>
                  </CardContent>
                </Card>
              )}
              
              <CaseOpening
                ticketsRemaining={ticketData.ticketsRemaining}
                stakeId={ticketData.stakeId}
                onSpin={handleSpin}
                onBonusSpin={handleBonusSpin}
                onSpinComplete={handleSpinComplete}
                onSpinError={handleSpinError}
                bonusStatus={bonusStatus || undefined}
                onBonusUsed={handleBonusUsed}
              />
              
              {user?.username && (
                <Card className="max-w-md mx-auto">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Gift className="w-4 h-4 text-primary" />
                      Refer Friends & Earn
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Tell your friends to enter your username when signing up. When they hit $1,000 weekly wager, you'll earn $2!
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-muted p-2 rounded-md font-mono text-center text-sm">
                        {user.username}
                      </div>
                      <Button 
                        size="icon" 
                        variant="outline" 
                        onClick={copyReferralLink}
                        data-testid="button-copy-referral"
                      >
                        {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : null}
        </div>
      </main>

      <Footer />
    </div>
  );
}
