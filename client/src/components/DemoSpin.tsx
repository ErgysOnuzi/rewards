import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Gift, Sparkles } from "lucide-react";
import { CASE_PRIZES, type CasePrize } from "@shared/schema";
import { motion, AnimatePresence } from "framer-motion";
import { playSpinStart, playSpinTick, playWinSound, playLoseSound, resumeAudioContext, isSoundEnabled } from "@/lib/sounds";

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
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  
  const reelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tickIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const handleDemoSpin = async () => {
    if (spinState !== "idle") return;
    
    resumeAudioContext();
    setSpinState("spinning");
    setLastResult(null);
    setHighlightedIndex(null);

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

      const itemWidth = 100;
      const gapWidth = 4;
      const slotWidth = itemWidth + gapWidth;
      const targetIndex = Math.floor(items.length * 0.75);
      const containerWidth = containerRef.current?.offsetWidth || 400;
      const centerOffset = containerWidth / 2 - itemWidth / 2;
      const finalPosition = -(targetIndex * slotWidth) + centerOffset;

      if (isSoundEnabled()) {
        let lastTickPos = 0;
        tickIntervalRef.current = setInterval(() => {
          const currentPos = Math.abs(reelPosition);
          if (Math.abs(currentPos - lastTickPos) >= slotWidth / 2) {
            playSpinTick();
            lastTickPos = Math.floor(currentPos / (slotWidth / 2)) * (slotWidth / 2);
          }
        }, 50);
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setReelPosition(finalPosition);
          
          setTimeout(() => {
            if (tickIntervalRef.current) {
              clearInterval(tickIntervalRef.current);
              tickIntervalRef.current = null;
            }
            
            setHighlightedIndex(targetIndex);
            
            if (data.result === "WIN") {
              playWinSound();
            } else {
              playLoseSound();
            }
            
            setLastResult(data);
            setSpinState("result");
          }, 3500);
        });
      });
    } catch (err) {
      console.error("Demo spin error:", err);
      setSpinState("idle");
    }
  };

  useEffect(() => {
    return () => {
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
    setHighlightedIndex(null);
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

        <div 
          ref={containerRef}
          className="relative h-[100px] bg-gradient-to-r from-background via-muted/30 to-background rounded-lg overflow-hidden border"
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[100px] border-x-2 border-primary/50 bg-primary/5 z-10 pointer-events-none" />
          
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-4 bg-primary rotate-45 -translate-y-1/2 z-20" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-4 bg-primary rotate-45 translate-y-1/2 z-20" />
          
          <div className="h-full flex items-center overflow-hidden">
            {reelItems.length > 0 ? (
              <div 
                ref={reelRef}
                className="absolute top-0 left-0 h-full flex items-center gap-1"
                style={{
                  transform: `translateX(${reelPosition}px)`,
                  transition: spinState === "spinning" ? "transform 3.5s cubic-bezier(0.15, 0.85, 0.25, 1)" : "none",
                }}
              >
                {reelItems.map((prize, index) => (
                  <div 
                    key={index} 
                    className={`w-[100px] h-[80px] flex-shrink-0 rounded-lg border-2 flex items-center justify-center transition-all duration-300 ${getPrizeColorClasses(prize.color)} ${highlightedIndex === index ? "ring-4 ring-primary ring-offset-2 ring-offset-background scale-105" : ""}`}
                  >
                    <span className="text-sm font-bold text-center px-1">{prize.label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="w-full text-muted-foreground text-center">
                <Gift className="w-10 h-10 mx-auto mb-2 opacity-50" />
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
