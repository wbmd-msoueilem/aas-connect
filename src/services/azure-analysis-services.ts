
/**
 * Represents a single row of data retrieved from Azure Analysis Services.
 * The keys are column names and values are the corresponding cell values.
 */
export interface AASData {
  [key: string]: string | number | boolean | Date | null;
}
