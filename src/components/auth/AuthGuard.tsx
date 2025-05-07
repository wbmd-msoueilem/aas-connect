
"use client";

import type { ReactNode } from 'react';
import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { LoginButton } from "./LoginButton";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useState } from 'react';

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const isAuthenticated = useIsAuthenticated();
  const { inProgress } = useMsal();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient || inProgress === "startup" || inProgress === "handleRedirect") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-10 w-1/2 mx-auto" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }
  
  if (!isAuthenticated && inProgress === "none") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
        <div className="text-center space-y-6 bg-card p-8 rounded-lg shadow-xl">
            <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-primary fill-current mx-auto mb-4">
                <title>AAS Connect</title>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v2h-2zm0 4h2v6h-2z"/>
            </svg>
          <h1 className="text-3xl font-bold text-primary">Welcome to AAS Connect</h1>
          <p className="text-muted-foreground">Please log in to access Azure Analysis Services data.</p>
          <LoginButton />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
