
import { NextResponse, type NextRequest } from 'next/server';
import { Connection, Request as TediousRequest, type ColumnValue, type ConnectionConfig } from 'tedious';
import type { AASData } from '@/services/azure-analysis-services';

// Ensure environment variables are loaded
const aasConnectionStringEnv = process.env.NEXT_PUBLIC_AAS_SERVER_URL; 
const aasDatabaseNameEnv = process.env.NEXT_PUBLIC_AAS_DATABASE; 

// Basic DAX query - adjust to your AdventureWorks model
const DAX_QUERY = `
EVALUATE
  SUMMARIZECOLUMNS(
    'Product'[Product Category Name],
    'Date'[Calendar Year],
    "Total Sales", SUM('Sales'[Sales Amount]) 
  )
ORDER BY
  'Product'[Product Category Name], 'Date'[Calendar Year]
`;

// Helper to convert Tedious row to a simpler object
function parseRow(row: ColumnValue[]): AASData {
  const result: AASData = {};
  row.forEach(col => {
    if (col.metadata && col.metadata.colName) {
      result[col.metadata.colName] = col.value;
    }
  });
  return result;
}

interface ParsedAasServerInfo {
  regionalFqdn: string | null; // e.g., eastus.asazure.windows.net
  aasServerName?: string;    // e.g., resturantsas
  tdsEndpoint?: string;      // e.g., resturantsas.eastus.asazure.windows.net
}

// Helper to parse AAS connection string like "asazure://eastus.asazure.windows.net/resturantsas"
function parseAasConnectionString(connectionString: string | undefined): ParsedAasServerInfo {
  if (!connectionString) return { regionalFqdn: null };
  
  let serverIdentifier = connectionString;
  if (serverIdentifier.startsWith("asazure://")) {
    serverIdentifier = serverIdentifier.substring("asazure://".length); 
  }
  
  const parts = serverIdentifier.split('/'); 
  
  if (parts.length === 2 && parts[0].includes("asazure.windows.net") && parts[1]) {
    const regionalFqdn = parts[0];
    const aasServerName = parts[1];
    return { 
      regionalFqdn: regionalFqdn, 
      aasServerName: aasServerName,
      tdsEndpoint: `${aasServerName}.${regionalFqdn}` // Construct TDS endpoint
    }; 
  }
  
  // Fallback for simpler FQDNs if the pattern doesn't match the expected AAS URL format
  if (parts.length === 1 && serverIdentifier.includes("asazure.windows.net")) {
     // This case is less likely for AAS URLs like "asazure://..." but kept for robustness
    return { regionalFqdn: serverIdentifier, aasServerName: undefined, tdsEndpoint: serverIdentifier };
  }

  console.warn(`Unexpected AAS connection string format: ${connectionString}. Attempting to use identifier: ${serverIdentifier} as FQDN.`);
  // If we can't parse aasServerName, tdsEndpoint might be just the regionalFqdn which is unlikely to work for TDS.
  return { regionalFqdn: serverIdentifier, aasServerName: undefined, tdsEndpoint: serverIdentifier }; 
}

const parsedAasServerInfo = parseAasConnectionString(aasConnectionStringEnv);

