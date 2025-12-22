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
  shape: "square" | "circle" | "triangle" | "star";
  size: number;
  rotation: number;
  swingAmplitude: number;
}

interface Sparkle {
  id: number;
  x: number;
  y: number;
  size: number;
  delay: number;
}

interface GoldCoin {
  id: number;
  x: number;
  delay: number;
  rotation: number;
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
  const colors = ["#FFD700", "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#FF69B4", "#00FF7F", "#FF4500", "#9400D3"];
  const shapes: Confetti["shape"][] = ["square", "circle", "triangle", "star"];
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    color: colors[Math.floor(Math.random() * colors.length)],
    delay: Math.random() * 0.8,
    duration: 2.5 + Math.random() * 2.5,
    shape: shapes[Math.floor(Math.random() * shapes.length)],
    size: 8 + Math.random() * 12,
    rotation: Math.random() * 360,
    swingAmplitude: 20 + Math.random() * 40,
  }));
}

function generateSparkles(count: number): Sparkle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: 20 + Math.random() * 60,
    y: 20 + Math.random() * 60,
    size: 4 + Math.random() * 8,
    delay: Math.random() * 1.5,
  }));
}

function generateGoldCoins(count: number): GoldCoin[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 1.2,
    rotation: Math.random() * 720 - 360,
  }));
}

function ConfettiShape({ shape, color, size }: { shape: Confetti["shape"]; color: string; size: number }) {
  if (shape === "circle") {
    return <div className="rounded-full" style={{ width: size, height: size, backgroundColor: color }} />;
  }
  if (shape === "triangle") {
    return (
      <div style={{
        width: 0,
        height: 0,
        borderLeft: `${size/2}px solid transparent`,
        borderRight: `${size/2}px solid transparent`,
        borderBottom: `${size}px solid ${color}`,
      }} />
    );
  }
  if (shape === "star") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
      </svg>
    );
  }
  return <div style={{ width: size, height: size, backgroundColor: color }} />;
}

function ConfettiEffect({ active, intensity = "normal" }: { active: boolean; intensity?: "normal" | "big" }) {
  const [confetti, setConfetti] = useState<Confetti[]>([]);
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  useEffect(() => {
    if (active) {
      const count = intensity === "big" ? 120 : 80;
      setConfetti(generateConfetti(count));
      setSparkles(generateSparkles(intensity === "big" ? 20 : 10));
      const timer = setTimeout(() => {
        setConfetti([]);
        setSparkles([]);
      }, 5000);
      return () => clearTimeout(timer);
    } else {
      setConfetti([]);
      setSparkles([]);
    }
  }, [active, intensity]);

  if (!active || confetti.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {confetti.map((piece) => (
        <motion.div
          key={piece.id}
          className="absolute"
          style={{ left: `${piece.x}%` }}
          initial={{ y: -30, opacity: 1, rotate: piece.rotation, x: 0 }}
          animate={{
            y: "110vh",
            opacity: [1, 1, 1, 0],
            rotate: piece.rotation + 720 * (piece.id % 2 === 0 ? 1 : -1),
            x: [0, piece.swingAmplitude, -piece.swingAmplitude, piece.swingAmplitude / 2, 0],
          }}
          transition={{
            duration: piece.duration,
            delay: piece.delay,
            ease: [0.25, 0.46, 0.45, 0.94],
            x: { duration: piece.duration, repeat: Infinity, repeatType: "reverse" },
          }}
        >
          <ConfettiShape shape={piece.shape} color={piece.color} size={piece.size} />
        </motion.div>
      ))}
      {sparkles.map((sparkle) => (
        <motion.div
          key={`sparkle-${sparkle.id}`}
          className="absolute"
          style={{ left: `${sparkle.x}%`, top: `${sparkle.y}%` }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{
            scale: [0, 1.5, 0],
            opacity: [0, 1, 0],
            rotate: [0, 180],
          }}
          transition={{
            duration: 0.8,
            delay: sparkle.delay,
            repeat: 2,
            repeatDelay: 0.5,
          }}
        >
          <Sparkles className="text-yellow-400" style={{ width: sparkle.size * 3, height: sparkle.size * 3 }} />
        </motion.div>
      ))}
    </div>
  );
}

