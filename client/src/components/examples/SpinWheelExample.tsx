import { useState } from "react";
import SpinWheel, { SpinResult } from "../SpinWheel";

export default function SpinWheelExample() {
  const [tickets, setTickets] = useState(5);

  const handleSpin = async (): Promise<SpinResult> => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    const isWin = Math.random() < 0.1;
    const newTickets = tickets - 1;
    
    return {
      result: isWin ? "WIN" : "LOSE",
      prizeLabel: isWin ? "$5 Stake Tip" : undefined,
      prizeValue: isWin ? 5 : 0,
      ticketsTotal: 5,
      ticketsUsedAfter: 5 - newTickets,
      ticketsRemainingAfter: newTickets,
    };
  };

  const handleComplete = (result: SpinResult) => {
    setTickets(result.ticketsRemainingAfter);
    console.log("Spin complete:", result);
  };

  const handleError = (error: Error) => {
    console.error("Spin error:", error);
  };

  return (
    <SpinWheel
      ticketsRemaining={tickets}
      onSpin={handleSpin}
      onSpinComplete={handleComplete}
      onSpinError={handleError}
    />
  );
}