export async function POST(request: NextRequest) {
  if (!parsedAasServerInfo.tdsEndpoint || !aasDatabaseNameEnv) {
    console.error("AAS Server TDS Endpoint or Database Name is not configured or derived correctly. Check NEXT_PUBLIC_AAS_SERVER_URL and NEXT_PUBLIC_AAS_DATABASE environment variables.");
    return NextResponse.json({ message: "Server configuration error: AAS server TDS endpoint or database name is missing or invalid." }, { status: 500 });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ message: 'Authorization header is missing or invalid.' }, { status: 401 });
  }
  const accessToken = authHeader.split(' ')[1];

  const config: ConnectionConfig = {
    server: parsedAasServerInfo.tdsEndpoint, // Use the constructed TDS endpoint
    authentication: {
      type: 'azure-active-directory-access-token',
      options: {
        token: accessToken,
      },
    },
    options: {
      database: aasDatabaseNameEnv, 
      encrypt: true, 
      connectTimeout: 30000, 
      requestTimeout: 30000, 
      rowCollectionOnRequestCompletion: true,
      // port: 1433, // Default for Tedious. AAS XMLA is typically on port 443 (HTTPS).
                   // Setting port to 443 here would make Tedious try to speak TDS to an HTTPS/XMLA endpoint.
                   // AAS TDS endpoint, if enabled, listens on 1433 by default.
    },
  };
  // DO NOT set instanceName for AAS when using Tedious.
  // The AAS server name is part of the FQDN for the TDS endpoint.

  return new Promise((resolve) => {
    const connection = new Connection(config);
    const results: AASData[] = [];
    let connectionError: Error | null = null;
    let requestError: Error | null = null;

    connection.on('connect', (err) => {
      if (err) {
        console.error('Connection Failed:', err);
        connectionError = err;
        // Tedious typically closes the connection on a failed connect attempt.
        // If not, connection.close() might be needed, but 'end' should still fire.
        return;
      }
      console.log('Successfully connected to Azure Analysis Services (or at least connection attempt initiated with Tedious).');
      executeStatement();
    });

    connection.on('end', () => {
        console.log('Connection closed.');
        if (connectionError || requestError) {
             const finalError = connectionError || requestError;
             resolve(NextResponse.json({ message: `Failed to connect to AAS or execute query: ${finalError?.message}` }, { status: 500 }));
        } else if (results.length === 0 && !requestError) { 
             console.warn("Query might have executed but returned no data, or an issue occurred without setting an error explicitly (and no connection error).");
             resolve(NextResponse.json([])); 
        }
        // If results have data and no errors, it's handled by request.on('requestCompleted').
    });
    
    connection.on('error', (err) => {
        // This event can be emitted for various reasons, including issues after connection.
        console.error('Connection object error event:', err);
        if (!connectionError && !requestError) connectionError = err; 
        // Tedious might close the connection itself on fatal errors.
        // Rely on 'end' to handle the final resolution.
    });


    function executeStatement() {
      const tediousRequest = new TediousRequest(DAX_QUERY, (err, rowCount) => {
        if (err) {
          console.error('DAX Query Execution Error (TediousRequest callback):', err);
          if(!requestError && !connectionError) requestError = err; 
        } else {
          console.log(`DAX Query request processed by Tedious, ${rowCount} rows potentially available.`);
        }
        // Do not close connection here. Let 'requestCompleted' or 'end' handle it.
      });

      tediousRequest.on('row', (columns) => {
        results.push(parseRow(columns));
      });
      
      tediousRequest.on('requestCompleted', () => {
         console.log('TediousRequest: requestCompleted event.');
         if (!connectionError && !requestError) { 
            resolve(NextResponse.json(results));
         } else {
            // Prefer requestError if available, as it's more specific to the query phase.
            const finalError = requestError || connectionError; 
            resolve(NextResponse.json({ message: `DAX query execution failed or connection error: ${finalError?.message}` }, { status: 500 }));
         }
         // Ensure connection is closed after request completion, regardless of success/failure.
         if (connection && !connection.closed) {
           connection.close(); 
         }
      });
      
      tediousRequest.on('error', (err) => { 
        console.error('TediousRequest object error event:', err);
        if(!requestError && !connectionError) requestError = err;
        // 'requestCompleted' should still fire according to Tedious docs, which will then handle resolution.
        // If it doesn't, the 'end' event on the connection should be the final fallback.
      });
      
      if (connectionError) { // Check if connection failed before attempting to execute.
          console.error("Skipping execSql due to prior connection failure:", connectionError.message);
          // No need to resolve here, 'end' event will handle it.
          // Ensure connection is closed if it was opened and then failed.
          if (connection && !connection.closed) {
            // connection.close(); // Let 'end' handle it to avoid race conditions or double close attempts.
          }
          return; 
      }
      
      try {
        connection.execSql(tediousRequest);
      } catch (execError: any) {
        console.error('Synchronous error executing SQL with Tedious:', execError);
        if(!requestError && !connectionError) requestError = execError;
        // Resolve immediately on synchronous error.
        resolve(NextResponse.json({ message: `Synchronous error during query execution: ${requestError?.message}` }, { status: 500 }));
        if (connection && !connection.closed) {
          connection.close();
        }
      }
    }

    try {
        // Attempt to connect. Asynchronous errors handled by 'connect', 'error', and 'end' events.
        connection.connect(); 
    } catch (e: any) {
        // This catch block for connection.connect() is unlikely to be hit for most async errors.
        console.error("Synchronous failure to initiate connection (rare with Tedious .connect()):", e);
        connectionError = e; 
        // Resolve immediately as the connection attempt itself failed synchronously.
        resolve(NextResponse.json({ message: `Failed to initiate connection to AAS: ${e.message}` }, { status: 500 }));
    }
  });
}
