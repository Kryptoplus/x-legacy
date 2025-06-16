import React, { useEffect, useState } from 'react';
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { Connection, PublicKey } from "@solana/web3.js";

const CheckUSDTBalanceDynamic = ({ setHasSufficientUSDT }) => {
  const { primaryWallet } = useDynamicContext();
  const [address, setAddress] = useState(null);

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
  }, [primaryWallet]); // This effect runs once when `primaryWallet` is available

  useEffect(() => {
    const fetchUSDTBalance = async () => {
      if (!address) {
        // console.log("Phantom not connected. Skipping balance check.");
        return;
      }

      try {
        const publicKey = new PublicKey(address);
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: usdtTokenAddress });
        const usdtAccount = tokenAccounts.value.find(account => account.account.data.parsed.info.mint === usdtTokenAddress.toString());
        
        if (usdtAccount) {
          const balance = usdtAccount.account.data.parsed.info.tokenAmount.uiAmount;
          const isSufficient = balance >= 0.01;
          // console.log("USDT sol Balance:", balance);
          // console.log("Is USDT sol balance sufficient?", isSufficient);
          setHasSufficientUSDT(isSufficient);
        } else {
          // console.log("USDT balance not found.");
          setHasSufficientUSDT(false);
        }
      } catch (error) {
        console.error("Failed to fetch USDT balance:", error);
        setHasSufficientUSDT(false);
      }
    };

    if (address) {
      fetchUSDTBalance();
    }
  }, [address, setHasSufficientUSDT]); // This effect runs once when `address` is available

  return null;  // This component does not render anything
};

export default CheckUSDTBalanceDynamic;
