
"use client";

import { useMsal, useAccount } from "@azure/msal-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LogOut, UserCircle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

export function Header() {
  const { instance, accounts } = useMsal();
  const account = useAccount(accounts[0] || {});
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      await instance.logoutPopup({
        mainWindowRedirectUri: "/", // Redirect to home page after logout
      });
    } catch (error) {
      console.error("Logout failed:", error);
       toast({
        title: "Logout Failed",
        description: "An error occurred during logout. Please try again.",
        variant: "destructive",
      });
    }
  };

  const getInitials = (name?: string | null) => {
    if (!name) return "U";
    const names = name.split(" ");
    if (names.length === 1) return names[0].charAt(0).toUpperCase();
    return names[0].charAt(0).toUpperCase() + names[names.length - 1].charAt(0).toUpperCase();
  };

  if (!account) {
    return null; // Or a loading state
  }

  return (
    <header className="bg-card shadow-md p-4">
      <div className="container mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
           <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-primary fill-current">
            <title>AAS Connect</title>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v2h-2zm0 4h2v6h-2z"/>
           </svg>
          <h1 className="text-2xl font-bold text-primary">AAS Connect</h1>
        </div>
        <div className="flex items-center gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-10 w-10 rounded-full">
                <Avatar className="h-10 w-10">
                  {/* Placeholder for profile picture from Microsoft Graph */}
                  {/* <AvatarImage src={account.imageUrl} alt={account.name || account.username} /> */}
                  <AvatarFallback>
                    {getInitials(account.name)}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">
                    {account.name || "User"}
                  </p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {account.username} {/* Typically email */}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="cursor-pointer">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