function GoldCoinRain({ active }: { active: boolean }) {
  const [coins, setCoins] = useState<GoldCoin[]>([]);

  useEffect(() => {
    if (active) {
      setCoins(generateGoldCoins(25));
      const timer = setTimeout(() => setCoins([]), 4000);
      return () => clearTimeout(timer);
    } else {
      setCoins([]);
    }
  }, [active]);

  if (!active || coins.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {coins.map((coin) => (
        <motion.div
          key={coin.id}
          className="absolute text-4xl"
          style={{ left: `${coin.x}%` }}
          initial={{ y: -50, opacity: 1, rotateY: 0 }}
          animate={{
            y: "110vh",
            opacity: [1, 1, 0.8, 0],
            rotateY: coin.rotation,
          }}
          transition={{
            duration: 3 + Math.random(),
            delay: coin.delay,
            ease: "easeIn",
          }}
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-yellow-300 via-yellow-500 to-yellow-600 border-2 border-yellow-700 shadow-lg flex items-center justify-center text-yellow-900 font-bold text-xs">
            $
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function WinGlow({ active, color }: { active: boolean; color: string }) {
  if (!active) return null;
  
  const glowColor = {
    grey: "rgba(156, 163, 175, 0.3)",
    lightblue: "rgba(59, 130, 246, 0.4)",
    green: "rgba(16, 185, 129, 0.4)",
    red: "rgba(239, 68, 68, 0.5)",
    gold: "rgba(234, 179, 8, 0.6)",
  }[color] || "rgba(234, 179, 8, 0.4)";

  return (
    <motion.div
      className="fixed inset-0 pointer-events-none z-40"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 0.8, 0.3, 0.6, 0.2, 0] }}
      transition={{ duration: 2, ease: "easeOut" }}
      style={{ background: `radial-gradient(circle at 50% 50%, ${glowColor}, transparent 70%)` }}
    />
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
  const [confettiIntensity, setConfettiIntensity] = useState<"normal" | "big">("normal");
  const [showGoldCoins, setShowGoldCoins] = useState(false);
  const [showWinGlow, setShowWinGlow] = useState(false);
  const [winGlowColor, setWinGlowColor] = useState<string>("gold");
  const [showScreenShake, setShowScreenShake] = useState(false);
  const [recentWins, setRecentWins] = useState<RecentWin[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const tickIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reelRef = useRef<HTMLDivElement>(null);

  const canSpin = ticketsRemaining > 0 && (spinState === "idle" || spinState === "result");
  const canBonusSpin = bonusStatus?.available && (spinState === "idle" || spinState === "result");

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
      // Show win glow for all wins
      setWinGlowColor(prizeColor);
      setShowWinGlow(true);
      setTimeout(() => setShowWinGlow(false), 2500);

      // Confetti intensity based on prize value
      if (prizeValue >= 25) {
        setConfettiIntensity("big");
        setShowGoldCoins(true);
        setTimeout(() => setShowGoldCoins(false), 4000);
      } else {
        setConfettiIntensity("normal");
      }
      
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 5000);
      
      // Screen shake for big wins
      if (prizeValue >= 25) {
        setShowScreenShake(true);
        setTimeout(() => setShowScreenShake(false), 600);
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
    
    setShowResultModal(false);
    setHighlightedIndex(null);
    setReelPosition(0);
    
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
      
      // Item width (100px) + gap (4px from gap-1) = 104px per slot
      const itemWidth = 100;
      const gapWidth = 4;
      const slotWidth = itemWidth + gapWidth;
      const targetIndex = Math.floor(items.length * 0.75);
      const containerWidth = reelRef.current?.offsetWidth || 400;
      const centerOffset = containerWidth / 2 - itemWidth / 2;
      const finalPosition = -(targetIndex * slotWidth) + centerOffset;
      
      setSpinState("spinning");
      
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
      
      // Use RAF to ensure animation starts, then start timer from that point
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setReelPosition(finalPosition);
          
          // Start timeout AFTER animation begins to ensure sync
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
        });
      });
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
    setShowResultModal(false);
    setHighlightedIndex(null);
    setReelPosition(0);

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
      
      // Item width (100px) + gap (4px from gap-1) = 104px per slot
      const itemWidth = 100;
      const gapWidth = 4;
      const slotWidth = itemWidth + gapWidth;
      const targetIndex = Math.floor(items.length * 0.75);
      const containerWidth = reelRef.current?.offsetWidth || 400;
      const centerOffset = containerWidth / 2 - itemWidth / 2;
      const finalPosition = -(targetIndex * slotWidth) + centerOffset;
      
      setSpinState("spinning");
      
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
      
      // Use RAF to ensure animation starts, then start timer from that point
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setReelPosition(finalPosition);
          
          // Start timeout AFTER animation begins to ensure sync
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
        });
      });
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
      <ConfettiEffect active={showConfetti} intensity={confettiIntensity} />
      <GoldCoinRain active={showGoldCoins} />
      <WinGlow active={showWinGlow} color={winGlowColor} />
      
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
                  className="absolute top-0 left-0 h-full flex items-center gap-1"
                  style={{
                    transform: `translateX(${reelPosition}px)`,
                    transition: spinState === "spinning" ? "transform 3.5s cubic-bezier(0.15, 0.85, 0.25, 1)" : "none",
                  }}
                >
                  {reelItems.length > 0 ? (
                    reelItems.map((item, index) => (
                      <motion.div
                        key={index}
                        className={`flex-shrink-0 w-[100px] h-20 rounded-md border-2 flex items-center justify-center ${getPrizeColorClasses(item.color)} ${
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
