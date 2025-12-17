import { AlertCircle } from "lucide-react";

export default function Footer() {
  return (
    <footer className="py-8 px-6 border-t border-border/50">
      <div className="max-w-4xl mx-auto text-center space-y-3">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm font-medium">Important Notice</span>
        </div>
        <div className="space-y-1 text-xs text-muted-foreground/70">
          <p data-testid="text-disclaimer-1">
            This site reads wager data from internal spreadsheets and may update twice daily.
          </p>
          <p data-testid="text-disclaimer-2">
            Prizes are paid to the Stake ID entered. Ensure your Stake ID is correct.
          </p>
        </div>
        <p className="text-xs text-muted-foreground/50 pt-2">
          LukeRewards Spins
        </p>
      </div>
    </footer>
  );
}
