
"use client";

import type { AASData } from "@/services/azure-analysis-services"; // Assuming this type exists for data structure
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ServerCrash, TableIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DataDisplayProps {
  data: AASData[] | null;
  isLoading: boolean;
  error: string | null;
}

export function DataDisplay({ data, isLoading, error }: DataDisplayProps) {
  if (isLoading) {
    return (
      <Card className="mt-6 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center">
            <TableIcon className="mr-2 h-6 w-6 text-primary" />
            AdventureWorks Data
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/4" />
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex space-x-2">
                  <Skeleton className="h-10 flex-1" />
                  <Skeleton className="h-10 flex-1" />
                  <Skeleton className="h-10 flex-1" />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="mt-6">
        <ServerCrash className="h-4 w-4" />
        <AlertTitle>Error Fetching Data</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!data || data.length === 0) {
    return (
       <Card className="mt-6 shadow-lg">
        <CardHeader>
           <CardTitle className="flex items-center">
            <TableIcon className="mr-2 h-6 w-6 text-primary" />
            AdventureWorks Data
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No data to display. Click "Fetch AdventureWorks Data" to load.</p>
        </CardContent>
      </Card>
    );
  }

  const headers = Object.keys(data[0]);

  return (
    <Card className="mt-6 shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center">
          <TableIcon className="mr-2 h-6 w-6 text-primary" />
          AdventureWorks Data
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {headers.map((header) => (
                  <TableHead key={header} className="font-semibold">{header}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {headers.map((header) => (
                    <TableCell key={`${rowIndex}-${header}`}>{String(row[header])}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
