import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, RotateCw, Gift, Clock, Volume2, VolumeX } from "lucide-react";
import { CASE_PRIZES, PRIZE_COLORS, type CasePrize } from "@shared/schema";
import { playSpinStart, playSpinTick, playWinSound, playLoseSound, resumeAudioContext, setSoundEnabled, isSoundEnabled } from "@/lib/sounds";

export interface CaseSpinResult {
  result: "WIN" | "LOSE";
  prizeLabel: string;
  prizeValue: number;
  prizeColor: "grey" | "lightblue" | "green" | "red" | "gold";
  ticketsTotal: number;
  ticketsUsedAfter: number;
  ticketsRemainingAfter: number;
  walletBalance: number;
}

export interface BonusStatus {
  available: boolean;
  remainingMs: number;
  nextBonusAt: string | null;
}

interface CaseOpeningProps {
  ticketsRemaining: number;
  stakeId: string;
  onSpin: () => Promise<CaseSpinResult>;
  onBonusSpin?: () => Promise<{ result: string; prize_label: string; prize_value: number; prize_color: string; wallet_balance: number }>;
  onSpinComplete?: (result: CaseSpinResult) => void;
  onSpinError?: (error: Error) => void;
  bonusStatus?: BonusStatus;
  onBonusUsed?: () => void;
}

type SpinState = "idle" | "spinning" | "result";

function generateReelItems(targetPrize: CasePrize, itemCount: number = 50): CasePrize[] {
  const items: CasePrize[] = [];
  
  for (let i = 0; i < itemCount; i++) {
    let selectedPrize: CasePrize;
    const random = Math.random() * 100;
    let cumulative = 0;
    selectedPrize = CASE_PRIZES[0];
    
    for (const prize of CASE_PRIZES) {
      cumulative += prize.probability;
      if (random <= cumulative) {
        selectedPrize = prize;
        break;
      }
    }
    
    items.push(selectedPrize);
  }
  
  const targetIndex = Math.floor(itemCount * 0.75);
  items[targetIndex] = targetPrize;
  
  return items;
}

function getPrizeColorClasses(color: CasePrize["color"]) {
  const colors = {
    grey: "bg-gray-600 border-gray-500 text-white",
    lightblue: "bg-blue-500 border-blue-400 text-white",
    green: "bg-emerald-500 border-emerald-400 text-white",
    red: "bg-red-500 border-red-400 text-white",
    gold: "bg-gradient-to-b from-yellow-400 to-amber-500 border-yellow-300 text-black font-bold",
  };
  return colors[color];
}

function getPrizeBadgeVariant(color: CasePrize["color"]) {
  const variants: Record<string, string> = {
    grey: "bg-gray-500 text-white",
    lightblue: "bg-blue-500 text-white",
    green: "bg-emerald-500 text-white",
    red: "bg-red-500 text-white",
    gold: "bg-yellow-500 text-black",
  };
  return variants[color];
}

