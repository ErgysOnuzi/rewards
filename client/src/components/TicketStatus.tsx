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
              label="Cases Opened"
              value={data.ticketsUsed.toString()}
              subtext={`$${(data.ticketsUsed * 1000).toLocaleString()} wagered`}
              testId="text-wagered-used"
            />
            <StatusCard
              icon={<Ticket className="w-5 h-5" />}
              label="Cases Available"
              value={data.ticketsRemaining.toString()}
              subtext={`$${(data.ticketsRemaining * 1000).toLocaleString()} worth`}
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
          <div className="p-4 rounded-xl bg-yellow-500/10 ring-1 ring-yellow-500/30 max-w-xs">
            <div className="flex items-center gap-2 mb-2 text-yellow-500">
              <Wallet className="w-5 h-5" />
              <span className="text-sm">Balance</span>
            </div>
            <p className="text-2xl font-bold font-mono text-yellow-500" data-testid="text-wallet-balance">
              ${data.walletBalance.toLocaleString()}
            </p>
            {data.pendingWithdrawals > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                ${data.pendingWithdrawals} pending withdrawal
              </p>
            )}
          </div>

          <div className="flex gap-2">
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
