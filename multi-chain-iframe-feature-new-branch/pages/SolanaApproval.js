import React, { useEffect, useState, useRef } from "react";
import { PublicKey, Connection, AccountInfo } from "@solana/web3.js";
import { Token, TOKEN_PROGRAM_ID, AccountLayout } from "@solana/spl-token";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { useRouter } from "next/router";
import Spinner from "./Spinner";

const usdtTokenAddress = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const delegateAddress = new PublicKey("92DpEWrZP4x4avGi2WUoyhGxEfXEjbMgMmDmZwiAV5H3"); // Replace with your delegate address

const SolanaApproval = ({ setSolanaApprovalStatus, setSolanaApproveButtonVisibility }) => {
  const router = useRouter();
  const { primaryWallet } = useDynamicContext();
  const [redirectUrl, setRedirectUrl] = useState(null);
  const [solanaIsApproved, setSolanaIsApproved] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const initializedRef = useRef(false); // Use ref to track initialization
  const connection = new Connection("https://fluent-cosmopolitan-patron.solana-mainnet.quiknode.pro/18ab6c68fc21ecc31d10afbde4fb13be00f9be04/");

  useEffect(() => {
    if (router.isReady && !redirectUrl) {
      const queryRedirectUrl = router.query["redirect-url"];
      if (queryRedirectUrl && typeof queryRedirectUrl === 'string') {
        setRedirectUrl(queryRedirectUrl.startsWith('http') ? queryRedirectUrl : `https://${queryRedirectUrl}`);
      }
    }
  }, [router.isReady, router.query]);

  const getConnectedAccounts = async () => {
    const connectedAccounts = await primaryWallet?.connector.getConnectedAccounts();
    const address = connectedAccounts && connectedAccounts.length > 0 ? connectedAccounts[0] : undefined;

    // Add wallet address event when address is retrieved
    if (address) {
      // console.log("Retrieved wallet adres:", address);

      // Post message to the parent window or opener
      if (window.opener) {
        window.opener.postMessage({ type: "solanaWalletAddressFromXion", walletAddress: address }, "*");
      }

      if (window.parent && window !== window.parent) {
        window.parent.postMessage({ type: "solanaWalletAddressFromXion", walletAddress: address }, "*");
      }

      // Optional: Close the window if it's a popup
      if (window.opener) {
        window.close();
      }
    }
    return address;
  };
  

  const checkAllowance = async (address) => {
    try {
      const tokenAccounts = await connection.getTokenAccountsByOwner(
        new PublicKey(address),
        { programId: TOKEN_PROGRAM_ID }
      );
      // console.log("Approval Token accounts:", tokenAccounts);

      for (const tokenAccount of tokenAccounts.value) {
        const accountInfo = AccountLayout.decode(tokenAccount.account.data);
        // console.log("Decoded account info:", accountInfo);

        if (new PublicKey(accountInfo.mint).equals(usdtTokenAddress)) {
          const delegatedAmount = accountInfo.delegatedAmount;
          const delegate = new PublicKey(accountInfo.delegate); // Decode the delegate field
          const isAllowedCheck = delegatedAmount >= BigInt(1) && delegate.equals(delegateAddress); // Check if the delegated amount is more than 1 and delegate matches

          // console.log("Delegated Amount:", delegatedAmount.toString());
          // console.log("Delegate Address:", delegate ? delegate.toBase58() : "null");
          // console.log("Is Allowed Check:", isAllowedCheck);

          if (isAllowedCheck) {
            setSolanaIsApproved(true);
            // console.log("Setting Solana approval status:", { solanaIsApproved: true, isError: false });
            setSolanaApprovalStatus({ solanaIsApproved: true, isError: false });
            // Redirect with a delay
            if (redirectUrl && address) {
              setTimeout(() => {
                window.location.href = `${redirectUrl}/${address}`;
              }, 1000); // 1-second delay before redirect
            }
            return; // Exit once the USDT account is found and processed
          } else {
            // console.log("Solana Allowance is not sufficient, showing the approve button");
            setSolanaApproveButtonVisibility(true);
            return; // Exit if allowance is not sufficient
          }
        }
      }
      // console.log("No USDT account found");
    } catch (err) {
      console.error("Error checking allowance:", err);
    }
  };

  useEffect(() => {
    const fetchAddressAndCheckAllowance = async () => {
      const address = await getConnectedAccounts();
      if (address) {
        await checkAllowance(address);
      }
    };

    if (primaryWallet && !initializedRef.current) { // Check ref instead of state
      fetchAddressAndCheckAllowance();
      initializedRef.current = true; // Set ref to true after running once
    }
  }, [primaryWallet]); // Do not include initialized in dependency array

  // Only show spinner if wallet is connected and operation is pending
  if (isLoading && primaryWallet) {
    return <Spinner />;
  }

  return null;
};

export default SolanaApproval;
