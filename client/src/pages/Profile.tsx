import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, Redirect } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { User, Shield, Clock, CheckCircle, XCircle, AlertCircle, LogOut, Home, Copy, Share2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";

interface ReferralDetail {
  id: number;
  username: string;
  status: string;
  bonusAwarded: number;
  createdAt: string | null;
  qualifiedAt: string | null;
}

interface ReferralStats {
  referralCode: string;
  referredBy: { username: string; joinedAt: string | null } | null;
  totalReferrals: number;
  qualifiedReferrals: number;
  pendingReferrals: number;
  totalBonusEarned: number;
  referrals: ReferralDetail[];
}

export default function Profile() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [baseUrl, setBaseUrl] = useState("");

  useEffect(() => {
    setBaseUrl(window.location.origin);
  }, []);

  const { data: referralStats } = useQuery<ReferralStats>({
    queryKey: ["/api/referrals"],
    queryFn: async () => {
      const res = await fetch("/api/referrals", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch referral stats");
      return res.json();
    },
    enabled: isAuthenticated,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Redirect to="/login" />;
  }

  const getStatusBadge = (status: string | null | undefined) => {
    switch (status) {
      case "verified":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" /> Verified</Badge>;
      case "pending":
        return <Badge variant="secondary"><AlertCircle className="w-3 h-3 mr-1" /> Pending Review</Badge>;
      case "rejected":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Rejected</Badge>;
      default:
        return <Badge variant="outline"><AlertCircle className="w-3 h-3 mr-1" /> Unverified</Badge>;
    }
  };

  const formatDate = (date: string | Date | null | undefined) => {
    if (!date) return "N/A";
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const copyReferralLink = () => {
    const link = `${baseUrl}/register?ref=${user.username}`;
    navigator.clipboard.writeText(link);
    toast({ title: "Copied!", description: "Referral link copied to clipboard" });
  };

  const handleLogout = () => {
    logout();
    setLocation("/");
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto py-8 px-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <User className="w-6 h-6" />
            My Profile
          </h1>
          <Button variant="outline" onClick={() => setLocation("/")} data-testid="button-back-home">
            <Home className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </div>

        <div className="space-y-6">
          {/* Account Info Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="w-5 h-5" />
                Account Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Username</p>
                  <p className="font-medium" data-testid="text-username">@{user.username}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium" data-testid="text-email">{user.email || "Not set"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Member Since</p>
                  <p className="font-medium flex items-center gap-1" data-testid="text-created-at">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    {formatDate(user.createdAt)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stake Account Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Stake Account
              </CardTitle>
              <CardDescription>Your linked Stake.com account details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Stake Username</p>
                  <p className="font-medium" data-testid="text-stake-username">{user.stakeUsername || "Not set"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Platform</p>
                  <p className="font-medium" data-testid="text-stake-platform">
                    {user.stakePlatform === "us" ? "Stake.us" : user.stakePlatform === "com" ? "Stake.com" : "Not set"}
                  </p>
                </div>
              </div>
              
              <Separator />
              
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Verification Status</p>
                  <div className="mt-1" data-testid="text-verification-status">
                    {getStatusBadge(user.verificationStatus)}
                  </div>
                </div>
                {user.verifiedAt && (
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Verified On</p>
                    <p className="text-sm font-medium">{formatDate(user.verifiedAt)}</p>
                  </div>
                )}
              </div>

              {user.verificationStatus === "unverified" && (
                <Button 
                  className="w-full" 
                  onClick={() => setLocation("/verify")}
                  data-testid="button-verify-account"
                >
                  <Shield className="w-4 h-4 mr-2" />
                  Verify Your Account
                </Button>
              )}
              
              {user.verificationStatus === "pending" && (
                <p className="text-sm text-muted-foreground text-center">
                  Your verification is being reviewed. This usually takes 24-48 hours.
                </p>
              )}

              {user.verificationStatus === "rejected" && (
                <div className="space-y-2">
                  <p className="text-sm text-destructive text-center">
                    Your verification was rejected. Please try again with a clearer screenshot.
                  </p>
                  <Button 
                    className="w-full" 
                    variant="outline"
                    onClick={() => setLocation("/verify")}
                    data-testid="button-retry-verify"
                  >
                    Try Again
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Referred By Card */}
          {referralStats?.referredBy && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <User className="w-5 h-5" />
                  Referred By
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <User className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium" data-testid="text-referrer-username">@{referralStats.referredBy.username}</p>
                    <p className="text-sm text-muted-foreground">Your referrer</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Referral Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Share2 className="w-5 h-5" />
                Referral Program
              </CardTitle>
              <CardDescription>Invite friends and earn $2 for each qualified referral</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-sm text-muted-foreground mb-2">Your Referral Link</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm bg-background rounded px-3 py-2 overflow-hidden text-ellipsis" data-testid="text-referral-link">
                    {baseUrl}/register?ref={user.username}
                  </code>
                  <Button size="icon" variant="outline" onClick={copyReferralLink} data-testid="button-copy-referral">
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              
              {referralStats && (
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-2xl font-bold" data-testid="text-total-referred">{referralStats.totalReferrals}</p>
                    <p className="text-xs text-muted-foreground">Total Referred</p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-2xl font-bold text-green-500" data-testid="text-qualified-referred">{referralStats.qualifiedReferrals}</p>
                    <p className="text-xs text-muted-foreground">Qualified</p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-2xl font-bold text-primary" data-testid="text-bonus-earned">${(referralStats.totalBonusEarned / 100).toFixed(0)}</p>
                    <p className="text-xs text-muted-foreground">Bonus Earned</p>
                  </div>
                </div>
              )}
              
              <p className="text-xs text-muted-foreground text-center">
                Referred users must wager $1,000+ in their first week to qualify
              </p>
            </CardContent>
          </Card>

          {/* Your Referrals List */}
          {referralStats && referralStats.referrals.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Share2 className="w-5 h-5" />
                  Your Referrals ({referralStats.totalReferrals})
                </CardTitle>
                <CardDescription>Users who signed up with your referral link</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {referralStats.referrals.map((ref) => (
                    <div 
                      key={ref.id} 
                      className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                      data-testid={`referral-item-${ref.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                          <User className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="font-medium">@{ref.username}</p>
                          <p className="text-xs text-muted-foreground">
                            Joined {ref.createdAt ? new Date(ref.createdAt).toLocaleDateString() : "N/A"}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        {ref.status === "qualified" ? (
                          <>
                            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                              <CheckCircle className="w-3 h-3 mr-1" /> Qualified
                            </Badge>
                            <p className="text-sm text-green-500 mt-1">+${(ref.bonusAwarded / 100).toFixed(0)}</p>
                          </>
                        ) : (
                          <Badge variant="secondary">
                            <Clock className="w-3 h-3 mr-1" /> Pending
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Actions Card */}
          <Card>
            <CardContent className="pt-6">
              <Button 
                variant="destructive" 
                className="w-full"
                onClick={handleLogout}
                data-testid="button-logout"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
