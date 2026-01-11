import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, UserPlus, Gift } from "lucide-react";
import { Link } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Register() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();
  const { registerAsync, isRegistering, isAuthenticated } = useAuth();
  
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [stakePlatform, setStakePlatform] = useState<"us" | "com" | "">("");
  const [referralCode, setReferralCode] = useState("");
  
  // Read referral code from URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const refCode = params.get("ref") || params.get("referral");
    if (refCode) {
      setReferralCode(refCode.toUpperCase());
    }
  }, [searchString]);

  // Redirect if already logged in
  if (isAuthenticated) {
    setLocation("/");
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username || !password || !email || !stakePlatform) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please fill in all required fields",
      });
      return;
    }

    if (username.length < 3) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Username must be at least 3 characters",
      });
      return;
    }

    if (password.length < 8) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Password must be at least 8 characters",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Passwords do not match",
      });
      return;
    }

    try {
      await registerAsync({ username, password, email, stakePlatform, referralCode: referralCode || undefined });
      toast({
        title: "Account Created!",
        description: "Welcome! Please complete verification to start spinning.",
      });
      setLocation("/verify");
    } catch (error: any) {
      const message = error?.message || "Registration failed. Please try again.";
      toast({
        variant: "destructive",
        title: "Registration Failed",
        description: message,
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Create Account</CardTitle>
          <CardDescription>Use your Stake username to sign up</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="stakePlatform">Stake Platform *</Label>
              <Select
                value={stakePlatform}
                onValueChange={(value: "us" | "com") => setStakePlatform(value)}
                disabled={isRegistering}
              >
                <SelectTrigger data-testid="select-platform">
                  <SelectValue placeholder="Select your platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="us">Stake.us</SelectItem>
                  <SelectItem value="com">Stake.com</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">Stake Username *</Label>
              <Input
                id="username"
                type="text"
                placeholder="Your Stake username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isRegistering}
                data-testid="input-username"
              />
              <p className="text-xs text-muted-foreground">
                Must match your Stake account username exactly
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isRegistering}
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password *</Label>
              <Input
                id="password"
                type="password"
                placeholder="Create a password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isRegistering}
                data-testid="input-password"
              />
              <p className="text-xs text-muted-foreground">
                At least 8 characters
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password *</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isRegistering}
                data-testid="input-confirm-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="referralCode" className="flex items-center gap-1">
                <Gift className="w-3 h-3" />
                Referral Code (optional)
              </Label>
              <Input
                id="referralCode"
                type="text"
                placeholder="Enter referral code"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                disabled={isRegistering}
                data-testid="input-referral-code"
                className="uppercase"
              />
              <p className="text-xs text-muted-foreground">
                Have a friend's referral code? Enter it here for bonus rewards
              </p>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={isRegistering}
              data-testid="button-register"
            >
              {isRegistering ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="mr-2 h-4 w-4" />
              )}
              {isRegistering ? "Creating account..." : "Create Account"}
            </Button>
          </form>
          
          <div className="mt-6 text-center text-sm text-muted-foreground">
            <span>Already have an account? </span>
            <Link href="/login" className="text-primary hover:underline" data-testid="link-login">
              Login
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
