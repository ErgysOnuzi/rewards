import { useState, useEffect } from "react";
import HeroSection from "@/components/HeroSection";
import StakeIdForm from "@/components/StakeIdForm";
import TicketStatus, { TicketData, SpinBalances } from "@/components/TicketStatus";
import SpinWheel, { SpinResult, BonusStatus } from "@/components/SpinWheel";
import Footer from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketData, setTicketData] = useState<TicketData | null>(null);
  const [bonusStatus, setBonusStatus] = useState<BonusStatus | null>(null);
  const { toast } = useToast();

  const checkBonusStatus = async (stakeId: string) => {
    try {
      const response = await fetch("/api/spin/bonus/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stake_id: stakeId }),
      });
      const data = await response.json();
      setBonusStatus({
        available: data.available,
        remainingMs: data.remaining_ms,
        nextBonusAt: data.next_bonus_at,
      });
    } catch (err) {
      console.error("Failed to check bonus status:", err);
    }
  };

  const handleLookup = async (stakeId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stake_id: stakeId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to lookup Stake ID");
      }

      setTicketData({
        stakeId: data.stake_id,
        periodLabel: data.period_label,
        wageredAmount: data.wagered_amount,
        ticketsTotal: data.tickets_total,
        ticketsUsed: data.tickets_used,
        ticketsRemaining: data.tickets_remaining,
        walletBalance: data.wallet_balance || 0,
        spinBalances: data.spin_balances || { bronze: 0, silver: 0, gold: 0 },
        pendingWithdrawals: data.pending_withdrawals || 0,
      });

      await checkBonusStatus(stakeId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "An error occurred";
      setError(message);
      setTicketData(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSpin = async (): Promise<SpinResult> => {
    if (!ticketData) {
      throw new Error("No ticket data available");
    }

    const response = await fetch("/api/spin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stake_id: ticketData.stakeId }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Spin failed");
    }

    return {
      result: data.result,
      prizeLabel: data.prize_label || undefined,
      prizeValue: data.prize_value || 0,
      ticketsTotal: data.tickets_total,
      ticketsUsedAfter: data.tickets_used_after,
      ticketsRemainingAfter: data.tickets_remaining_after,
      walletBalance: data.wallet_balance || 0,
      spinBalances: data.spin_balances || { bronze: 0, silver: 0, gold: 0 },
    };
  };

  const handleSpinComplete = (result: SpinResult) => {
    if (ticketData) {
      setTicketData({
        ...ticketData,
        ticketsTotal: result.ticketsTotal,
        ticketsUsed: result.ticketsUsedAfter,
        ticketsRemaining: result.ticketsRemainingAfter,
        walletBalance: result.walletBalance,
        spinBalances: result.spinBalances,
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

  const handlePurchase = async (tier: "bronze" | "silver" | "gold", quantity: number) => {
    if (!ticketData) return;

    try {
      const response = await fetch("/api/spins/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stake_id: ticketData.stakeId, tier, quantity }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Purchase failed");
      }

      setTicketData({
        ...ticketData,
        walletBalance: data.wallet_balance,
        spinBalances: data.spin_balances,
      });

      toast({
        title: "Purchase Successful",
        description: `Bought ${quantity} ${tier} spin(s) for $${data.cost}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Purchase failed";
      toast({
        title: "Purchase Failed",
        description: message,
        variant: "destructive",
      });
    }
  };

  const handleConvert = async (fromTier: "bronze" | "silver", toTier: "silver" | "gold", quantity: number) => {
    if (!ticketData) return;

    try {
      const response = await fetch("/api/spins/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stake_id: ticketData.stakeId, from_tier: fromTier, to_tier: toTier, quantity }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Conversion failed");
      }

      setTicketData({
        ...ticketData,
        spinBalances: data.spin_balances,
      });

      toast({
        title: "Conversion Successful",
        description: `Converted to ${quantity} ${toTier} spin(s)`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Conversion failed";
      toast({
        title: "Conversion Failed",
        description: message,
        variant: "destructive",
      });
    }
  };

  const handleBonusSpin = async () => {
    if (!ticketData) throw new Error("No ticket data");

    const response = await fetch("/api/spin/bonus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stake_id: ticketData.stakeId }),
    });

    const data = await response.json();

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
      checkBonusStatus(ticketData.stakeId);
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

      const data = await response.json();

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
                onPurchase={handlePurchase}
                onConvert={handleConvert}
                onWithdraw={handleWithdraw}
              />
              
              <SpinWheel
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
