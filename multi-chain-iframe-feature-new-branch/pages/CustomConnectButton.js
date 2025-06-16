"use client";

import React from "react";
import { ConnectButton, useActiveAccount } from "thirdweb/react";
import { inAppWallet } from "thirdweb/wallets";
import { createThirdwebClient } from "thirdweb";
import { darkTheme } from "thirdweb/react";
import networkTokenMapping from "../config/networkTokenMapping.js";
import styles from "./CustomConnectButton.module.css";

const client = createThirdwebClient({
  clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID,
});

const personalWallet = inAppWallet({
  auth: {
    options: ["email", "phone"],
  },
  recommended: false,
  onAuthSuccess: (authResult) => {
    const email = authResult.storedToken?.authDetails?.email;
    const phoneNumber = authResult.storedToken?.authDetails?.phoneNumber;
    localStorage.setItem('authDetails', JSON.stringify({ phoneNumber, email }));
  },
  hidePrivateKeyExport: true,
});

const appMetadata = {
  name: "HyperSend",
  url: "https://hypersend.com",
  description: "Place your usdt bets",
  logoUrl: "",
};

const CustomConnectButton = ({ buttonImage, selectedNetwork }) => {
  const account = useActiveAccount();
  const selectedNetworkConfig = networkTokenMapping[selectedNetwork] || networkTokenMapping["Polygon"];
  const chainObject = selectedNetworkConfig.chain;

  // If already connected, don't show the button
  if (account?.address) {
    return null;
  }

  return (
    <div>
      <ConnectButton
        appMetadata={appMetadata}
        client={client}
        hidePrivateKeyOption={true}
        autoConnect={false}
        wallets={[personalWallet]}
        showAllWallets={false}
        accountAbstraction={{
          chain: chainObject,
          sponsorGas: true, // <--- THIS ENABLES GAS SPONSORSHIP
        }}
        connectButton={{
          label: (
            <>
              <span>Login or sign up</span>
            </>
          ),
          className: styles.connectWalletButton,
        }}
        detailsButton={{
          className: styles.connectedButton,
        }}
        
        theme={darkTheme({
          colors: {
            accentText: "hsl(117, 100%, 60%)",
            borderColor: "hsl(162, 12%, 17%)",
            separatorLine: "hsl(229, 13%, 17%)",
            modalBg: "hsl(228, 12%, 8%)",
            skeletonBg: "hsl(233, 12%, 15%)",
            primaryText: "hsl(240, 6%, 94%)",
          },
        })}
        detailsModal={{
          hideSendFunds: true,
          hideBuyFunds: true,
          showTestnetFaucet: false,
        }}
        chain={chainObject}
        style={{ padding: "10px" }}
        className={styles.connectWalletButton}
        connectModal={{
          size: "compact",
          showThirdwebBranding: false,
          privacyPolicyUrl: "https://terms.hypersend.com",
        }}
      >
        <button className={styles.connectWalletButton}>
          <img src={buttonImage} alt="CustomConnectButton" />
          <span>Login or sign up</span>
        </button>
      </ConnectButton>
    </div>
  );
};

export default CustomConnectButton;