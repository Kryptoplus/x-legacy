import React, { useEffect, useState } from 'react';
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { Connection, PublicKey } from "@solana/web3.js";
import ApproveButtonSolana from "./SolanaApproveButton";
import styles from './validate.module.css';

export const ValidateSolanaBalance = ({
  solanaHasSufficientUSDT,
  setSolanaHasSufficientUSDT,
  isAccountFlagged,
  solanaApprovalStatus,
  setSolanaApprovalStatus,
  showSolanaApproveButton,
  setShowSolanaApproveButton
  
}) => {
  const { primaryWallet } = useDynamicContext();
  const [address, setAddress] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAllowed, setIsAllowed] = useState(false);


  const usdtTokenAddress = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"); // USDT token address on Solana
  const connection = new Connection("https://fluent-cosmopolitan-patron.solana-mainnet.quiknode.pro/18ab6c68fc21ecc31d10afbde4fb13be00f9be04/");


  useEffect(() => {
    const getConnectedAccounts = async () => {
      const connectedAccounts = await primaryWallet?.connector.getConnectedAccounts();
      return connectedAccounts && connectedAccounts.length > 0 ? connectedAccounts[0] : undefined;
    };

    const fetchAddress = async () => {
      const addr = await getConnectedAccounts();
      setAddress(addr);
      // console.log("Connected Accounts:", addr);
    };

    if (primaryWallet) {
      fetchAddress();
    }
  }, [primaryWallet]);

  const handleBuyUSDTClick = () => {
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  const renderInsufficientFundsMessage = () => {
    return (
      <div className={styles.messageContainer}>
        <p className={styles.message}>Insufficient USDT balance</p>
        <div className={styles.centerButton}>
          <button onClick={handleBuyUSDTClick} className={styles.buyUSDT}>BUY USDT</button>
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (!address) return;

    const fetchUSDTBalance = async () => {
      try {
        const publicKey = new PublicKey(address);
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: usdtTokenAddress });
        const usdtAccount = tokenAccounts.value.find(account => account.account.data.parsed.info.mint === usdtTokenAddress.toString());
        
        if (usdtAccount) {
          const balance = usdtAccount.account.data.parsed.info.tokenAmount.uiAmount;
          const isSufficient = balance >= 0.01;
          // console.log("USDT sol Balance:", balance);
          // console.log("Is USDT sol balance sufficient?", isSufficient);
          setSolanaHasSufficientUSDT(isSufficient);
        } else {
          // console.log("USDT balance not found.");
          setSolanaHasSufficientUSDT(false);
        }
      } catch (error) {
        console.error("Failed to fetch USDT balance:", error);
        setSolanaHasSufficientUSDT(false);
      }
    };

    fetchUSDTBalance();
  }, [address, setSolanaHasSufficientUSDT]);

  if (!address) return null;

  if (!solanaHasSufficientUSDT) {
    return (
      <>
        {renderInsufficientFundsMessage()}
        {isModalOpen && (
          <div className={styles.modal}>
            <div className={styles.modalContent}>
              <span className={styles.closeButton} onClick={handleCloseModal}>&times;</span>
              <iframe
                className="ramp-widget"
                allow="usb; polygon; clipboard-write"
                src={`https://widget.mtpelerin.com/?lang=en&_ctkn=2c97f059-e245-4c67-8698-34f3172bfb7f&type=popup&tabs=buy&addr=${address}&nets=solana&bdc=USDT&crys=USDT&ctry=ZA`}
                width="100%"
                height="400px"
              ></iframe>
            </div>
          </div>
        )}
      </>
    );
  } else {
    return (
      <ApproveButtonSolana
        isAccountFlagged={isAccountFlagged}
        setSolanaApprovalStatus={setSolanaApprovalStatus}
        showApproveButton={showSolanaApproveButton}
        setShowApproveButton={setShowSolanaApproveButton}
        solanaApprovalStatus={solanaApprovalStatus}
      />
    );
  }
};

export default ValidateSolanaBalance;
