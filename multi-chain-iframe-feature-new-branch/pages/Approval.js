import React, { useEffect, useState } from "react";
// import {
//   useContract,
//   useContractWrite,
//   useContractRead,
//   useAddress,
//   useChainId,
// } from "@thirdweb-dev/react";
import {
  useSendTransaction,
  useReadContract,
  useActiveAccount,
  useActiveWalletChain,
} from "thirdweb/react";
import { createThirdwebClient, getContract,  prepareContractCall, sendTransaction } from "thirdweb";
import { useRouter } from "next/router";
import { ethereum, polygon, avalanche, base, bsc } from "thirdweb/chains";
import Spinner from "./Spinner";
import { usdtAbi } from "../abis/usdtabi";
// import { chainId } from "viem/_types/utils/chain/extractChain";

const client = createThirdwebClient({
  clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID,
});


const Approval = ({ setApprovalStatus, setApproveButtonVisibility, contractAddress, spender, selectedNetwork }) => {
  const router = useRouter();
  const [redirectUrl, setRedirectUrl] = useState(null);
  const [isApproved, setIsApproved] = useState(false);
  // const address = useAddress();
  // const currentChainId = useChainId();
  const account = useActiveAccount();
  const address = account?.address;   
  const activeChain = useActiveWalletChain();
  const currentChainId = activeChain?.id;    
  // const { contract } = useContract(contractAddress, usdtAbi);
  const contract = getContract({
    client,
    chain: polygon,
    address: contractAddress,
    abi: usdtAbi,
  });   
  // const { isLoading: isApproving } = useContractWrite(contract, "approve");

  const { data: allowance, isLoading: isChecking } = useReadContract({
    contract,
    method: "allowance",
    params: [address, spender],
  });  

  // const { data: allowance, isLoading: isChecking } = useContractRead(
  //   contract,
  //   "allowance",
  //   [address, spender]
  // );

  useEffect(() => {
    if (router.isReady && !redirectUrl) {
      const queryRedirectUrl = router.query["redirect-url"];
      if (queryRedirectUrl && typeof queryRedirectUrl === 'string') {
        setRedirectUrl(queryRedirectUrl.startsWith('http') ? queryRedirectUrl : `https://${queryRedirectUrl}`);
      }
    }
  }, [router.isReady, router.query]);

  useEffect(() => {
    const callApproval = async () => {
      if (!address || isChecking || isApproved || !currentChainId) {
        return;
      }
      if (parseInt(allowance) >= parseInt("10000000000000000000000000000000")) {
        setIsApproved(true);
        setApprovalStatus({ isApproved: true, isError: false });

        const messageType = `${selectedNetwork.toLowerCase()}WalletAddressFromXion`;

         // Add wallet address event for polygonWalletAddressFromXion
         if (address) {
          // console.log(`${selectedNetwork} wallet address retrieved:`, address);

          // Post message to the parent window or opener
          if (window.opener) {
            window.opener.postMessage({ type: messageType, walletAddress: address }, "*");
          }

          if (window.parent && window !== window.parent) {
            window.parent.postMessage({ type: messageType, walletAddress: address }, "*");
          }

          // Optional: Close the window if it's a popup
          if (window.opener) {
            window.close();
          }
        }
        // Redirect with a delay
        if (redirectUrl && address) {
          setTimeout(() => {
            window.location.href = `${redirectUrl}/${address}`;
          }, 1000); // 3-second delay before redirect
        }

        // // Code to redirect
        // setTimeout(() => {
        //   router.push(`${redirectUrl}/${address}`);
        // }, 1000);

        // Code to Close Iframe
        // setTimeout(() => {
        //   window.parent.postMessage({ walletAddress: address }, "*");
        // }, 2000);
        // // Send the approved address to the parent window
        // window.opener.postMessage({ walletAddress: address }, "*");
        // window.close();
      } else {
        // console.log("Allowance is not sufficient, showing the approve button");
        setApproveButtonVisibility(true);
      }
    };

    callApproval();
  }, [address, isChecking, allowance, isApproved, currentChainId, redirectUrl, setApprovalStatus, setApproveButtonVisibility]);

  // Only show spinner if wallet is connected and operation is pending
  // if ((isChecking) && address) {
  //   return <Spinner />;
  // }

  return null;
};

export default Approval;
