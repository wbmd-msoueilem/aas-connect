
"use client";

import { useMsal } from "@azure/msal-react";
import { loginRequest } from "@/lib/msalConfig";
import { Button } from "@/components/ui/button";
import { LogIn } from "lucide-react";
import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { useToast } from "@/hooks/use-toast";

export function LoginButton() {
  const { instance } = useMsal();
  const { toast } = useToast();

  const handleLogin = async () => {
    try {
      await instance.loginPopup(loginRequest);
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        await instance.acquireTokenRedirect(loginRequest);
      } else {
        console.error("Login failed:", error);
        toast({
          title: "Login Failed",
          description: "An error occurred during login. Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  return (
    <Button onClick={handleLogin} size="lg">
      <LogIn className="mr-2 h-5 w-5" />
      Login with Microsoft
    </Button>
  );
}
