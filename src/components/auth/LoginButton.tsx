
"use client";

import { useMsal } from "@azure/msal-react";
import { loginRequest } from "@/lib/msalConfig";
import { Button } from "@/components/ui/button";
import { LogIn } from "lucide-react";
// InteractionRequiredAuthError may not be directly caught from loginRedirect initiation
// but it's good to have for other MSAL calls.
// For this specific component, BrowserAuthError might be more relevant if initiation fails.
import { BrowserAuthError } from "@azure/msal-browser"; 
import { useToast } from "@/hooks/use-toast";

export function LoginButton() {
  const { instance } = useMsal();
  const { toast } = useToast();

  const handleLogin = () => {
    instance.loginRedirect(loginRequest).catch(error => {
      // This catch handles errors if loginRedirect itself fails to initiate.
      // For example, if MSAL is not configured properly or a browser issue prevents redirection.
      console.error("Login redirect failed to initiate:", error);
      
      let description = "An error occurred during login. Please try again.";
      if (error instanceof BrowserAuthError) {
        description = `Login failed: ${error.errorMessage} (Code: ${error.errorCode})`;
      } else if (error instanceof Error) {
        description = error.message;
      }

      toast({
        title: "Login Failed",
        description: description,
        variant: "destructive",
      });
    });
  };

  return (
    <Button onClick={handleLogin} size="lg">
      <LogIn className="mr-2 h-5 w-5" />
      Login with Microsoft
    </Button>
  );
}

