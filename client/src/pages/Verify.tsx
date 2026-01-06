import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Clock, Shield, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

interface VerificationStatus {
  stake_username: string | null;
  stake_platform: string | null;
  verification_status: string;
  verified_at: string | null;
  security_disclaimer_accepted: boolean;
  has_pending_request: boolean;
}

export default function Verify() {
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  
  const [stakeUsername, setStakeUsername] = useState("");
  const [stakePlatform, setStakePlatform] = useState<string>("");
  const [betId, setBetId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      window.location.href = "/api/login";
    }
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchVerificationStatus();
    }
  }, [isAuthenticated]);

  const fetchVerificationStatus = async () => {
    try {
      const response = await fetch("/api/verification/status", {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setVerificationStatus(data);
        if (!data.security_disclaimer_accepted && data.verification_status === "unverified") {
          setShowDisclaimer(true);
        }
      }
    } catch (err) {
      console.error("Failed to fetch verification status:", err);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  const handleAcceptDisclaimer = async () => {
    try {
      const response = await fetch("/api/verification/accept-disclaimer", {
        method: "POST",
        credentials: "include",
      });
      if (response.ok) {
        setShowDisclaimer(false);
        setVerificationStatus(prev => prev ? { ...prev, security_disclaimer_accepted: true } : null);
      }
    } catch (err) {
      console.error("Failed to accept disclaimer:", err);
    }
  };

  const handleSubmitVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!stakeUsername.trim() || !stakePlatform || !betId.trim()) {
      toast({
        title: "Missing Information",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/verification/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          stake_username: stakeUsername,
          stake_platform: stakePlatform,
          bet_id: betId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to submit verification");
      }

      toast({
        title: "Verification Submitted",
        description: "Your request has been submitted for admin review.",
      });

      fetchVerificationStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Submission failed";
      toast({
        title: "Submission Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (authLoading || isLoadingStatus) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const getStatusBadge = () => {
    switch (verificationStatus?.verification_status) {
      case "verified":
        return <Badge variant="default" className="bg-green-600"><CheckCircle2 className="w-3 h-3 mr-1" />Verified</Badge>;
      case "pending":
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Pending Review</Badge>;
      case "rejected":
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="outline">Not Verified</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      
      <main className="flex-1 py-12">
        <div className="max-w-2xl mx-auto px-4 space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold" data-testid="text-verify-title">Account Verification</h1>
            <p className="text-muted-foreground">
              Link your Stake account to access spins and rewards
            </p>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Verification Status
                </CardTitle>
                {getStatusBadge()}
              </div>
              {verificationStatus?.verification_status === "verified" && (
                <CardDescription>
                  Linked to: {verificationStatus.stake_username} ({verificationStatus.stake_platform?.toUpperCase()})
                </CardDescription>
              )}
            </CardHeader>
          </Card>

          {verificationStatus?.verification_status === "verified" ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center space-y-4">
                  <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" />
                  <div>
                    <h3 className="text-xl font-semibold">You're All Set!</h3>
                    <p className="text-muted-foreground">
                      Your account is verified and linked to <strong>{verificationStatus.stake_username}</strong>
                    </p>
                  </div>
                  <Button onClick={() => setLocation("/")} data-testid="button-go-to-spins">
                    Go to Spins
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : verificationStatus?.has_pending_request ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center space-y-4">
                  <Clock className="w-16 h-16 text-yellow-500 mx-auto" />
                  <div>
                    <h3 className="text-xl font-semibold">Verification Pending</h3>
                    <p className="text-muted-foreground">
                      Your verification request is being reviewed by an admin. This usually takes a few hours.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Link Your Stake Account</CardTitle>
                <CardDescription>
                  To verify your account, place a small bet on Stake and submit the bet ID below.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="bg-muted/50 p-4 rounded-lg space-y-3">
                    <h4 className="font-medium flex items-center gap-2">
                      <ExternalLink className="w-4 h-4" />
                      Verification Steps
                    </h4>
                    <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                      <li>Log into your Stake account</li>
                      <li>Place any small bet (e.g., $0.01 on Dice)</li>
                      <li>Copy the Bet ID from your bet history</li>
                      <li>Submit the form below with your details</li>
                    </ol>
                  </div>

                  <form onSubmit={handleSubmitVerification} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="stake-username">Stake Username</Label>
                      <Input
                        id="stake-username"
                        placeholder="Your Stake username"
                        value={stakeUsername}
                        onChange={(e) => setStakeUsername(e.target.value)}
                        data-testid="input-stake-username"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="stake-platform">Platform</Label>
                      <Select value={stakePlatform} onValueChange={setStakePlatform}>
                        <SelectTrigger data-testid="select-stake-platform">
                          <SelectValue placeholder="Select platform" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="us">Stake.us (Social Casino)</SelectItem>
                          <SelectItem value="com">Stake.com (Crypto Casino)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="bet-id">Bet ID</Label>
                      <Input
                        id="bet-id"
                        placeholder="e.g., abc123def456"
                        value={betId}
                        onChange={(e) => setBetId(e.target.value)}
                        data-testid="input-bet-id"
                      />
                      <p className="text-xs text-muted-foreground">
                        Find this in your Stake bet history after placing any bet
                      </p>
                    </div>

                    <Button 
                      type="submit" 
                      className="w-full" 
                      disabled={isSubmitting}
                      data-testid="button-submit-verification"
                    >
                      {isSubmitting ? "Submitting..." : "Submit for Verification"}
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      <Footer />

      <Dialog open={showDisclaimer} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Security Notice
            </DialogTitle>
            <DialogDescription className="text-left space-y-4 pt-4">
              <p className="font-medium text-foreground">
                IMPORTANT: Do NOT use the same password as your Stake login.
              </p>
              <p>
                Using the same credentials across sites could compromise your security. 
                We recommend using a unique, strong password and consider using a password manager.
              </p>
              <p>
                Your data on LukeRewards is private and only visible to you. We do not share 
                your information with third parties except as required for verification.
              </p>
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2 pt-4">
            <Checkbox 
              id="disclaimer-accept" 
              checked={disclaimerAccepted}
              onCheckedChange={(checked) => setDisclaimerAccepted(!!checked)}
              data-testid="checkbox-disclaimer"
            />
            <label
              htmlFor="disclaimer-accept"
              className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              I understand and will use a unique password
            </label>
          </div>
          <DialogFooter>
            <Button 
              onClick={handleAcceptDisclaimer} 
              disabled={!disclaimerAccepted}
              data-testid="button-accept-disclaimer"
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