export default function CaseOpening({ 
  ticketsRemaining, 
  stakeId,
  onSpin, 
  onBonusSpin,
  onSpinComplete, 
  onSpinError,
  bonusStatus,
  onBonusUsed,
}: CaseOpeningProps) {
  const [spinState, setSpinState] = useState<SpinState>("idle");
  const [lastResult, setLastResult] = useState<CaseSpinResult | null>(null);
  const [reelItems, setReelItems] = useState<CasePrize[]>([]);
  const [reelPosition, setReelPosition] = useState(0);
  const [isBonusSpin, setIsBonusSpin] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [soundOn, setSoundOn] = useState(isSoundEnabled());
  const tickIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reelRef = useRef<HTMLDivElement>(null);

  const canSpin = ticketsRemaining > 0 && spinState === "idle";
  const canBonusSpin = bonusStatus?.available && spinState === "idle";

  useEffect(() => {
    return () => {
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
      }
    };
  }, []);

  const toggleSound = () => {
    const newState = !soundOn;
    setSoundOn(newState);
    setSoundEnabled(newState);
  };

  const handleSpin = async () => {
    if (!canSpin) return;
    
    resumeAudioContext();
    playSpinStart();
    
    setSpinState("spinning");
    setShowResultModal(false);
    
    try {
      const result = await onSpin();
      
      const targetPrize: CasePrize = {
        value: result.prizeValue,
        probability: 0,
        label: result.prizeLabel,
        color: result.prizeColor,
      };
      
      const items = generateReelItems(targetPrize, 50);
      setReelItems(items);
      
      const itemWidth = 100;
      const targetIndex = Math.floor(items.length * 0.75);
      const containerWidth = reelRef.current?.offsetWidth || 400;
      const centerOffset = containerWidth / 2 - itemWidth / 2;
      const finalPosition = -(targetIndex * itemWidth) + centerOffset;
      
      setReelPosition(0);
      
      requestAnimationFrame(() => {
        setReelPosition(finalPosition);
      });
      
      let tickCount = 0;
      tickIntervalRef.current = setInterval(() => {
        playSpinTick();
        tickCount++;
        if (tickCount > 30) {
          if (tickIntervalRef.current) {
            clearInterval(tickIntervalRef.current);
            tickIntervalRef.current = null;
          }
        }
      }, 80);
      
      setTimeout(() => {
        if (tickIntervalRef.current) {
          clearInterval(tickIntervalRef.current);
          tickIntervalRef.current = null;
        }
        
        if (result.prizeValue > 0) {
          playWinSound();
        } else {
          playLoseSound();
        }
        
        setLastResult(result);
        setSpinState("result");
        setShowResultModal(true);
        onSpinComplete?.(result);
      }, 3500);
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
    setShowResultModal(false);

    try {
      const result = await onBonusSpin();
      
      const targetPrize: CasePrize = {
        value: result.prize_value,
        probability: 0,
        label: result.prize_label,
        color: result.prize_color as CasePrize["color"],
      };
      
      const items = generateReelItems(targetPrize, 50);
      setReelItems(items);
      
      const itemWidth = 100;
      const targetIndex = Math.floor(items.length * 0.75);
      const containerWidth = reelRef.current?.offsetWidth || 400;
      const centerOffset = containerWidth / 2 - itemWidth / 2;
      const finalPosition = -(targetIndex * itemWidth) + centerOffset;
      
      setReelPosition(0);
      
      requestAnimationFrame(() => {
        setReelPosition(finalPosition);
      });
      
      let tickCount = 0;
      tickIntervalRef.current = setInterval(() => {
        playSpinTick();
        tickCount++;
        if (tickCount > 30) {
          if (tickIntervalRef.current) {
            clearInterval(tickIntervalRef.current);
            tickIntervalRef.current = null;
          }
        }
      }, 80);
      
      setTimeout(() => {
        if (tickIntervalRef.current) {
          clearInterval(tickIntervalRef.current);
          tickIntervalRef.current = null;
        }
        
        if (result.prize_value > 0) {
          playWinSound();
        } else {
          playLoseSound();
        }

        const spinResult: CaseSpinResult = {
          result: result.prize_value > 0 ? "WIN" : "LOSE",
          prizeLabel: result.prize_label,
          prizeValue: result.prize_value,
          prizeColor: result.prize_color as CasePrize["color"],
          ticketsTotal: 0,
          ticketsUsedAfter: 0,
          ticketsRemainingAfter: ticketsRemaining,
          walletBalance: result.wallet_balance,
        };

        setLastResult(spinResult);
        setSpinState("result");
        setShowResultModal(true);
        onBonusUsed?.();
      }, 3500);
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
    setShowResultModal(false);
    setIsBonusSpin(false);
  };

  const formatTimeRemaining = (ms: number) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  return (
    <>
      <Card className="w-full max-w-2xl mx-auto">
        <CardContent className="pt-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Tickets Available</p>
              <p className="text-3xl font-bold font-mono text-primary" data-testid="text-tickets-remaining">
                {ticketsRemaining}
              </p>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={toggleSound}
              data-testid="button-toggle-sound"
            >
              {soundOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </Button>
          </div>

          <div className="relative">
            <div 
              className="relative h-24 overflow-hidden rounded-lg border-2 border-primary/30 bg-muted/50"
              ref={reelRef}
              data-testid="case-reel"
            >
              <div 
                className="absolute top-0 left-0 h-full flex items-center"
                style={{
                  transform: `translateX(${reelPosition}px)`,
                  transition: spinState === "spinning" ? "transform 3.5s cubic-bezier(0.15, 0.85, 0.25, 1)" : "none",
                }}
              >
                {reelItems.length > 0 ? (
                  reelItems.map((item, index) => (
                    <div
                      key={index}
                      className={`flex-shrink-0 w-[100px] h-20 mx-0.5 rounded-md border-2 flex items-center justify-center ${getPrizeColorClasses(item.color)}`}
                    >
                      <span className="text-lg font-bold">{item.label}</span>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-center w-full h-full">
                    <span className="text-muted-foreground">Ready to spin</span>
                  </div>
                )}
              </div>
              
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1 h-full bg-primary z-10" />
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[10px] border-t-primary z-10" />
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[10px] border-b-primary z-10" />
            </div>
          </div>

          <div className="grid grid-cols-5 gap-2 text-center text-xs">
            {CASE_PRIZES.map((prize, index) => (
              <div key={index} className="space-y-1">
                <div className={`h-8 rounded flex items-center justify-center ${getPrizeColorClasses(prize.color)}`}>
                  <span className="font-semibold">{prize.label}</span>
                </div>
                <p className="text-muted-foreground">{prize.probability}%</p>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {spinState === "result" ? (
              <Button 
                onClick={resetSpin} 
                className="w-full"
                disabled={ticketsRemaining <= 0}
                data-testid="button-spin-again"
              >
                <RotateCw className="w-4 h-4 mr-2" />
                {ticketsRemaining > 0 ? "Spin Again" : "No Tickets Left"}
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
                      Opening Case...
                    </>
                  ) : (
                    "Open Case (1 Ticket)"
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
                            Opening Bonus Case...
                          </>
                        ) : (
                          <>
                            <Gift className="w-4 h-4 mr-2" />
                            Daily Bonus (Free)
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

      <Dialog open={showResultModal} onOpenChange={setShowResultModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center">
              {lastResult?.prizeValue && lastResult.prizeValue > 0 ? (
                <span className="text-2xl text-primary">You Won!</span>
              ) : (
                <span className="text-2xl text-muted-foreground">No Prize</span>
              )}
            </DialogTitle>
          </DialogHeader>
          
          {lastResult && (
            <div className="space-y-4 text-center">
              <div className={`inline-block px-6 py-3 rounded-lg ${getPrizeBadgeVariant(lastResult.prizeColor)}`}>
                <span className="text-3xl font-bold">{lastResult.prizeLabel}</span>
              </div>
              
              <div className="flex items-center justify-center gap-2">
                <Badge variant="secondary">
                  {lastResult.ticketsRemainingAfter} tickets left
                </Badge>
              </div>
              
              <Button 
                onClick={resetSpin}
                className="w-full"
                disabled={ticketsRemaining <= 0}
                data-testid="button-modal-spin-again"
              >
                {ticketsRemaining > 0 ? "Spin Again" : "No Tickets Left"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
