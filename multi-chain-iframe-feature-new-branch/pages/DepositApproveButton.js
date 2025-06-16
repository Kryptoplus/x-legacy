// pages/DepositApproveButton.js
import React, { useEffect, useState } from "react";
import {
  createThirdwebClient,
  getContract,
  prepareContractCall,
  sendTransaction,
} from "thirdweb";
import {
  useActiveAccount,
  useReadContract,
  useSwitchActiveWalletChain,
  useActiveWalletChain,
  useWaitForReceipt,
} from "thirdweb/react";
import { polygon } from "thirdweb/chains";
import { usdtAbi } from "../abis/usdtabi";
import Spinner from "./Spinner";
import styles from "./ApproveButton.module.css";

const client = createThirdwebClient({
  clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID,
});

const DEPOSIT_SPENDER_ADDRESS = "0xB3AE89D80CbA6D296104C30A8A71Ac1263d4fA5D";
const USDT_CONTRACT_ADDRESS = "0xc2132d05d31c914a87c6611c10748aeb04b58e8f";

const DepositApproveButton = ({ amount, onApprovalSuccess, disabled, refetchAllowance }) => {
  const account = useActiveAccount();
  const address = account?.address;
  const switchChain = useSwitchActiveWalletChain();
  const activeChain = useActiveWalletChain();
  const [transactionHash, setTransactionHash] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAllowed, setIsAllowed] = useState(false);
  const [allowance, setAllowance] = useState(null);

  const contract = getContract({
    client,
    chain: polygon,
    address: USDT_CONTRACT_ADDRESS,
    abi: usdtAbi,
  });

  const { data: receipt, isLoading: isWaitingForReceipt } = useWaitForReceipt({
    client,
    chain: polygon,
    transactionHash,
  });

  const callApproval = async () => {
    if (!address || !contract) return;
    
    if (!amount) {
      console.error("Amount is undefined or null");
      return;
    }

    setIsLoading(true);
    try {
      if (activeChain?.id !== polygon.id) {
        await switchChain(polygon.id);
      }

      // Clean the amount string and convert to BigInt
      const cleanAmount = amount.toString().replace(/[^0-9]/g, '');
      console.log("Cleaned approval amount:", cleanAmount);

      const approvalAmount = BigInt(cleanAmount);
      
      const transaction = prepareContractCall({
        contract,
        method: "approve",
        params: [DEPOSIT_SPENDER_ADDRESS, approvalAmount],
      });
      const { transactionHash: txHash } = await sendTransaction({
        account,
        transaction,
      });
      setTransactionHash(txHash);
    } catch (err) {
      console.error("Approval error:", err);
      console.error("Amount that caused error:", amount);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (receipt && onApprovalSuccess) {
      onApprovalSuccess();
      if (refetchAllowance) refetchAllowance();
    }
  }, [receipt, onApprovalSuccess, refetchAllowance]);

  if (isAllowed) return null; // Only render if approval is needed

  return (
    <button
      className={styles.connectedButton}
      onClick={callApproval}
      disabled={isLoading || disabled}
    >
      {isLoading || isWaitingForReceipt ? (
        <>
          <Spinner />
          Processing...
        </>
      ) : (
        "Approve USDT for Deposit"
      )}
    </button>
  );
};

export default DepositApproveButton;