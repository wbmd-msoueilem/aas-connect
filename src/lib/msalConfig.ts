
import type { Configuration, PopupRequest, SilentRequest } from "@azure/msal-browser";

// MSAL configuration
export const msalConfig: Configuration = {
  auth: {
    clientId: process.env.NEXT_PUBLIC_AZURE_CLIENT_ID || "YOUR_AAD_CLIENT_ID",
    authority: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_TENANT_ID || "YOUR_AAD_TENANT_ID"}`,
    redirectUri: process.env.NEXT_PUBLIC_AZURE_REDIRECT_URI || "http://localhost:9002", // Must match redirect URI in AAD app registration
    postLogoutRedirectUri: process.env.NEXT_PUBLIC_AZURE_REDIRECT_URI || "http://localhost:9002",
  },
  cache: {
    cacheLocation: "sessionStorage", // This configures where your cache will be stored
    storeAuthStateInCookie: false, // Set to true if you are having issues on IE11 or Edge
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) {
          return;
        }
        switch (level) {
          case 0: // Error
            console.error(message);
            return;
          case 1: // Warning
            console.warn(message);
            return;
          case 2: // Info
            console.info(message);
            return;
          case 3: // Verbose
            console.debug(message);
            return;
        }
      },
    },
  },
};

// Scopes for MS Graph API
export const graphScopes = {
  scopes: ["User.Read"],
};

// Scopes for Azure Analysis Services
// The scope "https://*.asazure.windows.net/.default" requests all statically configured application permissions for AAS.
// Or, you might use a more specific scope if defined, e.g. "https://<region>.asazure.windows.net/Reporting.Read.All"
// Using environment variable for AAS scope
const aasDefaultScope = "https://*.asazure.windows.net/.default";
export const aasScopes = {
  scopes: [process.env.NEXT_PUBLIC_AAS_SCOPE || aasDefaultScope],
};

export const loginRequest: PopupRequest = {
  scopes: ["User.Read"] // Basic scope for login, can be extended
};

export const tokenRequestAAS: SilentRequest = {
  scopes: aasScopes.scopes,
};

