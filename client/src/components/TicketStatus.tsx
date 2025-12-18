import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Ticket, Coins, CheckCircle2, Clock, Wallet, ArrowRightLeft, ShoppingCart, ArrowUpFromLine } from "lucide-react";

export interface SpinBalances {
  bronze: number;
  silver: number;
  gold: number;
}

export interface TicketData {
  stakeId: string;
  periodLabel?: string;
  wageredAmount: number;
  ticketsTotal: number;
  ticketsUsed: number;
  ticketsRemaining: number;
  walletBalance: number;
  spinBalances: SpinBalances;
  pendingWithdrawals: number;
}

interface TicketStatusProps {
  data: TicketData;
  onPurchase?: (tier: "bronze" | "silver" | "gold", quantity: number) => void;
  onConvert?: (fromTier: "bronze" | "silver", toTier: "silver" | "gold", quantity: number) => void;
  onWithdraw?: (amount: number) => void;
}

export default function TicketStatus({ data, onPurchase, onConvert, onWithdraw }: TicketStatusProps) {
  const hasTickets = data.ticketsRemaining > 0;
  const hasWallet = data.walletBalance > 0;
  const availableBalance = data.walletBalance - data.pendingWithdrawals;

  return (
    <div className="space-y-4 max-w-4xl mx-auto animate-fade-in-up">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
          <div className="flex items-center gap-3">
            <CardTitle className="text-xl font-semibold">Ticket Status</CardTitle>
            {data.periodLabel && (
              <Badge variant="secondary" className="text-xs">
                {data.periodLabel}
              </Badge>
            )}
          </div>
          <Badge 
            variant={hasTickets ? "default" : "secondary"}
            data-testid="badge-ticket-status"
          >
            {hasTickets ? "Eligible to Spin" : "No Tickets"}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatusCard
              icon={<Coins className="w-5 h-5" />}
              label="Total Wagered"
              value={`$${data.wageredAmount.toLocaleString()}`}
              testId="text-wagered-amount"
            />
            <StatusCard
              icon={<CheckCircle2 className="w-5 h-5" />}
              label="Used"
              value={`$${(data.ticketsUsed * 1000).toLocaleString()}`}
              subtext={`${data.ticketsUsed} spins`}
              testId="text-wagered-used"
            />
            <StatusCard
              icon={<Ticket className="w-5 h-5" />}
              label="Available"
              value={`$${(data.ticketsRemaining * 1000).toLocaleString()}`}
              subtext={`${data.ticketsRemaining} free spins`}
              highlight={hasTickets}
              testId="text-wagered-remaining"
            />
            <StatusCard
              icon={<Clock className="w-5 h-5" />}
              label="Spins Left"
              value={data.ticketsRemaining.toString()}
              highlight={hasTickets}
              testId="text-tickets-remaining"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-xl font-semibold flex items-center gap-2">
              <Wallet className="w-5 h-5" />
              Wallet & Spin Inventory
            </CardTitle>
            {hasWallet && (
              <Badge variant="default" className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30">
                ${data.walletBalance.toLocaleString()} Available
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-yellow-500/10 ring-1 ring-yellow-500/30">
              <div className="flex items-center gap-2 mb-2 text-yellow-500">
                <Wallet className="w-5 h-5" />
                <span className="text-sm">Wallet</span>
              </div>
              <p className="text-2xl font-bold font-mono text-yellow-500" data-testid="text-wallet-balance">
                ${data.walletBalance.toLocaleString()}
              </p>
              {data.pendingWithdrawals > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  ${data.pendingWithdrawals} pending
                </p>
              )}
            </div>
            
            <TierCard 
              tier="bronze" 
              balance={data.spinBalances.bronze}
              prizeValue={5}
              color="orange"
            />
            <TierCard 
              tier="silver" 
              balance={data.spinBalances.silver}
              prizeValue={25}
              color="slate"
            />
            <TierCard 
              tier="gold" 
              balance={data.spinBalances.gold}
              prizeValue={100}
              color="yellow"
            />
          </div>

          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Quick Actions</h4>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={availableBalance < 5}
                onClick={() => onPurchase?.("bronze", 1)}
                data-testid="button-buy-bronze"
              >
                <ShoppingCart className="w-4 h-4 mr-1" />
                Buy Bronze ($5)
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={availableBalance < 25}
                onClick={() => onPurchase?.("silver", 1)}
                data-testid="button-buy-silver"
              >
                <ShoppingCart className="w-4 h-4 mr-1" />
                Buy Silver ($25)
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={availableBalance < 100}
                onClick={() => onPurchase?.("gold", 1)}
                data-testid="button-buy-gold"
              >
                <ShoppingCart className="w-4 h-4 mr-1" />
                Buy Gold ($100)
              </Button>
              <div className="w-px bg-border mx-1" />
              <Button
                variant="outline"
                size="sm"
                disabled={data.spinBalances.bronze < 5}
                onClick={() => onConvert?.("bronze", "silver", 1)}
                data-testid="button-convert-bronze"
              >
                <ArrowRightLeft className="w-4 h-4 mr-1" />
                5 Bronze = 1 Silver
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={data.spinBalances.silver < 10}
                onClick={() => onConvert?.("silver", "gold", 1)}
                data-testid="button-convert-silver"
              >
                <ArrowRightLeft className="w-4 h-4 mr-1" />
                10 Silver = 1 Gold
              </Button>
              <div className="w-px bg-border mx-1" />
              <Button
                variant="outline"
                size="sm"
                disabled={availableBalance < 1}
                onClick={() => onWithdraw?.(availableBalance)}
                data-testid="button-withdraw"
              >
                <ArrowUpFromLine className="w-4 h-4 mr-1" />
                Withdraw to Stake
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface StatusCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext?: string;
  highlight?: boolean;
  testId?: string;
}

function StatusCard({ icon, label, value, subtext, highlight = false, testId }: StatusCardProps) {
  const bgClass = highlight ? "bg-primary/10 ring-1 ring-primary/20" : "bg-muted/50";
  const textClass = highlight ? "text-primary" : "text-muted-foreground";

  return (
    <div className={`p-4 rounded-xl ${bgClass}`}>
      <div className={`flex items-center gap-2 mb-2 ${textClass}`}>
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <p 
        className={`text-2xl font-bold font-mono ${highlight ? "text-primary" : ""}`}
        data-testid={testId}
      >
        {value}
      </p>
      {subtext && (
        <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
      )}
    </div>
  );
}

interface TierCardProps {
  tier: "bronze" | "silver" | "gold";
  balance: number;
  prizeValue: number;
  color: "orange" | "slate" | "yellow";
}

function TierCard({ tier, balance, prizeValue, color }: TierCardProps) {
  const colorClasses = {
    orange: "bg-orange-500/10 ring-orange-500/30 text-orange-500",
    slate: "bg-slate-400/10 ring-slate-400/30 text-slate-400",
    yellow: "bg-yellow-400/10 ring-yellow-400/30 text-yellow-400",
  };

  return (
    <div className={`p-4 rounded-xl ring-1 ${colorClasses[color]}`}>
      <div className="flex items-center gap-2 mb-2">
        <Ticket className="w-5 h-5" />
        <span className="text-sm capitalize">{tier}</span>
      </div>
      <p className="text-2xl font-bold font-mono" data-testid={`text-${tier}-spins`}>
        {balance}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        Win ${prizeValue}/spin
      </p>
    </div>
  );
}
