import React, { useEffect, useState } from "react";
// Add this import with your other imports
import WalletQRCode from "./WalletQRCode";
// import {
//   ThirdwebProvider,
//   useAddress,
//   metamaskWallet,
//   walletConnect,
//   useDisconnect,
//   embeddedWallet
// } from "@thirdweb-dev/react";
import {
  ThirdwebProvider,
  useActiveAccount
} from "thirdweb/react";
import CustomConnectButton from "./CustomConnectButton";
import styles from "./index.module.css";
import WalletConnectionStatus from "./WalletConnectionStatus";
import Approval from "./Approval";
// import ZKMeAPI from './ZKMEAPI';  // Importing the ZKMeAPI component
import CheckUSDTBalance from "./CheckUSDTBalance"; // Import the USDT Balance checking component
import { ValidateBalance } from "./ValidateBalance";
import PdfViewer from "./Pdfviewer";
import { ethereum, polygon, avalanche, base, bsc } from "thirdweb/chains";
import {
  DynamicContextProvider,
  DynamicEmbeddedWidget,
  DynamicWidget,
  DynamicUserProfile,
  DynamicNav
} from "@dynamic-labs/sdk-react-core";
import NetworkSwitch from "./NetworkSwitch"; // Import the NetworkSwitch component
import SolanaWalletConnectionStatus from "./SolanaWalletConnectionStatus"; // Import the new Solana component
import CheckUSDTBalanceDynamic from "./CheckUSDTBalanceDynamic"; // Import the new USDT Balance checking component
import SolanaApproval from "./SolanaApproval";
import { ValidateSolanaBalance } from "./ValidateSolanaBalance";
import ScratchCard from "./ScratchCard";
import NetworkTokenSelector from "./NetworkTokenSelector"; // Replace NetworkSwitch with NetworkTokenSelector
import networkTokenMapping from "../config/networkTokenMapping.js"; // Import the mapping file
import DepositFlow from "./DepositFlow"; // Add this import


