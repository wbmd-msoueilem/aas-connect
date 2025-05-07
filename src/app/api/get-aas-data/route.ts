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
  fqdn: string | null;
  aasServerName?: string; 
}

// Helper to parse AAS connection string like "asazure://eastus.asazure.windows.net/resturantsas"
function parseAasConnectionString(connectionString: string | undefined): ParsedAasServerInfo {
  if (!connectionString) return { fqdn: null };
  
  let serverIdentifier = connectionString;
  if (serverIdentifier.startsWith("asazure://")) {
    serverIdentifier = serverIdentifier.substring("asazure://".length); 
  }
  
  const parts = serverIdentifier.split('/'); 
  
  if (parts.length === 2 && parts[0].includes("asazure.windows.net")) {
    return { fqdn: parts[0], aasServerName: parts[1] }; 
  }
  
  if (parts.length === 1 && serverIdentifier.includes("asazure.windows.net")) {
    return { fqdn: serverIdentifier, aasServerName: undefined };
  }

  console.warn(`Unexpected AAS connection string format: ${connectionString}. Attempting to use identifier: ${serverIdentifier} as FQDN.`);
  return { fqdn: serverIdentifier, aasServerName: undefined }; 
}

const parsedAasServerInfo = parseAasConnectionString(aasConnectionStringEnv);

export async function POST(request: NextRequest) {
  if (!parsedAasServerInfo.fqdn || !aasDatabaseNameEnv) {
    console.error("AAS Server FQDN or Database Name is not configured or derived correctly. Check NEXT_PUBLIC_AAS_SERVER_URL and NEXT_PUBLIC_AAS_DATABASE environment variables.");
    return NextResponse.json({ message: "Server configuration error: AAS server URL or database name is missing or invalid." }, { status: 500 });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ message: 'Authorization header is missing or invalid.' }, { status: 401 });
  }
  const accessToken = authHeader.split(' ')[1];

  const config: ConnectionConfig = {
    server: parsedAasServerInfo.fqdn, // Use the FQDN (e.g., "eastus.asazure.windows.net")
    authentication: {
      type: 'azure-active-directory-access-token',
      options: {
        token: accessToken,
      },
    },
    options: {
      database: aasDatabaseNameEnv, // Use the AAS database name (e.g., "adventureworks")
      encrypt: true, 
      connectTimeout: 30000, 
      requestTimeout: 30000, 
      rowCollectionOnRequestCompletion: true,
      // port: 1433, // Default for Tedious. AAS XMLA is typically on port 443 (HTTPS).
                   // Setting port to 443 here would make Tedious try to speak TDS to an HTTPS/XMLA endpoint.
    },
  };

  // DO NOT set instanceName for AAS when using Tedious in this manner.
  // The 'aasServerName' (e.g., "resturantsas") is part of the AAS path, not a SQL Server instance name.
  // If 'instanceName' is set, Tedious will try to connect to 'fqdn\aasServerName',
  // which is incorrect for AAS and causes the "Failed to connect to server\instance" error.

  return new Promise((resolve) => {
    const connection = new Connection(config);
    const results: AASData[] = [];
    let connectionError: Error | null = null;
    let requestError: Error | null = null;

    connection.on('connect', (err) => {
      if (err) {
        console.error('Connection Failed:', err);
        connectionError = err;
        // Ensure 'end' or 'error' event on connection will handle resolution.
        // No need to call connection.close() here if it's not open or Tedious handles it.
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
        } else if (results.length === 0 && !requestError) { // Check !requestError here
             console.warn("Query might have executed but returned no data, or an issue occurred without setting an error explicitly (and no connection error).");
             resolve(NextResponse.json([])); 
        }
        // If results have data and no errors, it's handled by request.on('requestCompleted').
    });
    
    connection.on('error', (err) => {
        console.error('Connection object error event:', err);
        if (!connectionError) connectionError = err; 
        // Tedious usually handles closing the connection on fatal errors.
        // If 'end' doesn't fire or resolve correctly after this, this error might be lost.
        // To be safe, consider resolving here if it's a terminal state not covered by 'end'.
        // However, this might lead to double resolution if 'end' also resolves.
        // Let's rely on 'end' to handle the final resolution.
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
         if (!connectionError && !requestError) { // Ensure no prior errors
            resolve(NextResponse.json(results));
         } else {
            const finalError = connectionError || requestError; // requestError might be more specific here
            resolve(NextResponse.json({ message: `DAX query execution failed or connection error: ${finalError?.message}` }, { status: 500 }));
         }
         if (!connection.closed) {
           connection.close(); 
         }
      });
      
      tediousRequest.on('error', (err) => { // Error specific to this TediousRequest object
        console.error('TediousRequest object error event:', err);
        if(!requestError && !connectionError) requestError = err;
        // 'requestCompleted' should still fire. Rely on it or 'end' for resolution.
      });

      // Guard against executing SQL if connection already failed
      if (connectionError) {
          console.error("Skipping execSql due to prior connection failure:", connectionError.message);
          // Resolve based on connectionError. 'end' event should also handle this path.
          // To prevent double resolution, rely on 'end' or 'connect' error handling.
          // If connection.close() is not called, 'end' might not fire.
          if (!connection.closed) {
            // connection.close(); // Let 'end' or error event handle this.
          }
          // If 'connect' error already happened, we might not need to resolve again here if 'end' covers it.
          // For safety, ensure resolution if 'end' is not guaranteed or if connection isn't cleanly closing.
          // However, the 'connect' error handler currently doesn't resolve, it sets connectionError and returns.
          // The 'end' handler is the primary place for resolving with errors.
          return; 
      }
      
      try {
        connection.execSql(tediousRequest);
      } catch (execError: any) {
        console.error('Synchronous error executing SQL with Tedious:', execError);
        if(!requestError && !connectionError) requestError = execError;
        resolve(NextResponse.json({ message: `Synchronous error during query execution: ${requestError?.message}` }, { status: 500 }));
        if (!connection.closed) {
          connection.close();
        }
      }
    }

    try {
        // Attempt to connect. Error handled by 'connect', 'error', and 'end' events.
        connection.connect(); 
    } catch (e: any) {
        // This catch block for connection.connect() is unlikely to be hit for async errors.
        // Tedious .connect() typically emits 'connect' with error or 'error' event.
        console.error("Synchronous failure to initiate connection (rare with Tedious .connect()):", e);
        connectionError = e; 
        resolve(NextResponse.json({ message: `Failed to initiate connection to AAS: ${e.message}` }, { status: 500 }));
    }
  });
}
