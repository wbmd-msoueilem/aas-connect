
import { NextResponse, type NextRequest } from 'next/server';
import { Connection, Request as TediousRequest, type ColumnValue } from 'tedious';
import type { AASData } from '@/services/azure-analysis-services';

// Ensure environment variables are loaded
const aasConnectionString = process.env.NEXT_PUBLIC_AAS_SERVER_URL;
const aasDatabaseName = process.env.NEXT_PUBLIC_AAS_DATABASE;

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

// Helper to parse AAS connection string to FQDN
function getFqdnFromAasConnectionString(connectionString: string | undefined): string | null {
  if (!connectionString) return null;
  
  let serverIdentifier = connectionString;
  if (connectionString.startsWith("asazure://")) {
    serverIdentifier = connectionString.substring("asazure://".length);
  }
  
  // Format: [region_host]/[server_name] e.g. "eastus.asazure.windows.net/resturantsas"
  // Should become: [server_name].[region_host] e.g. "resturantsas.eastus.asazure.windows.net"
  const parts = serverIdentifier.split('/');
  if (parts.length === 2 && parts[0].includes("asazure.windows.net")) {
    // parts[0] is region_host, parts[1] is server_name
    return `${parts[1]}.${parts[0]}`; 
  }
  
  // If format is already FQDN (e.g. "myserver.eastus.asazure.windows.net") or unexpected, return as is (or stripped if protocol was present)
  // This will cover cases like "servername.region.asazure.windows.net"
  if (parts.length === 1 && serverIdentifier.includes("asazure.windows.net")) {
    return serverIdentifier;
  }

  console.warn(`Unexpected AAS connection string format: ${connectionString}. Using identifier: ${serverIdentifier} as is.`);
  return serverIdentifier; 
}

const aasServerFqdn = getFqdnFromAasConnectionString(aasConnectionString);

