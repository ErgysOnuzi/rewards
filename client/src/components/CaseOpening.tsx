import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, RotateCw, Gift, Clock, Volume2, VolumeX, Sparkles, Trophy } from "lucide-react";
import { CASE_PRIZES, PRIZE_COLORS, type CasePrize } from "@shared/schema";
import { playSpinStart, playSpinTick, playWinSound, playLoseSound, resumeAudioContext, setSoundEnabled, isSoundEnabled } from "@/lib/sounds";
import { motion, AnimatePresence } from "framer-motion";

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

interface Confetti {
  id: number;
  x: number;
  color: string;
  delay: number;
  duration: number;
}

interface RecentWin {
  id: number;
  prizeLabel: string;
  prizeColor: CasePrize["color"];
  timestamp: Date;
}

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

function getPrizeGlowClass(color: CasePrize["color"]) {
  const glows = {
    grey: "shadow-gray-500/50",
    lightblue: "shadow-blue-500/50",
    green: "shadow-emerald-500/50",
    red: "shadow-red-500/50",
    gold: "shadow-yellow-400/70",
  };
  return glows[color];
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

function generateConfetti(count: number): Confetti[] {
  const colors = ["#FFD700", "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8"];
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    color: colors[Math.floor(Math.random() * colors.length)],
    delay: Math.random() * 0.5,
    duration: 2 + Math.random() * 2,
  }));
}

function ConfettiEffect({ active }: { active: boolean }) {
  const [confetti, setConfetti] = useState<Confetti[]>([]);

  useEffect(() => {
    if (active) {
      setConfetti(generateConfetti(50));
      const timer = setTimeout(() => setConfetti([]), 4000);
      return () => clearTimeout(timer);
    } else {
      setConfetti([]);
    }
  }, [active]);

  if (!active || confetti.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {confetti.map((piece) => (
        <motion.div
          key={piece.id}
          className="absolute w-3 h-3 rounded-sm"
          style={{
            left: `${piece.x}%`,
            backgroundColor: piece.color,
          }}
          initial={{ y: -20, opacity: 1, rotate: 0 }}
          animate={{
            y: "100vh",
            opacity: [1, 1, 0],
            rotate: 360 * (Math.random() > 0.5 ? 1 : -1),
          }}
          transition={{
            duration: piece.duration,
            delay: piece.delay,
            ease: "easeIn",
          }}
        />
      ))}
    </div>
  );
}

function ScreenShake({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <motion.div
      animate={active ? {
        x: [0, -5, 5, -5, 5, -3, 3, -2, 2, 0],
        y: [0, -3, 3, -3, 3, -2, 2, -1, 1, 0],
      } : {}}
      transition={{ duration: 0.5 }}
    >
      {children}
    </motion.div>
  );
}

