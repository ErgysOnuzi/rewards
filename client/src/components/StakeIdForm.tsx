import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search, Loader2 } from "lucide-react";

interface StakeIdFormProps {
  onSubmit: (stakeId: string) => void;
  isLoading?: boolean;
  error?: string | null;
}

export default function StakeIdForm({ onSubmit, isLoading = false, error }: StakeIdFormProps) {
  const [stakeId, setStakeId] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (stakeId.trim()) {
      onSubmit(stakeId.trim());
    }
  };

  const isValidInput = stakeId.trim().length >= 2 && stakeId.trim().length <= 32;

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg text-center">Enter Your Stake ID</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Your Stake username"
                value={stakeId}
                onChange={(e) => setStakeId(e.target.value)}
                className="pl-10"
                disabled={isLoading}
                data-testid="input-stake-id"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive animate-fade-in-up" data-testid="text-error-message">
                {error}
              </p>
            )}
          </div>
          <Button 
            type="submit" 
            className="w-full"
            disabled={!isValidInput || isLoading}
            data-testid="button-check-tickets"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Checking...
              </>
            ) : (
              "Check Tickets"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
