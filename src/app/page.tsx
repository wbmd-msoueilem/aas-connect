
"use client";

import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { FetchDataButton } from "@/components/data/FetchDataButton";
import { DataDisplay } from "@/components/data/DataDisplay";
import type { AASData } from "@/services/azure-analysis-services";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Lightbulb } from "lucide-react";


export default function HomePage() {
  const [aasData, setAasData] = useState<AASData[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFetchStart = () => {
    setIsLoading(true);
    setError(null);
    setAasData(null); // Clear previous data
  };

  const handleFetchSuccess = (data: AASData[]) => {
    setAasData(data);
    setIsLoading(false);
  };

  const handleFetchError = (errorMessage: string) => {
    setError(errorMessage);
    setIsLoading(false);
  };

  return (
    <AuthGuard>
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-grow container mx-auto p-4 md:p-8">
          <Card className="mb-8 shadow-lg">
            <CardHeader>
              <CardTitle className="text-2xl text-primary">Azure Analysis Services Dashboard</CardTitle>
              <CardDescription>
                Connect to your AAS instance and visualize your data.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center space-y-6">
              <p className="text-center text-muted-foreground max-w-2xl">
                Use the button below to fetch data from your AdventureWorks model in Azure Analysis Services.
                Ensure your MSAL configuration and environment variables are set up correctly.
              </p>
              <FetchDataButton
                onFetchStart={handleFetchStart}
                onFetchSuccess={handleFetchSuccess}
                onFetchError={handleFetchError}
                isLoading={isLoading}
              />
            </CardContent>
          </Card>
          
          <DataDisplay data={aasData} isLoading={isLoading} error={error} />

          {!isLoading && !error && !aasData && (
             <Card className="mt-6 bg-secondary/50 border-accent">
              <CardHeader className="flex flex-row items-center gap-2">
                <Lightbulb className="h-6 w-6 text-accent" />
                <CardTitle className="text-accent">Getting Started</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                  <li>Make sure your <code>.env.local</code> file is configured with your Azure AD and AAS details.</li>
                  <li>Verify that the AAD application has the necessary permissions for Microsoft Graph (User.Read) and Azure Analysis Services.</li>
                  <li>The API route expects an "AdventureWorks" model. Adjust the DAX query in <code>src/app/api/get-aas-data/route.ts</code> if your model or table names differ.</li>
                </ul>
              </CardContent>
            </Card>
          )}
        </main>
        <footer className="text-center p-4 text-muted-foreground text-sm border-t">
          © {new Date().getFullYear()} AAS Connect. All rights reserved.
        </footer>
      </div>
    </AuthGuard>
  );
}
