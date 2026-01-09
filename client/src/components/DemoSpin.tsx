import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Gift, Sparkles } from "lucide-react";
import { CASE_PRIZES, type CasePrize } from "@shared/schema";
import { motion, AnimatePresence } from "framer-motion";
import { playSpinStart, playSpinTick, playWinSound, playLoseSound, resumeAudioContext, isSoundEnabled } from "@/lib/sounds";
import { useLocation } from "wouter";

interface DemoSpinProps {
  onLoginClick: () => void;
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

export default function DemoSpin({ onLoginClick }: DemoSpinProps) {
  const [spinState, setSpinState] = useState<SpinState>("idle");
  const [lastResult, setLastResult] = useState<{ result: string; prize_label: string; prize_color: string } | null>(null);
  const [reelItems, setReelItems] = useState<CasePrize[]>([]);
  const [reelPosition, setReelPosition] = useState(0);
  const [, navigate] = useLocation();
  
  const reelRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const tickIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const handleDemoSpin = async () => {
    if (spinState !== "idle") return;
    
    resumeAudioContext();
    setSpinState("spinning");
    setLastResult(null);

    try {
      const response = await fetch("/api/spin/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error("Demo spin failed");
      }

      const data = await response.json();
      
      const targetPrize: CasePrize = {
        label: data.prize_label,
        value: data.prize_value,
        probability: 0,
        color: data.prize_color,
      };

      const items = generateReelItems(targetPrize);
      setReelItems(items);

      if (isSoundEnabled()) {
        playSpinStart();
      }

      animateReel(items, targetPrize, data);
    } catch (err) {
      console.error("Demo spin error:", err);
      setSpinState("idle");
    }
  };

  const animateReel = (items: CasePrize[], targetPrize: CasePrize, result: any) => {
    const itemHeight = 80;
    const targetIndex = Math.floor(items.length * 0.75);
    const targetPosition = targetIndex * itemHeight;
    
    const duration = 4000;
    const startTime = Date.now();
    const startPosition = 0;
    
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
    }
    
    let lastTickPosition = 0;
    tickIntervalRef.current = setInterval(() => {
      const currentPosition = reelRef.current ? 
        parseInt(reelRef.current.style.transform?.replace(/[^0-9-]/g, '') || '0') : 0;
      const tickThreshold = itemHeight / 2;
      
      if (Math.abs(currentPosition - lastTickPosition) >= tickThreshold) {
        if (isSoundEnabled()) {
          playSpinTick();
        }
        lastTickPosition = Math.floor(currentPosition / tickThreshold) * tickThreshold;
      }
    }, 50);
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const eased = 1 - Math.pow(1 - progress, 4);
      const currentPosition = startPosition + (targetPosition * eased);
      
      setReelPosition(-currentPosition);
      
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        if (tickIntervalRef.current) {
          clearInterval(tickIntervalRef.current);
          tickIntervalRef.current = null;
        }
        
        setLastResult(result);
        setSpinState("result");
        
        if (isSoundEnabled()) {
          if (result.result === "WIN") {
            playWinSound();
          } else {
            playLoseSound();
          }
        }
      }
    };
    
    animationRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (tickIntervalRef.current) {
        clearInterval(tickIntervalRef.current);
      }
    };
  }, []);

  const resetSpin = () => {
    setSpinState("idle");
    setLastResult(null);
    setReelItems([]);
    setReelPosition(0);
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="pt-6 space-y-6">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold">Try a Demo Spin</h3>
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">
            Experience the thrill of spinning! No login required.
          </p>
        </div>

        <div className="relative h-[240px] bg-gradient-to-b from-background via-muted/30 to-background rounded-lg overflow-hidden border">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="w-full h-[80px] border-y-2 border-primary/50 bg-primary/5" />
          </div>
          
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-3 h-8 bg-primary rounded-r-sm z-20" />
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-8 bg-primary rounded-l-sm z-20" />
          
          <div className="h-full flex items-center justify-center overflow-hidden">
            {reelItems.length > 0 ? (
              <div 
                ref={reelRef}
                className="flex flex-col transition-none"
                style={{ transform: `translateY(${reelPosition + 80}px)` }}
              >
                {reelItems.map((prize, index) => (
                  <div 
                    key={index} 
                    className="h-[80px] flex items-center justify-center px-4"
                  >
                    <div className={`w-full max-w-[200px] h-[60px] rounded-lg border-2 flex items-center justify-center ${getPrizeColorClasses(prize.color)}`}>
                      <span className="text-lg font-bold">{prize.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground text-center">
                <Gift className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Click spin to try!</p>
              </div>
            )}
          </div>
        </div>

        <AnimatePresence>
          {lastResult && spinState === "result" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center space-y-3"
            >
              <Badge 
                className={`text-lg px-4 py-1 ${lastResult.result === "WIN" ? "bg-emerald-500" : "bg-gray-500"}`}
              >
                {lastResult.result === "WIN" ? "Demo Win!" : "Try Again!"}
              </Badge>
              <p className="text-sm text-muted-foreground">
                {lastResult.result === "WIN" 
                  ? "Nice! Create an account to win real prizes!"
                  : "Don't worry, the real spins have prizes too!"}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-3">
          {spinState === "idle" && (
            <Button 
              onClick={handleDemoSpin}
              className="w-full"
              size="lg"
              data-testid="button-demo-spin"
            >
              <Gift className="w-5 h-5 mr-2" />
              Try Demo Spin
            </Button>
          )}

          {spinState === "spinning" && (
            <Button disabled className="w-full" size="lg">
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Spinning...
            </Button>
          )}

          {spinState === "result" && (
            <div className="space-y-2">
              <Button 
                onClick={resetSpin}
                variant="outline"
                className="w-full"
                data-testid="button-spin-again"
              >
                Spin Again
              </Button>
              <Button 
                onClick={onLoginClick}
                className="w-full"
                size="lg"
                data-testid="button-create-account"
              >
                Create Account for Real Prizes
              </Button>
            </div>
          )}

          {spinState === "idle" && (
            <p className="text-xs text-center text-muted-foreground">
              This is a demo spin. Create an account to earn real tickets and win prizes!
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
