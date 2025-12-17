import TicketStatus from "../TicketStatus";

export default function TicketStatusExample() {
  return (
    <TicketStatus
      data={{
        stakeId: "jackboy",
        periodLabel: "Dec 2025",
        wageredAmount: 52340,
        ticketsTotal: 52,
        ticketsUsed: 3,
        ticketsRemaining: 49,
      }}
    />
  );
}