const FullXF = () => {
  const [isAccountFlagged, setIsAccountFlagged] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState({
    isApproved: false,
    isError: false,
  });
  const [solanaApprovalStatus, setSolanaApprovalStatus] = useState({
    solanaIsApproved: false,
    isError: false,
  });
  const [showApproveButton, setShowApproveButton] = useState(false);
  const [showSolanaApproveButton, setShowSolanaApproveButton] = useState(false);
  const [initialApprovalDone, setInitialApprovalDone] = useState(false);
  const [depositSuccessful, setDepositSuccessful] = useState(false);

  // const address = useAddress();
  const account = useActiveAccount();
  const address = account?.address;  
  const [hasSufficientUSDT, setHasSufficientUSDT] = useState(null);
  const [solanaHasSufficientUSDT, setSolanaHasSufficientUSDT] = useState(null);
  // const activeChain = "polygon";
  // const relayerUrl = `https://xion.engine-usw2.thirdweb.com/relayer/f76612c1-80d7-4270-a7f1-a27d6a294a45`;
  // const connectionStatus = useDisconnect();
  const [isOpen, setIsOpen] = useState(false);
  const handleClose = () => setIsOpen(false);
  const [selectedNetwork, setSelectedNetwork] = useState("Polygon");
  const [isAllowed, setIsAllowed] = useState(false); // Define isAllowed state here
  const [selectedToken, setSelectedToken] = useState(null);
  // Retrieve network and token configuration based on selection
  const selectedNetworkConfig = networkTokenMapping[selectedNetwork] || networkTokenMapping["Polygon"];
  const selectedTokenConfig =
  selectedNetworkConfig.tokens[selectedToken] ||
  Object.values(selectedNetworkConfig.tokens)[0]; // Default to the first token

  useEffect(() => {
    // Reset approval status and initial approval when network or token changes
    // to ensure fresh approval check for the new context.
    setApprovalStatus({ isApproved: false, isError: false });
    setInitialApprovalDone(false);
    // Also, it might be good to reset hasSufficientUSDT, 
    // as the balance check is also network/token specific.
    setHasSufficientUSDT(null); 
    // If you have a similar state for Solana, reset it too.
    // setSolanaHasSufficientUSDT(null); 
  }, [selectedNetwork, selectedToken]);

  // useEffect(() => {
  //   if (address) {
  //     // console.log("Wallet connect with address: ", address);
  //   } else {
  //     // console.log("Wallet not connected");
  //   }
  // }, [address]); // This useEffect will run whenever the `address` changes

  // useEffect(() => {
  //   console.log("Selected Network:", selectedNetwork);
  //   console.log("Selected Token:", selectedToken);
  //   console.log("Selected Network Config:", selectedNetworkConfig);
  //   console.log("Selected Token Config:", selectedTokenConfig);
  // }, [selectedNetwork, selectedToken, selectedNetworkConfig, selectedTokenConfig]);
  

  useEffect(() => {
    // This effect checks the approvalStatus which is set by ValidateBalance (via ApproveButton)
    // This is for the *initial* general approval.
    if (approvalStatus.isApproved && !initialApprovalDone) {
      setInitialApprovalDone(true);
    }
  }, [approvalStatus, initialApprovalDone]);
  
 

 

  return (
    <ThirdwebProvider
      // dAppMeta={{
      //   name: "Scan To Pay",
      //   description: "Scan to Pay for Crypto Payments",
      //   logoUrl:
      //     "https://play-lh.googleusercontent.com/83v2ndgXSuNdRBKV7s5TjD7pvrd-DvcT4c5UCliCKcUKGKoEFYEphSbQjLBTB1d3FDsn=w480-h960-rw",
      //   url: "https://scantopay.io",
      //   isDarkMode: true,
      // }}
      // autoConnect={false}
      // activeChain={selectedNetworkConfig.chain} // Set dynamic activeChain based on selected network
      // supportedChains={[Polygon, Avalanche, Binance, Base]}
      clientId={process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID}
      // supportedWallets={[
      //   metamaskWallet(),
      //   walletConnect(),
      //   embeddedWallet({
      //     auth: {
      //       options: ["email", "phone"],
      //     },
      //     recommended: false,
      //     onAuthSuccess: (authResult) => {
      //       console.log('Authentication successful:', authResult);
      //     },
      //   }),
      // ]}
      // sdkOptions={{
      //   gasless: {
      //     engine: {
      //       relayerUrl: selectedTokenConfig.relayerUrl, // Use dynamic relayerUrl
      //     },
      //   },
      // }}
    >
      
      {/* Include CheckUSDTBalance Component */}
      {/* <CheckUSDTBalance
          address={address}
          setHasSufficientUSDT={setHasSufficientUSDT}
        /> */}
      {selectedNetwork !== "Solana" && (
  <CheckUSDTBalance
    address={address}
    setHasSufficientUSDT={setHasSufficientUSDT}
    contractAddress={selectedTokenConfig.useContract} // Pass dynamic contract address
    selectedNetwork={selectedNetwork}
  />
)}

      {selectedNetwork === "Solana" && (
        <CheckUSDTBalanceDynamic setHasSufficientUSDT={setHasSufficientUSDT} />
      )}
      {/* Pass `setIsAccountFlagged` and `hasSufficientUSDT` to `CrystalAPI`
      <ZKMeAPI
        address={address}
        setIsAccountFlagged={setIsAccountFlagged}
        hasSufficientUSDT={hasSufficientUSDT}
      /> */}

      <div className={styles.fullXf}>
        <div className={styles.header}>
          <img
            className={styles.headerimage}
            alt=""
            src="/CallPay-Logo.svg"
          />
        </div>
        {/* <NetworkSwitch setNetwork={setSelectedNetwork} /> */}
       

{selectedNetwork !== "Solana" && !approvalStatus.isApproved && !initialApprovalDone && (
    <h3 className={styles.headersteps}>
       
    </h3>
)}
        {selectedNetwork === "Solana" && !solanaApprovalStatus.solanaIsApproved && (
          <h3 className={styles.headersteps}>
            Follow the Steps to Enable <img src="./T+S.svg" alt="USDT" className={styles.svgIcon} /> Payments
          </h3>
        )}
        <div className={styles.connectedContainer}>
        {selectedNetwork !== "Solana" && (
    <WalletConnectionStatus
      approvalStatus={approvalStatus}
      contractAddress={selectedTokenConfig.useContract}
      selectedNetwork={selectedNetwork} // Pass the selected network
      selectedToken={selectedToken} // Pass the selected token
    />
  )}
          {selectedNetwork === "Solana" && <SolanaWalletConnectionStatus solanaApprovalStatus={solanaApprovalStatus} isAllowed={isAllowed} />} </div>
        <div className={styles.connectedContainer}>
        {selectedNetwork !== "Solana" && (
    <CustomConnectButton buttonImage="./media/image.png"   selectedNetwork={selectedNetwork}
    />
  )}          {selectedNetwork === "Solana" && <DynamicWidget variant="modal" />}
          {/* <div><ScratchCard/></div> */}



          {selectedNetwork !== "Solana" && !depositSuccessful && (
            <DepositFlow
              selectedNetwork={selectedNetwork}
              setSelectedNetwork={setSelectedNetwork}
              selectedToken={selectedToken}
              setSelectedToken={setSelectedToken}
              selectedTokenConfig={selectedTokenConfig}
              selectedNetworkConfig={selectedNetworkConfig}
              isAccountFlagged={isAccountFlagged}
              approvalStatus={approvalStatus}
              setApprovalStatus={setApprovalStatus}
              showApproveButton={showApproveButton}
              setShowApproveButton={setShowApproveButton}
            />
          )}
          {selectedNetwork === "Solana" && (
            <ValidateSolanaBalance
              solanaHasSufficientUSDT={solanaHasSufficientUSDT}
              setSolanaHasSufficientUSDT={setSolanaHasSufficientUSDT}
              isAccountFlagged={isAccountFlagged}
              solanaApprovalStatus={solanaApprovalStatus}
              setSolanaApprovalStatus={setSolanaApprovalStatus}
              showSolanaApproveButton={showSolanaApproveButton}
              setShowSolanaApproveButton={setShowSolanaApproveButton}
            />
          )}
        </div>
      </div>



      {isOpen && (
        <div className={styles.pdfViewer}>
          <div className={styles.closeButton} onClick={() => setIsOpen(false)}>X</div>
          <PdfViewer onClose={() => setIsOpen(false)} />
        </div>
      )}


     

      <Approval
        setApprovalStatus={setApprovalStatus}
        setApproveButtonVisibility={setShowApproveButton}
        approvalInitiated={!approvalStatus}
        contractAddress={selectedTokenConfig.useContract} // Pass dynamic contract address
        spender={selectedTokenConfig.spender} // Pass dynamic spender
        selectedTokenConfig={selectedTokenConfig} // Pass selectedTokenConfig to ApproveButton
        selectedNetwork={selectedNetwork} // Pass selectedNetwork to Approval
      />

      {selectedNetwork === "Solana" && (
        <SolanaApproval
          setSolanaApprovalStatus={setSolanaApprovalStatus}
          setSolanaApproveButtonVisibility={setShowSolanaApproveButton}
          solanaApprovalStatus={solanaApprovalStatus}
        />
      )}


    </ThirdwebProvider>
  );
};

export default FullXF;