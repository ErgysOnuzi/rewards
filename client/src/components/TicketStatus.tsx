import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Ticket, Coins, CheckCircle2, Clock, Trophy } from "lucide-react";

export interface TicketData {
  stakeId: string;
  periodLabel?: string;
  wageredAmount: number;
  ticketsTotal: number;
  ticketsUsed: number;
  ticketsRemaining: number;
  totalWinnings: number;
}

interface TicketStatusProps {
  data: TicketData;
}

export default function TicketStatus({ data }: TicketStatusProps) {
  const hasTickets = data.ticketsRemaining > 0;

  return (
    <Card className="max-w-2xl mx-auto animate-fade-in-up">
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
            subtext={`${data.ticketsRemaining} spins`}
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
          <StatusCard
            icon={<Trophy className="w-5 h-5" />}
            label="Winnings"
            value={`$${data.totalWinnings.toLocaleString()}`}
            highlight={data.totalWinnings > 0}
            isWinnings
            testId="text-total-winnings"
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface StatusCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext?: string;
  highlight?: boolean;
  isWinnings?: boolean;
  testId?: string;
}

function StatusCard({ icon, label, value, subtext, highlight = false, isWinnings = false, testId }: StatusCardProps) {
  const bgClass = isWinnings && highlight 
    ? "bg-yellow-500/10 ring-1 ring-yellow-500/30" 
    : highlight 
      ? "bg-primary/10 ring-1 ring-primary/20" 
      : "bg-muted/50";
  
  const textClass = isWinnings && highlight
    ? "text-yellow-500"
    : highlight
      ? "text-primary"
      : "text-muted-foreground";

  return (
    <div className={`p-4 rounded-xl ${bgClass}`}>
      <div className={`flex items-center gap-2 mb-2 ${textClass}`}>
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <p 
        className={`text-2xl font-bold font-mono ${isWinnings && highlight ? "text-yellow-500" : highlight ? "text-primary" : ""}`}
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
