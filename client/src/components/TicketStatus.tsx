import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Ticket, Coins, CheckCircle2, Clock } from "lucide-react";

export interface TicketData {
  stakeId: string;
  periodLabel?: string;
  wageredAmount: number;
  ticketsTotal: number;
  ticketsUsed: number;
  ticketsRemaining: number;
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatusCard
            icon={<Coins className="w-5 h-5" />}
            label="Wagered"
            value={`$${data.wageredAmount.toLocaleString()}`}
            testId="text-wagered-amount"
          />
          <StatusCard
            icon={<Ticket className="w-5 h-5" />}
            label="Total Tickets"
            value={data.ticketsTotal.toString()}
            testId="text-tickets-total"
          />
          <StatusCard
            icon={<CheckCircle2 className="w-5 h-5" />}
            label="Used"
            value={data.ticketsUsed.toString()}
            testId="text-tickets-used"
          />
          <StatusCard
            icon={<Clock className="w-5 h-5" />}
            label="Remaining"
            value={data.ticketsRemaining.toString()}
            highlight={hasTickets}
            testId="text-tickets-remaining"
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
  highlight?: boolean;
  testId?: string;
}

function StatusCard({ icon, label, value, highlight = false, testId }: StatusCardProps) {
  return (
    <div className={`p-4 rounded-xl ${highlight ? "bg-primary/10 ring-1 ring-primary/20" : "bg-muted/50"}`}>
      <div className={`flex items-center gap-2 mb-2 ${highlight ? "text-primary" : "text-muted-foreground"}`}>
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <p 
        className={`text-2xl font-bold font-mono ${highlight ? "text-primary" : ""}`}
        data-testid={testId}
      >
        {value}
      </p>
    </div>
  );
}
