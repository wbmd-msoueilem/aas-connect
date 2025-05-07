
import { NextResponse, type NextRequest } from 'next/server';
import { Connection, Request as TediousRequest, type ColumnValue } from 'tedious';
import type { AASData } from '@/services/azure-analysis-services';

// Ensure environment variables are loaded
const aasServerUrl = process.env.NEXT_PUBLIC_AAS_SERVER_URL;
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

export async function POST(request: NextRequest) {
  if (!aasServerUrl || !aasDatabaseName) {
    console.error("AAS Server URL or Database Name is not configured in environment variables.");
    return NextResponse.json({ message: "Server configuration error. NEXT_PUBLIC_AAS_SERVER_URL or NEXT_PUBLIC_AAS_DATABASE missing." }, { status: 500 });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ message: 'Authorization header is missing or invalid.' }, { status: 401 });
  }
  const accessToken = authHeader.split(' ')[1];

  const config = {
    server: aasServerUrl.startsWith("asazure://") ? aasServerUrl.substring("asazure://".length) : aasServerUrl, // Tedious expects server without protocol
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
        connection.close(); // Ensure connection is closed on error
        return;
      }
      console.log('Successfully connected to Azure Analysis Services.');
      executeStatement();
    });

    connection.on('end', () => {
        console.log('Connection closed.');
        if (connectionError) {
             resolve(NextResponse.json({ message: `Failed to connect to AAS: ${connectionError.message}` }, { status: 500 }));
        } else if (results.length === 0 && !connectionError) { // Check if results are empty but no connection error
             console.warn("Query executed successfully but returned no data.");
             resolve(NextResponse.json([])); // Return empty array if no data but successful query
        }
    });
    
    connection.on('error', (err) => {
        // This event can be triggered for various reasons, including network issues or configuration problems after initial connect.
        console.error('Connection error event:', err);
        if (!connectionError) connectionError = err; // Store if not already set by 'connect'
        // It's possible the connection might already be closed or in a closing state.
        // Avoid calling close if it's already been handled or if it might cause further errors.
    });


    function executeStatement() {
      const tediousRequest = new TediousRequest(DAX_QUERY, (err, rowCount) => {
        if (err) {
          console.error('DAX Query Failed:', err);
          connectionError = err;
        } else {
          console.log(`DAX Query successful, ${rowCount} rows returned.`);
        }
        connection.close(); // Close connection after query execution (or error)
      });

      tediousRequest.on('row', (columns) => {
        results.push(parseRow(columns));
      });
      
      tediousRequest.on('doneProc', (rowCount, more, returnStatus, rows) => {
        // This event signals the completion of the request.
        // 'rows' will contain the array of row data if `rowCollectionOnRequestCompletion` is true.
        // If `rowCollectionOnRequestCompletion` is false, `rows` will be undefined and you rely on 'row' events.
        // In this setup with `rowCollectionOnRequestCompletion: true`, rows is populated here.
        // However, we are populating `results` via the 'row' event for consistency.
        // If `results` is still empty here and `rowCount` > 0, it might indicate an issue with `parseRow` or row event handling.
      });

      tediousRequest.on('requestCompleted', () => {
         // This is another place to confirm request completion.
         // The connection.close() in the TediousRequest callback should trigger 'end' event eventually.
         // If there was an error during the query, connectionError would be set.
         if (!connectionError) {
            resolve(NextResponse.json(results));
         } else {
            resolve(NextResponse.json({ message: `DAX query execution failed: ${connectionError.message}` }, { status: 500 }));
         }
      });

      try {
        connection.execSql(tediousRequest);
      } catch (execError: any) {
        console.error('Error executing SQL with Tedious:', execError);
        connectionError = execError;
        connection.close();
      }
    }
    // Attempt to connect
    try {
        connection.connect();
    } catch (e: any) {
        console.error("Failed to initiate connection:", e);
        connectionError = e;
        resolve(NextResponse.json({ message: `Failed to initiate connection to AAS: ${e.message}` }, { status: 500 }));
    }
  });
}