export async function POST(request: NextRequest) {
  if (!aasServerFqdn || !aasDatabaseName) {
    console.error("AAS Server FQDN or Database Name is not configured or derived correctly from NEXT_PUBLIC_AAS_SERVER_URL and NEXT_PUBLIC_AAS_DATABASE.");
    return NextResponse.json({ message: "Server configuration error. Check NEXT_PUBLIC_AAS_SERVER_URL format or if NEXT_PUBLIC_AAS_DATABASE is missing." }, { status: 500 });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ message: 'Authorization header is missing or invalid.' }, { status: 401 });
  }
  const accessToken = authHeader.split(' ')[1];

  const config = {
    server: aasServerFqdn, // Use the derived FQDN
    authentication: {
      type: 'azure-active-directory-access-token',
      options: {
        token: accessToken,
      },
    },
    options: {
      database: aasDatabaseName,
      encrypt: true, // Important for Azure connections
      connectTimeout: 30000, // 30 seconds
      requestTimeout: 30000, // 30 seconds
      rowCollectionOnRequestCompletion: true, // Ensure rows are collected
    },
  };

  return new Promise((resolve) => {
    const connection = new Connection(config);
    const results: AASData[] = [];
    let connectionError: Error | null = null;

    connection.on('connect', (err) => {
      if (err) {
        console.error('Connection Failed:', err);
        connectionError = err;
        // No need to call connection.close() here, 'end' or 'error' event will handle cleanup.
        // If connection.close() is called before 'end' in some scenarios, it might suppress the 'requestCompleted' logic.
        return;
      }
      console.log('Successfully connected to Azure Analysis Services (or at least connection attempt initiated).');
      executeStatement();
    });

    connection.on('end', () => {
        console.log('Connection closed.');
        // This 'end' event fires after connection.close() is called AND all operations are finished.
        // If connectionError is set, it means failure happened before or during query.
        // If results are empty and no error, it means query ran but returned no data, or connection was closed before query completion without a specific connection error.
        if (connectionError) {
             resolve(NextResponse.json({ message: `Failed to connect to AAS: ${connectionError.message}` }, { status: 500 }));
        } else if (results.length === 0) { 
             console.warn("Query executed but returned no data, or connection was closed before query completion without a specific connection error.");
             // It's possible the query did run and returned 0 rows, or an error occurred in executeStatement that didn't set connectionError but closed connection.
             // To be safe, if no results and no explicit error, return empty. If an error occurred in executeStatement, it should have resolved.
             resolve(NextResponse.json([]));
        }
        // If results have data, it's handled by request.on('requestCompleted')
    });
    
    connection.on('error', (err) => {
        // This handles errors that occur on the connection object itself, possibly outside of a specific request.
        console.error('Connection object error event:', err);
        if (!connectionError) connectionError = err;
        // Ensure connection is closed if not already. Tedious usually handles this.
        // Check connection state before attempting to close if possible (tedious does not expose state easily here)
        // connection.close(); // Could lead to issues if already closing or closed. Handled by Tedious internal logic or 'end'.
    });


    function executeStatement() {
      const tediousRequest = new TediousRequest(DAX_QUERY, (err, rowCount) => {
        // This callback is for the constructor of TediousRequest, usually indicates completion or an error during the request.
        if (err) {
          console.error('DAX Query Execution Error:', err);
          if(!connectionError) connectionError = err; // Prioritize connection errors if already set
        } else {
          console.log(`DAX Query request processed, ${rowCount} rows potentially available.`);
        }
        // Don't close connection here if relying on 'requestCompleted' or 'doneProc' for results processing.
        // connection.close(); // Moved to requestCompleted or if error occurs.
      });

      tediousRequest.on('row', (columns) => {
        results.push(parseRow(columns));
      });
      
      // 'doneProc' is more relevant for stored procedures. For general queries, 'requestCompleted' is key.
      tediousRequest.on('doneProc', (rowCount, more, returnStatus, rows) => {
        // console.log("'doneProc' event", { rowCount, more, returnStatus, rowsLength: rows?.length });
      });

      // This event is crucial for knowing when the request (query) itself has finished.
      tediousRequest.on('requestCompleted', () => {
         console.log('TediousRequest: requestCompleted event.');
         if (!connectionError) {
            resolve(NextResponse.json(results));
         } else {
            // If a connectionError occurred (e.g., during 'connect' or a query execution error caught by TediousRequest constructor)
            resolve(NextResponse.json({ message: `DAX query execution failed or connection error: ${connectionError.message}` }, { status: 500 }));
         }
         connection.close(); // Close connection after this request is fully processed.
      });
      
      tediousRequest.on('error', (err) => {
        // Handles errors specific to this TediousRequest object.
        console.error('TediousRequest object error event:', err);
        if(!connectionError) connectionError = err;
        // No need to resolve here, 'requestCompleted' will eventually fire, or connection 'end'/'error'
        // connection.close(); // Let requestCompleted or connection.on('end') handle this.
      });

      try {
        // Only call execSql if connection was successful.
        if (connection.closed || connectionError) { // Check if connection is already problematic
            if(!connectionError) connectionError = new Error("Connection was closed or in an error state before query execution.");
            console.error(connectionError.message);
            // Resolve with error if not already resolved by connection.on('end') due to connectionError
            // This logic path might be tricky if 'end' hasn't fired yet.
            // Safest to let the connection.on('end') or request.on('requestCompleted') handle resolution.
            // However, if connection failed to open, 'connect' error handles it.
            // If it opened then errored, 'error' or 'end' on connection handles it.
            // This is more of a safeguard.
            if (!connection.closed) connection.close(); // Try to close if not already.
            // Resolve here if it's certain no other handler will.
            // resolve(NextResponse.json({ message: `Failed to execute query: ${connectionError.message}` }, { status: 500 }));
            return; 
        }
        connection.execSql(tediousRequest);
      } catch (execError: any) {
        console.error('Synchronous error executing SQL with Tedious:', execError);
        if(!connectionError) connectionError = execError;
        // connection.close(); // Let requestCompleted or connection.on('end') handle this.
        // Resolve here as a fallback if the request events don't fire.
        resolve(NextResponse.json({ message: `Synchronous error during query execution: ${connectionError.message}` }, { status: 500 }));
        if (!connection.closed) connection.close();
      }
    }
    // Attempt to connect
    try {
        // The 'connect' event will be emitted, or an error passed to its callback.
        // connection.connect() itself doesn't throw for most common connection issues; it's async.
        // Synchronous errors from .connect() are rare, usually config issues caught by constructor.
        connection.connect(); 
    } catch (e: any) {
        // This catch block is unlikely to be hit for network-related connection errors with Tedious's .connect()
        console.error("Synchronous failure to initiate connection (rare):", e);
        connectionError = e;
        resolve(NextResponse.json({ message: `Failed to initiate connection to AAS: ${e.message}` }, { status: 500 }));
    }
  });
}
