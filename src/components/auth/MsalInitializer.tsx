
"use client";

import type { ReactNode } from 'react';
import { MsalProvider } from "@azure/msal-react";
import { msalInstance } from "@/services/msalService";

interface MsalInitializerProps {
  children: ReactNode;
}

export function MsalInitializer({ children }: MsalInitializerProps): JSX.Element {
  return (
    <MsalProvider instance={msalInstance}>
      {children}
    </MsalProvider>
  );
}
