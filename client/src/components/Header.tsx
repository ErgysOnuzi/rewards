import { Wallet, Ticket, ExternalLink, User, LogOut, Shield, LogIn } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface HeaderProps {
  walletBalance?: number;
  ticketsRemaining?: number;
  stakeId?: string;
}

export default function Header({ walletBalance, ticketsRemaining, stakeId }: HeaderProps) {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const hasData = stakeId !== undefined;

  const getInitials = () => {
    if (user?.username) {
      return user.username.slice(0, 2).toUpperCase();
    }
    if (user?.email) {
      return user.email[0].toUpperCase();
    }
    return "U";
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <Link href="/">
          <Button variant="ghost" size="sm" data-testid="button-home">
            <Ticket className="w-4 h-4 mr-1.5" />
            Spin Rewards
          </Button>
        </Link>

        <div className="flex items-center gap-3">
          {hasData && (
            <>
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
            </>
          )}

          {isLoading ? (
            <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
          ) : isAuthenticated && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full" data-testid="button-user-menu">
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="text-xs">{getInitials()}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">@{user.username}</p>
                  {user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="cursor-pointer">
                    <User className="w-4 h-4 mr-2" />
                    My Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/verify" className="cursor-pointer">
                    <Shield className="w-4 h-4 mr-2" />
                    Verify Account
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout()} className="text-destructive" data-testid="button-logout">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" asChild data-testid="button-login">
              <Link href="/login">
                <LogIn className="w-4 h-4 mr-1.5" />
                Sign In
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
