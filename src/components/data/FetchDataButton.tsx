
"use client";

import { useMsal } from "@azure/msal-react";
import { tokenRequestAAS } from "@/lib/msalConfig";
import { Button } from "@/components/ui/button";
import { DatabaseZap, Loader2 } from "lucide-react";
import type { AASData } from "@/services/azure-analysis-services";
import { useToast } from "@/hooks/use-toast";

interface FetchDataButtonProps {
  onFetchStart: () => void;
  onFetchSuccess: (data: AASData[]) => void;
  onFetchError: (error: string) => void;
  isLoading: boolean;
}

export function FetchDataButton({ onFetchStart, onFetchSuccess, onFetchError, isLoading }: FetchDataButtonProps) {
  const { instance, accounts } = useMsal();
  const { toast } = useToast();

  const handleFetchData = async () => {
    onFetchStart();
    if (accounts.length === 0) {
      onFetchError("No active account. Please log in.");
      toast({
        title: "Authentication Error",
        description: "No active account. Please log in.",
        variant: "destructive",
      });
      return;
    }

    const account = accounts[0];
    const tokenRequest = { ...tokenRequestAAS, account };

    try {
      const response = await instance.acquireTokenSilent(tokenRequest);
      const accessToken = response.accessToken;

      const apiResponse = await fetch("/api/get-aas-data", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!apiResponse.ok) {
        const errorData = await apiResponse.json();
        throw new Error(errorData.message || `API request failed with status ${apiResponse.status}`);
      }

      const data: AASData[] = await apiResponse.json();
      onFetchSuccess(data);
      toast({
        title: "Data Fetched",
        description: "AdventureWorks data successfully retrieved.",
      });
    } catch (error: any) {
       console.error("Error fetching AAS data:", error);
      // Attempt to acquire token via popup if silent acquisition fails (e.g. consent required)
      if (error.name === "InteractionRequiredAuthError" || error.name === "BrowserAuthError") {
        try {
          const response = await instance.acquireTokenPopup(tokenRequest);
          const accessToken = response.accessToken;
          // Retry API call
          const apiResponse = await fetch("/api/get-aas-data", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
          });
          if (!apiResponse.ok) {
            const errorData = await apiResponse.json();
            throw new Error(errorData.message || `API request failed with status ${apiResponse.status}`);
          }
          const data: AASData[] = await apiResponse.json();
          onFetchSuccess(data);
          toast({
            title: "Data Fetched",
            description: "AdventureWorks data successfully retrieved.",
          });
        } catch (popupError: any) {
          console.error("Error fetching AAS data after popup:", popupError);
          onFetchError(popupError.message || "An unknown error occurred during data fetching.");
          toast({
            title: "Data Fetch Error",
            description: popupError.message || "Failed to fetch data after interactive login.",
            variant: "destructive",
          });
        }
      } else {
        onFetchError(error.message || "An unknown error occurred during data fetching.");
        toast({
          title: "Data Fetch Error",
          description: error.message || "An unknown error occurred.",
          variant: "destructive",
        });
      }
    }
  };

  return (
    <Button onClick={handleFetchData} disabled={isLoading} size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground">
      {isLoading ? (
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      ) : (
        <DatabaseZap className="mr-2 h-5 w-5" />
      )}
      Fetch AdventureWorks Data
    </Button>
  );
}
