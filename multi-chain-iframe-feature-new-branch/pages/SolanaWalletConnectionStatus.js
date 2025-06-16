import React, { useEffect, useState } from "react";
import { useIsLoggedIn, useDynamicContext } from "@dynamic-labs/sdk-react-core";
import styles from './WalletConnectionStatus.module.css';

const SolanaWalletConnectionStatus = ({ solanaApprovalStatus, isAllowed }) => {
  const [message, setMessage] = useState('');
  const isLoggedIn = useIsLoggedIn(); // Check if the user is logged in
  const { user, primaryWallet } = useDynamicContext();
  const [isWalletConnected, setIsWalletConnected] = useState(false); // New state to track wallet connection status

  const getConnectedAccounts = async () => {
    if (primaryWallet && primaryWallet.connector) {
      try {
        const connectedAccounts = await primaryWallet.connector.getConnectedAccounts();
        return connectedAccounts && connectedAccounts.length > 0 ? connectedAccounts[0] : undefined;
      } catch (error) {
        console.error("Error getting connected accounts:", error);
        return undefined;
      }
    }
    return undefined;
  };

  useEffect(() => {
    // console.log("solanaApprovalStatus:", solanaApprovalStatus); // Log the solanaApprovalStatus

    const fetchData = async () => {
      if (!primaryWallet) {
        // console.log("Primary Wallet not set yet.");
        setIsWalletConnected(false);
        return;
      }

      const address = await getConnectedAccounts(); // Get the connected wallet address if any
      // console.log("User:", user);
      // console.log("Primary Wallet:", primaryWallet);
      // console.log("Retrieved address:", address);

      if (address) {
        setIsWalletConnected(true); // Update the wallet connection status
      } else {
        setIsWalletConnected(false);
      }

      // Clear the message if no wallet is connected
      if (!isLoggedIn || !address) {
        setMessage('');
        return; // Exit early if no wallet is connected
      }

      // Set messages based on approval status if a wallet is connected
      if (solanaApprovalStatus.solanaIsApproved) {
        setMessage('Successfully linked your web3 wallet for 1-click USDt payments');
      } else if (address && !isAllowed) {
        // Assuming that the message should only show when not approved and wallet is connected
        setMessage('1. Enable USDT on Solana Network\n2. Check web3 wallet & authorise\n3. Return to Checkout');
      }
    };

    fetchData();
  }, [isLoggedIn, user, primaryWallet, solanaApprovalStatus, isAllowed]);

  // Function to split and render the message with line breaks
  const renderMessage = () => {
    return message.split('\n').map((line, index) => (
      <React.Fragment key={index}>
        {line}<br />
      </React.Fragment>
    ));
  };

  return isWalletConnected && message ? <p className={styles.message}>{renderMessage()}</p> : null;
};

export default SolanaWalletConnectionStatus;
