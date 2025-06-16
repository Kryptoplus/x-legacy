// pages/CheckUSDTBalance.js
import { useEffect, useState } from 'react';
import { useActiveAccount, useWalletBalance, useReadContract, useActiveWalletChain } from "thirdweb/react";
import { createThirdwebClient, getContract } from "thirdweb";
import { usdtAbi } from '../abis/usdtabi';
import networkTokenMapping from "../config/networkTokenMapping.js";
import { ethereum, polygon, avalanche, base, bsc } from "thirdweb/chains";

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
  if (!network) return null;
  switch (network.toLowerCase()) {
    case "binance":
      return "bsc";
    default:
      return network.toLowerCase();
  }
};

const CheckUSDTBalance = ({ address, setHasSufficientUSDT, setUsdtBalance, contractAddress, selectedNetwork }) => {
  const activeAccount = useActiveAccount();
  const currentAddress = activeAccount?.address;
  const activeChain = useActiveWalletChain();
  const chainId = activeChain?.id;
  const selectedChain = chainMapping[normalizeNetwork(selectedNetwork)];
  const tokenConfig = networkTokenMapping[selectedNetwork]?.tokens?.USDT;
  const decimals = tokenConfig?.decimals || 6;

  const contract = getContract({
    client,
    chain: selectedChain,
    address: contractAddress,
    abi: usdtAbi,
  });

  const { data, isLoading, error } = useReadContract({
    contract,
    method: "balanceOf",
    params: [currentAddress],
    queryOptions: { enabled: !!currentAddress && !!contract },
  });

  useEffect(() => {
    if (!currentAddress || !data) return;

    try {
      const balance = Number(data) / Math.pow(10, decimals);
      if (setUsdtBalance) setUsdtBalance(balance);
      const isSufficient = balance >= 0.00001;
      setHasSufficientUSDT(isSufficient);
    } catch (err) {
      console.error("Error processing balance:", err);
      setHasSufficientUSDT(false);
    }
  }, [data, decimals, setHasSufficientUSDT, setUsdtBalance, currentAddress]);

  if (error) {
    console.error("Error fetching USDT balance:", error);
  }

  return null;
};

export default CheckUSDTBalance;