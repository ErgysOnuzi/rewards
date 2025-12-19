import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trophy, X, RotateCw, Gift, Clock } from "lucide-react";
import { playSpinStart, playSpinTick, playWinSound, playLoseSound, resumeAudioContext } from "@/lib/sounds";

export interface SpinBalances {
  bronze: number;
  silver: number;
  gold: number;
}

export interface SpinResult {
  result: "WIN" | "LOSE";
  prizeLabel?: string;
  prizeValue: number;
  ticketsTotal: number;
  ticketsUsedAfter: number;
  ticketsRemainingAfter: number;
  walletBalance: number;
  spinBalances: SpinBalances;
}

export interface BonusStatus {
  available: boolean;
  remainingMs: number;
  nextBonusAt: string | null;
}

interface SpinWheelProps {
  ticketsRemaining: number;
  stakeId: string;
  onSpin: () => Promise<SpinResult>;
  onBonusSpin?: () => Promise<{ result: string; prize_label: string; wallet_balance: number }>;
  onSpinComplete?: (result: SpinResult) => void;
  onSpinError?: (error: Error) => void;
  bonusStatus?: BonusStatus;
  onBonusUsed?: () => void;
}

type SpinState = "idle" | "spinning" | "result";

export default function SpinWheel({ 
  ticketsRemaining, 
  stakeId,
  onSpin, 
  onBonusSpin,
  onSpinComplete, 
  onSpinError,
  bonusStatus,
  onBonusUsed,
}: SpinWheelProps) {
  const [spinState, setSpinState] = useState<SpinState>("idle");
  const [lastResult, setLastResult] = useState<SpinResult | null>(null);
  const [rotation, setRotation] = useState(0);
  const [isBonusSpin, setIsBonusSpin] = useState(false);
  const tickIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const canSpin = ticketsRemaining > 0 && spinState === "idle";
  const canBonusSpin = bonusStatus?.available && spinState === "idle";

  useEffect(() => {
    return () => {
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
      }
    };
  }, []);

  const handleSpin = async () => {
    if (!canSpin) return;
    
    resumeAudioContext();
    playSpinStart();
    
    setSpinState("spinning");
    setRotation((prev) => prev + 1800 + Math.random() * 360);
    
    tickIntervalRef.current = setInterval(() => {
      playSpinTick();
    }, 100);
    
    try {
      const result = await onSpin();
      
      setTimeout(() => {
        if (tickIntervalRef.current) {
          clearInterval(tickIntervalRef.current);
          tickIntervalRef.current = null;
        }
        
        if (result.result === "WIN") {
          playWinSound();
        } else {
          playLoseSound();
        }
        
        setLastResult(result);
        setSpinState("result");
        onSpinComplete?.(result);
      }, 2500);
    } catch (error) {
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = null;
      }
      setSpinState("idle");
      const err = error instanceof Error ? error : new Error("Spin failed");
      onSpinError?.(err);
    }
  };

  const handleBonusSpin = async () => {
    if (!canBonusSpin || !onBonusSpin) return;
    
    resumeAudioContext();
    playSpinStart();
    setIsBonusSpin(true);
    setSpinState("spinning");
    setRotation((prev) => prev + 1800 + Math.random() * 360);
    
    tickIntervalRef.current = setInterval(() => {
      playSpinTick();
    }, 100);

    try {
      const result = await onBonusSpin();
      
      setTimeout(() => {
        if (tickIntervalRef.current) {
          clearInterval(tickIntervalRef.current);
          tickIntervalRef.current = null;
        }
        
        if (result.result === "WIN") {
          playWinSound();
        } else {
          playLoseSound();
        }

        setLastResult({
          result: result.result as "WIN" | "LOSE",
          prizeLabel: result.prize_label,
          prizeValue: 0,
          ticketsTotal: 0,
          ticketsUsedAfter: 0,
          ticketsRemainingAfter: ticketsRemaining,
          walletBalance: result.wallet_balance,
          spinBalances: { bronze: 0, silver: 0, gold: 0 },
        });
        setSpinState("result");
        onBonusUsed?.();
      }, 2500);
    } catch (error) {
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
        tickIntervalRef.current = null;
      }
      setSpinState("idle");
      setIsBonusSpin(false);
      const err = error instanceof Error ? error : new Error("Bonus spin failed");
      onSpinError?.(err);
    }
  };

  const resetSpin = () => {
    setSpinState("idle");
    setLastResult(null);
    setIsBonusSpin(false);
  };

  const formatTimeRemaining = (ms: number) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  return (
    <Card className="max-w-md mx-auto">
      <CardContent className="pt-6 space-y-6">
        <div className="relative flex justify-center">
          <div 
            className="relative w-48 h-48 rounded-full border-4 border-primary/30 flex items-center justify-center"
            style={{ 
              transform: `rotate(${rotation}deg)`,
              transition: spinState === "spinning" ? "transform 2.5s cubic-bezier(0.17, 0.67, 0.12, 0.99)" : "none",
              background: "conic-gradient(from 0deg, hsl(var(--primary)) 0deg 30deg, hsl(var(--muted)) 30deg 60deg, hsl(var(--primary)) 60deg 90deg, hsl(var(--muted)) 90deg 120deg, hsl(var(--primary)) 120deg 150deg, hsl(var(--muted)) 150deg 180deg, hsl(var(--primary)) 180deg 210deg, hsl(var(--muted)) 210deg 240deg, hsl(var(--primary)) 240deg 270deg, hsl(var(--muted)) 270deg 300deg, hsl(var(--primary)) 300deg 330deg, hsl(var(--muted)) 330deg 360deg)"
            }}
            data-testid="spin-wheel"
          >
            <div className="absolute inset-4 bg-background rounded-full flex items-center justify-center">
              {spinState === "spinning" ? (
                <Loader2 className="w-12 h-12 text-primary animate-spin" />
              ) : spinState === "result" && lastResult ? (
                lastResult.result === "WIN" ? (
                  <Trophy className="w-12 h-12 text-primary animate-bounce-in" />
                ) : (
                  <X className="w-12 h-12 text-muted-foreground animate-fade-in-up" />
                )
              ) : (
                <span className="text-3xl font-bold font-mono text-primary">
                  {ticketsRemaining}
                </span>
              )}
            </div>
          </div>
          
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-t-[16px] border-t-primary" />
        </div>

        {spinState === "result" && lastResult && (
          <div className="text-center animate-fade-in-up space-y-2">
            {lastResult.result === "WIN" ? (
              <>
                <p className="text-2xl font-bold text-primary" data-testid="text-win-message">
                  You Won!
                </p>
                <p className="text-lg text-muted-foreground" data-testid="text-prize-label">
                  {lastResult.prizeLabel}
                </p>
              </>
            ) : (
              <p className="text-lg text-muted-foreground" data-testid="text-lose-message">
                No win this time. Spin again if you have tickets!
              </p>
            )}
          </div>
        )}

        <div className="space-y-3">
          {spinState === "result" ? (
            <Button 
              onClick={resetSpin} 
              className="w-full"
              variant="secondary"
              data-testid="button-spin-again"
            >
              <RotateCw className="w-4 h-4 mr-2" />
              Spin Again
            </Button>
          ) : (
            <>
              <Button 
                onClick={handleSpin}
                disabled={!canSpin}
                className={`w-full ${canSpin ? "animate-pulse-glow" : ""}`}
                size="lg"
                data-testid="button-spin"
              >
                {spinState === "spinning" && !isBonusSpin ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Spinning...
                  </>
                ) : (
                  "Spin 1 Ticket"
                )}
              </Button>

              {onBonusSpin && (
                <div className="pt-2 border-t border-border/50">
                  {canBonusSpin ? (
                    <Button 
                      onClick={handleBonusSpin}
                      disabled={spinState === "spinning"}
                      variant="outline"
                      className="w-full"
                      size="lg"
                      data-testid="button-bonus-spin"
                    >
                      {spinState === "spinning" && isBonusSpin ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Bonus Spinning...
                        </>
                      ) : (
                        <>
                          <Gift className="w-4 h-4 mr-2" />
                          Daily Bonus Spin (Free)
                        </>
                      )}
                    </Button>
                  ) : bonusStatus && (
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Clock className="w-4 h-4" />
                      <span>Next bonus in {formatTimeRemaining(bonusStatus.remainingMs)}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          
          {!canSpin && !canBonusSpin && spinState === "idle" && (
            <p className="text-sm text-center text-muted-foreground" data-testid="text-no-tickets">
              No tickets remaining
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
