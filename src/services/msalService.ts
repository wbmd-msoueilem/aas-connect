
import { PublicClientApplication, EventType, type EventMessage, type AuthenticationResult } from '@azure/msal-browser';
import { msalConfig } from '@/lib/msalConfig';

export const msalInstance = new PublicClientApplication(msalConfig);

// Account selection logic is optional.
// If you have multiple accounts signed in, you can use this logic to select the active account.
const accounts = msalInstance.getAllAccounts();
if (accounts.length > 0) {
  msalInstance.setActiveAccount(accounts[0]);
}

msalInstance.addEventCallback((event: EventMessage) => {
  if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
    const payload = event.payload as AuthenticationResult;
    const account = payload.account;
    msalInstance.setActiveAccount(account);
  }
});
