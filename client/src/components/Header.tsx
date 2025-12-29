import { Wallet, Ticket, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  walletBalance?: number;
  ticketsRemaining?: number;
  stakeId?: string;
}

export default function Header({ walletBalance, ticketsRemaining, stakeId }: HeaderProps) {
  const hasData = stakeId !== undefined;

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <Button
          variant="ghost"
          size="sm"
          asChild
          data-testid="button-main-site"
        >
          <a href="http://lukerewards.com" target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-4 h-4 mr-1.5" />
            Main Site
          </a>
        </Button>

        <div className="flex items-center gap-4">
          {!hasData && (
            <div className="flex items-center gap-2">
              <Ticket className="w-5 h-5 text-primary" />
              <span className="font-semibold text-lg">LukeRewards</span>
            </div>
          )}

        {hasData && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10">
              <Ticket className="w-4 h-4 text-primary" />
              <span className="text-sm font-mono font-medium text-primary" data-testid="header-tickets">
                {ticketsRemaining ?? 0}
              </span>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-500/10">
              <Wallet className="w-4 h-4 text-yellow-500" />
              <span className="text-sm font-mono font-medium text-yellow-500" data-testid="header-balance">
                ${(walletBalance ?? 0).toLocaleString()}
              </span>
            </div>

            {stakeId && (
              <Badge variant="outline" className="hidden sm:flex" data-testid="header-stake-id">
                {stakeId}
              </Badge>
            )}
          </div>
        )}
        </div>

        <div className="w-[88px]" />
      </div>
    </header>
  );
}
