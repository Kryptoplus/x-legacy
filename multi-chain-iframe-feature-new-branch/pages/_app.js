import React, { useEffect, useState } from 'react';
import Head from "next/head";
import { ThirdwebProvider } from "thirdweb/react";
import "./global.css";
import { Analytics } from '@vercel/analytics/react';
import { ethereum, polygon, avalanche, bsc, base } from "thirdweb/chains";
import {
  DynamicContextProvider,
  useDynamicContext,
} from "@dynamic-labs/sdk-react-core";
import { SolanaWalletConnectors } from "@dynamic-labs/solana";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import NetworkTokenSelector from "./NetworkTokenSelector"; // Replace NetworkSwitch with NetworkTokenSelector
import networkTokenMapping from "../config/networkTokenMapping.js"; // Import the mapping file

// This is the chain your dApp will work on.
// Change this to the chain your app is built for.
// You can also import additional chains from `@thirdweb-dev/chains` and pass them directly.
// const activeChain = "polygon";
// const relayerUrl = `https://xion.engine-usw2.thirdweb.com/relayer/f76612c1-80d7-4270-a7f1-a27d6a294a45`;

function MyApp({ Component, pageProps }) {
  const [selectedNetwork, setSelectedNetwork] = useState("Polygon"); // Default network
  const [selectedToken, setSelectedToken] = useState("USDT"); // Default token

  // // Initialize state for network and token configurations
  // const [selectedNetworkConfig, setSelectedNetworkConfig] = useState(
  //   networkTokenMapping[selectedNetwork] || networkTokenMapping["Polygon"]
  // );
  // const [selectedTokenConfig, setSelectedTokenConfig] = useState(
  //   selectedNetworkConfig.tokens[selectedToken] || selectedNetworkConfig.tokens["USDT"]
  // );

  // useEffect(() => {
  //   // Update selected network and token configurations when selectedNetwork or selectedToken changes
  //   const newNetworkConfig = networkTokenMapping[selectedNetwork] || networkTokenMapping["Polygon"];
  //   setSelectedNetworkConfig(newNetworkConfig);

  //   const newTokenConfig = newNetworkConfig.tokens[selectedToken] || newNetworkConfig.tokens["USDT"];
  //   setSelectedTokenConfig(newTokenConfig);
  // }, [selectedNetwork, selectedToken]);

  useEffect(() => {
    const dbName = 'WALLET_CONNECT_V2_INDEXED_DB';

    const deleteDatabase = () => {
      const request = indexedDB.deleteDatabase(dbName);

      request.onsuccess = () => {
        // console.log(`${dbName} deleted successfully`);
      };

      request.onerror = (e) => {
        console.error(`Error deleting ${dbName}:`, e);
      };

      request.onblocked = () => {
        console.warn(`${dbName} delete blocked`);
      };
    };

    deleteDatabase();
  }, []);

  return (
    <ThirdwebProvider
    // autoConnect={false}
    // dAppMeta={{
    //   name: "Scan To Pay",
    //   description: "Scan to Pay for Crypto Payments",
    //   logoUrl: "https://play-lh.googleusercontent.com/83v2ndgXSuNdRBKV7s5TjD7pvrd-DvcT4c5UCliCKcUKGKoEFYEphSbQjLBTB1d3FDsn=w480-h960-rw",
    //   url: "https://scantopay.io",
    //   isDarkMode: true,
    // }}
    // activeChain={selectedNetworkConfig.chain} // Set dynamic activeChain based on selected network
    // supportedChains={[Polygon, Avalanche, Binance, Base]}  
    // sdkOptions={{
    //    gasless: {
    //      engine: {
    //       relayerUrl: selectedTokenConfig.relayerUrl, // Use dynamic relayerUrl
    //     }
    //    }
    // }}
clientId={process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID}
    >

<DynamicContextProvider
        settings={{
          // Find your environment id at https://app.dynamic.xyz/dashboard/developer
          environmentId: process.env.NEXT_PUBLIC_ENVIRONMENT_ID,
          walletConnectors: [SolanaWalletConnectors],
          mobileExperience: 'redirect'
        }}
      >
      <React.Fragment>
        <Head>
          <title>HyperSend</title>
          <link rel="icon" type="image/svg+xml" href="/D.svg" /> {/* Add this line */}
          <meta
            name="viewport"
            content="minimum-scale=1, initial-scale=1, width=device-width"
          />
        </Head>
        <Analytics /> 
        <AutoLogout />

        <Component {...pageProps} />
      </React.Fragment>
      </DynamicContextProvider>
     </ThirdwebProvider>
  );
}

function AutoLogout() {
  const { handleLogOut } = useDynamicContext();

  useEffect(() => {
    const logOutUser = async () => {
      try {
        await handleLogOut();
        // console.log("Dynamic wallet logged out successfully on page load.");
      } catch (error) {
        console.error("Error logging out dynmic wallet:", error);
      }
    };

    logOutUser();
  }, [handleLogOut]);

  return null;
}

export default MyApp;
