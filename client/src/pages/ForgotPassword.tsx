import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, ArrowLeft, CheckCircle } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";

export default function ForgotPassword() {
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username || !email) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter both username and email",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await apiRequest("POST", "/api/auth/forgot-password", {
        username,
        email,
      });
      
      const data = await response.json();
      
      if (data.success) {
        setIsSubmitted(true);
        toast({
          title: "Check your email",
          description: data.message,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Error",
          description: data.message || "Failed to send reset email",
        });
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error?.message || "An error occurred. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-2xl">Check Your Email</CardTitle>
            <CardDescription>
              If an account with that username and email exists, we've sent a password reset link.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground mb-6">
              The link will expire in 1 hour. Check your spam folder if you don't see it.
            </p>
            <Link href="/login">
              <Button variant="outline" className="w-full" data-testid="button-back-to-login">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Login
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Forgot Password</CardTitle>
          <CardDescription>
            Enter your username and email to receive a password reset link
          </CardDescription>
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
                disabled={isSubmitting}
                data-testid="input-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
                data-testid="input-email"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting}
              data-testid="button-send-reset"
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Mail className="mr-2 h-4 w-4" />
              )}
              {isSubmitting ? "Sending..." : "Send Reset Link"}
            </Button>
          </form>
          
          <div className="mt-6 text-center">
            <Link href="/login" data-testid="link-back-login">
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                <ArrowLeft className="mr-1 h-3 w-3" />
                Back to Login
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