function AnimatedTicketCounter({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (value !== displayValue) {
      setIsAnimating(true);
      const timer = setTimeout(() => {
        setDisplayValue(value);
        setIsAnimating(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [value, displayValue]);

  return (
    <motion.span
      className="text-3xl font-bold font-mono text-primary inline-block"
      animate={isAnimating ? { scale: [1, 1.2, 1], color: ["hsl(var(--primary))", "#ff6b6b", "hsl(var(--primary))"] } : {}}
      transition={{ duration: 0.3 }}
    >
      {displayValue}
    </motion.span>
  );
}

function RecentWinsDisplay({ wins }: { wins: RecentWin[] }) {
  if (wins.length === 0) return null;

  return (
    <div className="flex flex-wrap justify-center gap-2 mt-4">
      <AnimatePresence mode="popLayout">
        {wins.slice(0, 5).map((win) => (
          <motion.div
            key={win.id}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
          >
            <Badge className={`${getPrizeBadgeVariant(win.prizeColor)} text-xs`}>
              {win.prizeLabel}
            </Badge>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
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
  const [showConfetti, setShowConfetti] = useState(false);
  const [showScreenShake, setShowScreenShake] = useState(false);
  const [recentWins, setRecentWins] = useState<RecentWin[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
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

  const triggerWinEffects = (prizeValue: number, prizeColor: CasePrize["color"], prizeLabel: string) => {
    if (prizeValue > 0) {
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4000);
      
      if (prizeValue >= 25) {
        setShowScreenShake(true);
        setTimeout(() => setShowScreenShake(false), 500);
      }

      setRecentWins(prev => [{
        id: Date.now(),
        prizeLabel,
        prizeColor,
        timestamp: new Date(),
      }, ...prev].slice(0, 5));
    }
  };

  const handleSpin = async () => {
    if (!canSpin) return;
    
    resumeAudioContext();
    playSpinStart();
    
    setSpinState("spinning");
    setShowResultModal(false);
    setHighlightedIndex(null);
    
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
        
        setHighlightedIndex(targetIndex);
        
        if (result.prizeValue > 0) {
          playWinSound();
          triggerWinEffects(result.prizeValue, result.prizeColor, result.prizeLabel);
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
    setHighlightedIndex(null);

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
        
        setHighlightedIndex(targetIndex);
        
        if (result.prize_value > 0) {
          playWinSound();
          triggerWinEffects(result.prize_value, result.prize_color as CasePrize["color"], result.prize_label);
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
    setHighlightedIndex(null);
  };

  const formatTimeRemaining = (ms: number) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  return (
    <>
      <ConfettiEffect active={showConfetti} />
      
      <ScreenShake active={showScreenShake}>
        <Card className="w-full max-w-2xl mx-auto overflow-visible">
          <CardContent className="pt-6 space-y-6">
            <div className="flex items-center justify-between">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Tickets Available</p>
                <AnimatedTicketCounter value={ticketsRemaining} />
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
                      <motion.div
                        key={index}
                        className={`flex-shrink-0 w-[100px] h-20 mx-0.5 rounded-md border-2 flex items-center justify-center ${getPrizeColorClasses(item.color)} ${
                          highlightedIndex === index ? `shadow-lg ${getPrizeGlowClass(item.color)} ring-2 ring-white/50` : ""
                        }`}
                        animate={highlightedIndex === index ? {
                          scale: [1, 1.05, 1],
                          boxShadow: ["0 0 0px rgba(255,255,255,0)", "0 0 30px rgba(255,255,255,0.8)", "0 0 15px rgba(255,255,255,0.4)"],
                        } : {}}
                        transition={{ duration: 0.5, repeat: highlightedIndex === index ? 2 : 0 }}
                      >
                        <span className="text-lg font-bold">{item.label}</span>
                      </motion.div>
                    ))
                  ) : (
                    <div className="flex items-center justify-center w-full h-full">
                      <span className="text-muted-foreground">Ready to spin</span>
                    </div>
                  )}
                </div>
                
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1 h-full bg-primary z-10" />
                <motion.div 
                  className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[10px] border-t-primary z-10"
                  animate={spinState === "spinning" ? { y: [0, 2, 0] } : {}}
                  transition={{ duration: 0.2, repeat: Infinity }}
                />
                <motion.div 
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[10px] border-b-primary z-10"
                  animate={spinState === "spinning" ? { y: [0, -2, 0] } : {}}
                  transition={{ duration: 0.2, repeat: Infinity }}
                />
              </div>
            </div>

            <div className="grid grid-cols-5 gap-2 text-center text-xs">
              {CASE_PRIZES.map((prize, index) => (
                <motion.div 
                  key={index} 
                  className="space-y-1"
                  whileHover={{ scale: 1.05 }}
                  transition={{ type: "spring", stiffness: 400 }}
                >
                  <div className={`h-8 rounded flex items-center justify-center ${getPrizeColorClasses(prize.color)}`}>
                    <span className="font-semibold">{prize.label}</span>
                  </div>
                  <p className="text-muted-foreground">{prize.probability}%</p>
                </motion.div>
              ))}
            </div>

            <RecentWinsDisplay wins={recentWins} />

            <div className="space-y-3">
              {spinState === "result" ? (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 400 }}
                >
                  <Button 
                    onClick={resetSpin} 
                    className="w-full"
                    disabled={ticketsRemaining <= 0}
                    data-testid="button-spin-again"
                  >
                    <RotateCw className="w-4 h-4 mr-2" />
                    {ticketsRemaining > 0 ? "Spin Again" : "No Tickets Left"}
                  </Button>
                </motion.div>
              ) : (
                <>
                  <motion.div
                    whileHover={{ scale: canSpin ? 1.02 : 1 }}
                    whileTap={{ scale: canSpin ? 0.98 : 1 }}
                  >
                    <Button 
                      onClick={handleSpin}
                      disabled={!canSpin}
                      className={`w-full relative overflow-visible ${canSpin ? "" : ""}`}
                      size="lg"
                      data-testid="button-spin"
                    >
                      {spinState === "spinning" && !isBonusSpin ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Opening Case...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-2" />
                          Open Case (1 Ticket)
                        </>
                      )}
                    </Button>
                  </motion.div>

                  {onBonusSpin && (
                    <div className="pt-2 border-t border-border/50">
                      {isBonusSpin && spinState === "spinning" ? (
                        <Button 
                          disabled
                          variant="outline"
                          className="w-full"
                          size="lg"
                          data-testid="button-bonus-spin"
                        >
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Opening Bonus Case...
                        </Button>
                      ) : canBonusSpin ? (
                        <motion.div
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          <Button 
                            onClick={handleBonusSpin}
                            variant="outline"
                            className="w-full"
                            size="lg"
                            data-testid="button-bonus-spin"
                          >
                            <Gift className="w-4 h-4 mr-2" />
                            Daily Bonus (Free)
                          </Button>
                        </motion.div>
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
      </ScreenShake>

      <Dialog open={showResultModal} onOpenChange={setShowResultModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center">
              {lastResult?.prizeValue && lastResult.prizeValue > 0 ? (
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 200, damping: 15 }}
                  className="inline-flex items-center gap-2"
                >
                  <Trophy className="w-8 h-8 text-yellow-500" />
                  <span className="text-2xl text-primary">You Won!</span>
                  <Trophy className="w-8 h-8 text-yellow-500" />
                </motion.div>
              ) : (
                <span className="text-2xl text-muted-foreground">No Prize</span>
              )}
            </DialogTitle>
          </DialogHeader>
          
          {lastResult && (
            <div className="space-y-4 text-center">
              <motion.div 
                className={`inline-block px-6 py-3 rounded-lg ${getPrizeBadgeVariant(lastResult.prizeColor)} ${
                  lastResult.prizeValue > 0 ? `shadow-lg ${getPrizeGlowClass(lastResult.prizeColor)}` : ""
                }`}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.2 }}
              >
                <span className="text-3xl font-bold">{lastResult.prizeLabel}</span>
              </motion.div>
              
              <motion.div 
                className="flex items-center justify-center gap-2"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                <Badge variant="secondary">
                  {lastResult.ticketsRemainingAfter} tickets left
                </Badge>
              </motion.div>
              
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <Button 
                  onClick={resetSpin}
                  className="w-full"
                  disabled={ticketsRemaining <= 0}
                  data-testid="button-modal-spin-again"
                >
                  {ticketsRemaining > 0 ? "Spin Again" : "No Tickets Left"}
                </Button>
              </motion.div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
