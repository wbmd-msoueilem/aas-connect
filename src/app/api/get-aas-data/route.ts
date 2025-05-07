import { NextResponse, type NextRequest } from 'next/server';
import { Connection, Request as TediousRequest, type ColumnValue, type ConnectionConfig } from 'tedious';
import type { AASData } from '@/services/azure-analysis-services';

// Ensure environment variables are loaded
const aasConnectionStringEnv = process.env.NEXT_PUBLIC_AAS_SERVER_URL; // Expected format: "asazure://<region_host>/<server_name>" e.g., "asazure://eastus.asazure.windows.net/resturantsas"
const aasDatabaseNameEnv = process.env.NEXT_PUBLIC_AAS_DATABASE; // e.g., "adventureworks"

// Basic DAX query - adjust to your AdventureWorks model
// This query attempts to get Sales Amount by Product Category and Calendar Year.
// Replace 'Sales', 'Product'[Product Category Name], 'Date'[Calendar Year] with actual column names from your model.
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
  aasServerName?: string; // The specific AAS server instance name, e.g., "resturantsas"
}

// Helper to parse AAS connection string like "asazure://eastus.asazure.windows.net/resturantsas"
function parseAasConnectionString(connectionString: string | undefined): ParsedAasServerInfo {
  if (!connectionString) return { fqdn: null };
  
  let serverIdentifier = connectionString;
  if (serverIdentifier.startsWith("asazure://")) {
    serverIdentifier = serverIdentifier.substring("asazure://".length); // e.g., "eastus.asazure.windows.net/resturantsas"
  }
  
  const parts = serverIdentifier.split('/'); // e.g., ["eastus.asazure.windows.net", "resturantsas"]
  
  if (parts.length === 2 && parts[0].includes("asazure.windows.net")) {
    // parts[0] is the regional host (FQDN for Tedious), e.g., "eastus.asazure.windows.net"
    // parts[1] is the AAS server instance name, e.g., "resturantsas"
    return { fqdn: parts[0], aasServerName: parts[1] }; 
  }
  
  // Handles cases where the input might already be a plain FQDN like "myinstance.eastus.asazure.windows.net"
  // (though this format is less common for the NEXT_PUBLIC_AAS_SERVER_URL which includes the protocol and instance)
  if (parts.length === 1 && serverIdentifier.includes("asazure.windows.net")) {
    return { fqdn: serverIdentifier };
  }

  console.warn(`Unexpected AAS connection string format: ${connectionString}. Attempting to use identifier: ${serverIdentifier} as FQDN.`);
  // Fallback: use the processed identifier as FQDN. This might lead to issues if it's not a valid FQDN.
  return { fqdn: serverIdentifier }; 
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
    server: parsedAasServerInfo.fqdn, // e.g., "eastus.asazure.windows.net"
    authentication: {
      type: 'azure-active-directory-access-token',
      options: {
        token: accessToken,
      },
    },
    options: {
      database: aasDatabaseNameEnv, // e.g., "adventureworks"
      encrypt: true, 
      connectTimeout: 30000, 
      requestTimeout: 30000, 
      rowCollectionOnRequestCompletion: true,
      // Tedious default port is 1433. AAS XMLA endpoint is typically 443 (HTTPS).
      // This is a fundamental mismatch.
    },
  };

  // If an AAS server name (like "resturantsas") was parsed, try setting it as instanceName.
  // This is a long shot because AAS instances are not SQL Server named instances,
  // and Tedious uses instanceName to query SQL Server Browser service (UDP 1434), which is not applicable here.
  if (parsedAasServerInfo.aasServerName && config.options) {
    config.options.instanceName = parsedAasServerInfo.aasServerName;
  }

  return new Promise((resolve) => {
    const connection = new Connection(config);
    const results: AASData[] = [];
    let connectionError: Error | null = null;
    let requestError: Error | null = null;

    connection.on('connect', (err) => {
      if (err) {
        console.error('Connection Failed:', err);
        connectionError = err;
        // If connection fails to establish, 'end' might not fire or might fire after this.
        // Ensure we resolve if this is the terminal error.
        // Tedious might close the connection automatically on a failed connect event.
        // No need to call connection.close() here if it's already handled or not open.
        return;
      }
      console.log('Successfully connected to Azure Analysis Services (or at least connection attempt initiated with Tedious).');
      executeStatement();
    });

    connection.on('end', () => {
        console.log('Connection closed.');
        // This event fires after connection.close() is called AND all operations are finished,
        // or if the connection was terminated for other reasons.
        if (connectionError || requestError) {
             const finalError = connectionError || requestError;
             resolve(NextResponse.json({ message: `Failed to connect to AAS or execute query: ${finalError?.message}` }, { status: 500 }));
        } else if (results.length === 0) { 
             console.warn("Query might have executed but returned no data, or an issue occurred without setting an error explicitly.");
             resolve(NextResponse.json([])); // Return empty array if no data and no explicit error.
        }
        // If results have data, it's handled by request.on('requestCompleted') before connection.close() is called.
    });
    
    connection.on('error', (err) => {
        // Handles errors that occur on the connection object itself.
        console.error('Connection object error event:', err);
        if (!connectionError) connectionError = err; // Capture first connection error
        // Tedious usually handles closing the connection on fatal errors.
    });


    function executeStatement() {
      const tediousRequest = new TediousRequest(DAX_QUERY, (err, rowCount) => {
        if (err) {
          console.error('DAX Query Execution Error (TediousRequest constructor callback):', err);
          if(!requestError && !connectionError) requestError = err; 
        } else {
          console.log(`DAX Query request processed by Tedious, ${rowCount} rows potentially available.`);
        }
        // Don't close connection here. Let 'requestCompleted' or 'end' handle it.
      });

      tediousRequest.on('row', (columns) => {
        results.push(parseRow(columns));
      });
      
      tediousRequest.on('requestCompleted', () => {
         console.log('TediousRequest: requestCompleted event.');
         // This is the ideal place to resolve with results if no prior errors.
         if (!connectionError && !requestError) {
            resolve(NextResponse.json(results));
         } else {
            const finalError = connectionError || requestError;
            resolve(NextResponse.json({ message: `DAX query execution failed or connection error: ${finalError?.message}` }, { status: 500 }));
         }
         if (!connection.closed) {
           connection.close(); 
         }
      });
      
      tediousRequest.on('error', (err) => {
        console.error('TediousRequest object error event:', err);
        if(!requestError && !connectionError) requestError = err;
        // 'requestCompleted' should still fire after this, or connection 'end' will handle resolution.
        // If connection is still open and this error is fatal for the request, ensure it's closed.
        // However, Tedious might manage this. Closing prematurely here could suppress 'requestCompleted'.
      });

      try {
        // Check if connection attempt failed already (connectionError would be set by 'connect' event handler)
        if (connectionError) {
            console.error("Skipping execSql due to prior connection failure:", connectionError.message);
            // Resolve with the existing connectionError. 'end' event should also handle this.
            // To be safe, if connection.close() hasn't been called or isn't pending:
            if (!connection.closed) {
                 // connection.close(); // Let 'end' event handle resolution after close.
            }
            // Resolve here only if 'end' is not guaranteed to fire or resolve correctly.
            // resolve(NextResponse.json({ message: `Failed to execute query due to connection error: ${connectionError.message}` }, { status: 500 }));
            return; 
        }
        connection.execSql(tediousRequest);
      } catch (execError: any) {
        console.error('Synchronous error executing SQL with Tedious:', execError);
        if(!requestError && !connectionError) requestError = execError;
        // Resolve here as a fallback if the request events don't fire.
        resolve(NextResponse.json({ message: `Synchronous error during query execution: ${requestError?.message}` }, { status: 500 }));
        if (!connection.closed) {
          connection.close();
        }
      }
    }

    try {
        connection.connect(); 
    } catch (e: any) {
        console.error("Synchronous failure to initiate connection (rare with Tedious .connect()):", e);
        connectionError = e; // Capture synchronous error
        resolve(NextResponse.json({ message: `Failed to initiate connection to AAS: ${e.message}` }, { status: 500 }));
    }
  });
}

