import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, LogIn } from "lucide-react";
import { Link } from "wouter";

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { loginAsync, isLoggingIn, isAuthenticated } = useAuth();
  
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Redirect if already logged in
  if (isAuthenticated) {
    setLocation("/");
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username || !password) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter username and password",
      });
      return;
    }

    try {
      await loginAsync({ username, password });
      toast({
        title: "Welcome back!",
        description: "You have been logged in successfully.",
      });
      setLocation("/");
    } catch (error: any) {
      const message = error?.message || "Login failed. Please try again.";
      toast({
        variant: "destructive",
        title: "Login Failed",
        description: message,
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>Enter your credentials to access your account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoggingIn}
                data-testid="input-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoggingIn}
                data-testid="input-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={isLoggingIn}
              data-testid="button-login"
            >
              {isLoggingIn ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="mr-2 h-4 w-4" />
              )}
              {isLoggingIn ? "Logging in..." : "Login"}
            </Button>
          </form>
          
          <div className="mt-4 text-center">
            <Link href="/forgot-password" data-testid="link-forgot-password">
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                Forgot your password?
              </Button>
            </Link>
          </div>
          
          <div className="mt-4 text-center text-sm text-muted-foreground">
            <span>Don't have an account? </span>
            <Link href="/register" data-testid="link-register">
              <Button variant="ghost" size="sm" className="p-0 h-auto">
                Create one
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
