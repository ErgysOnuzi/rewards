import { useState } from "react";
import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import StakeIdForm from "@/components/StakeIdForm";
import TicketStatus, { TicketData, SpinBalances } from "@/components/TicketStatus";
import CaseOpening, { CaseSpinResult, BonusStatus } from "@/components/CaseOpening";
import Footer from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";
import { safeJsonParse } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketData, setTicketData] = useState<TicketData | null>(null);
  const [bonusStatus, setBonusStatus] = useState<BonusStatus | null>(null);
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const updateBonusStatusFromTicketData = (data: { can_daily_bonus: boolean; next_bonus_at?: string }) => {
    const nextBonusAt = data.next_bonus_at ? new Date(data.next_bonus_at) : null;
    const remainingMs = nextBonusAt ? Math.max(0, nextBonusAt.getTime() - Date.now()) : 0;
    setBonusStatus({
      available: data.can_daily_bonus,
      remainingMs,
      nextBonusAt: data.next_bonus_at ?? null,
    });
  };
  
  const refreshBonusStatus = async (stakeId: string) => {
    try {
      const response = await fetch("/api/spin/bonus/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stake_id: stakeId }),
      });
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

  const handleLookup = async (stakeId: string) => {
    // Check if user is logged in
    if (!isAuthenticated) {
      toast({
        title: "Login Required",
        description: "Please login first to check your tickets.",
        variant: "destructive",
      });
      return;
    }

    // Check if verification is completed
    if (user?.verificationStatus !== "verified") {
      toast({
        title: "Verification Required",
        description: "Your account verification is not completed. Please complete verification first.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stake_id: stakeId }),
      });

      const data = await safeJsonParse(response);

      if (!response.ok) {
        throw new Error(data.message || "Failed to lookup Stake ID");
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stake_id: ticketData.stakeId }),
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
    if (ticketData) {
      refreshBonusStatus(ticketData.stakeId);
    }
  };

  const handleWithdraw = async (amount: number) => {
    if (!ticketData) return;

    try {
      const response = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stake_id: ticketData.stakeId, amount }),
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
          
          <StakeIdForm 
            onSubmit={handleLookup}
            isLoading={isLoading}
            error={error}
          />

          {ticketData && (
            <div className="space-y-8 animate-fade-in-up">
              <TicketStatus 
                data={ticketData}
                onWithdraw={handleWithdraw}
              />
              
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
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
