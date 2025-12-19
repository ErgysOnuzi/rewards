import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, Star, Crown, Sparkles } from "lucide-react";
import { TIER_CONFIG, type SpinTier } from "@shared/schema";

interface PrizeTiersProps {
  selectedTier?: SpinTier;
}

const tierIcons = {
  bronze: Trophy,
  silver: Star,
  gold: Crown,
};

const tierColors = {
  bronze: "text-orange-500",
  silver: "text-slate-400",
  gold: "text-yellow-500",
};

export default function PrizeTiers({ selectedTier = "bronze" }: PrizeTiersProps) {
  const tierConfig = TIER_CONFIG[selectedTier];
  const prizes = tierConfig.prizes;

  const formatPercentage = (prob: number) => {
    if (prob >= 0.01) return `${(prob * 100).toFixed(0)}%`;
    if (prob >= 0.001) return `${(prob * 100).toFixed(1)}%`;
    return `${(prob * 100).toFixed(2)}%`;
  };

  const totalWinRate = prizes.reduce((sum, p) => sum + p.probability, 0);
  const TierIcon = tierIcons[selectedTier];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="w-5 h-5 text-primary" />
          Prize Tiers
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 mb-3">
          <TierIcon className={`w-5 h-5 ${tierColors[selectedTier]}`} />
          <span className="font-medium capitalize">{selectedTier} Spin</span>
          <Badge variant="outline" className="ml-auto">
            {formatPercentage(totalWinRate)} total win rate
          </Badge>
        </div>

        <div className="space-y-2">
          {prizes.map((prize, index) => (
            <div 
              key={index}
              className="flex items-center justify-between p-3 rounded-md bg-muted/50"
              data-testid={`prize-tier-${index}`}
            >
              <div className="flex items-center gap-2">
                <Trophy className={`w-4 h-4 ${index === 0 ? tierColors[selectedTier] : index === 1 ? "text-primary" : "text-yellow-400"}`} />
                <span className="font-medium">{prize.label}</span>
              </div>
              <Badge variant={index === prizes.length - 1 ? "default" : "secondary"}>
                {formatPercentage(prize.probability)} chance
              </Badge>
            </div>
          ))}
        </div>

        <div className="pt-3 border-t border-border/50">
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            {(["bronze", "silver", "gold"] as SpinTier[]).map((tier) => {
              const Icon = tierIcons[tier];
              const config = TIER_CONFIG[tier];
              const maxPrize = config.prizes[config.prizes.length - 1].value;
              return (
                <div 
                  key={tier}
                  className={`p-2 rounded-md ${tier === selectedTier ? "bg-primary/10 ring-1 ring-primary" : "bg-muted/30"}`}
                >
                  <Icon className={`w-4 h-4 mx-auto mb-1 ${tierColors[tier]}`} />
                  <div className="capitalize font-medium">{tier}</div>
                  <div className="text-muted-foreground text-xs">Up to ${maxPrize}</div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
