import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Ticket, Coins, CheckCircle2, Clock, Wallet, ArrowUpFromLine } from "lucide-react";

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

export default function TicketStatus({ data, onWithdraw }: TicketStatusProps) {
  const hasTickets = data.ticketsRemaining > 0;
  const hasWallet = data.walletBalance > 0;
  const availableBalance = data.walletBalance - data.pendingWithdrawals;

  // Calculate progress toward next ticket (wagered amount mod 1000)
  const progressToNext = data.wageredAmount % 1000;
  const progressPercent = (progressToNext / 1000) * 100;

  return (
    <div className="space-y-4 max-w-4xl mx-auto animate-fade-in-up">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
          <div className="flex items-center gap-3">
            <CardTitle className="text-xl font-semibold">Lifetime Stats</CardTitle>
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
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatusCard
              icon={<Coins className="w-5 h-5" />}
              label="Total Wagered"
              value={`$${data.wageredAmount.toLocaleString()}`}
              testId="text-wagered-amount"
            />
            <StatusCard
              icon={<CheckCircle2 className="w-5 h-5" />}
              label="Cases Opened"
              value={data.ticketsUsed.toString()}
              testId="text-wagered-used"
            />
            <StatusCard
              icon={<Ticket className="w-5 h-5" />}
              label="Cases Available"
              value={data.ticketsRemaining.toString()}
              highlight={hasTickets}
              showTicketIcon
              testId="text-wagered-remaining"
            />
          </div>

          <div className="p-4 rounded-xl bg-muted/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Progress to Next Ticket</span>
              <span className="text-sm font-mono text-foreground">
                ${progressToNext.toLocaleString()} / $1,000
              </span>
            </div>
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              {progressPercent.toFixed(0)}% toward next ticket
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-xl font-semibold flex items-center gap-2">
              <Wallet className="w-5 h-5" />
              Wallet
            </CardTitle>
            {hasWallet && (
              <Badge variant="default" className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30">
                ${data.walletBalance.toLocaleString()} Available
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col items-center justify-center">
            <div className="p-6 rounded-xl bg-yellow-500/10 ring-1 ring-yellow-500/30 text-center">
              <div className="flex items-center justify-center gap-2 mb-2 text-yellow-500">
                <Coins className="w-6 h-6" />
                <span className="text-sm font-medium">Balance</span>
              </div>
              <p className="text-3xl font-bold font-mono text-yellow-500" data-testid="text-wallet-balance">
                ${data.walletBalance.toLocaleString()}
              </p>
              {data.pendingWithdrawals > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  ${data.pendingWithdrawals} pending withdrawal
                </p>
              )}
            </div>

            <div className="flex gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={availableBalance < 1}
                onClick={() => onWithdraw?.(availableBalance)}
                data-testid="button-withdraw"
              >
                <ArrowUpFromLine className="w-4 h-4 mr-1" />
                Withdraw ${availableBalance > 0 ? availableBalance : 0} to Stake
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
  showTicketIcon?: boolean;
  testId?: string;
}

function StatusCard({ icon, label, value, subtext, highlight = false, showTicketIcon = false, testId }: StatusCardProps) {
  const bgClass = highlight ? "bg-primary/10 ring-1 ring-primary/20" : "bg-muted/50";
  const textClass = highlight ? "text-primary" : "text-muted-foreground";

  return (
    <div className={`p-4 rounded-xl ${bgClass} min-h-[100px] flex flex-col justify-between`}>
      <div className={`flex items-center gap-2 mb-2 ${textClass}`}>
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <p 
          className={`text-2xl font-bold font-mono ${highlight ? "text-primary" : ""}`}
          data-testid={testId}
        >
          {value}
        </p>
        {showTicketIcon && (
          <Ticket className={`w-5 h-5 ${highlight ? "text-primary" : "text-muted-foreground"}`} />
        )}
      </div>
      {subtext && (
        <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
      )}
    </div>
  );
}
