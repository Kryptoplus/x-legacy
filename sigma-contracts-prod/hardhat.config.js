require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("@nomicfoundation/hardhat-verify");
require("dotenv").config();

// Ensure environment variables are loaded
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || "";
const MUMBAI_RPC_URL = process.env.MUMBAI_RPC_URL || "https://rpc-mumbai.maticvigil.com";
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || "https://polygon-rpc.com";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.22",  // Update to match all contracts
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: "paris"
    },
  },
  defaultNetwork: "hardhat", // Keep hardhat as default for local testing
  networks: {
    hardhat: {
      // Configuration for the local Hardhat Network
    },
    mumbai: {
      url: MUMBAI_RPC_URL,
      accounts: PRIVATE_KEY !== "" ? [`0x${PRIVATE_KEY}`] : [],
      chainId: 80001,
    },
    polygon: {
      url: POLYGON_RPC_URL,
      accounts: PRIVATE_KEY !== "" ? [`0x${PRIVATE_KEY}`] : [],
      chainId: 137,
    },
    // Add other networks here (e.g., mainnet, other testnets)
    // sepolia: {
    //   url: process.env.SEPOLIA_RPC_URL || "",
    //   accounts: PRIVATE_KEY !== "" ? [`0x${PRIVATE_KEY}`] : [],
    //   chainId: 11155111,
    // },
  },
  etherscan: {
    // Use "polygonscan" or the specific explorer name if needed,
    // but often just the API key is sufficient for supported networks.
    apiKey: {
        polygon: POLYGONSCAN_API_KEY,
        polygonMumbai: POLYGONSCAN_API_KEY
        // Add API keys for other networks if needed
        // sepolia: process.env.ETHERSCAN_API_KEY || ""
    }
    // If you need custom chains (that hardhat-verify doesn't automatically support)
    // customChains: [
    //   {
    //     network: "polygonMumbai",
    //     chainId: 80001,
    //     urls: {
    //       apiURL: "https://api-testnet.polygonscan.com/api",
    //       browserURL: "https://mumbai.polygonscan.com/"
    //     }
    //   },
    //   {
    //     network: "polygon",
    //     chainId: 137,
    //     urls: {
    //       apiURL: "https://api.polygonscan.com/api",
    //       browserURL: "https://polygonscan.com/"
    //     }
    //   }
    // ]
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 40000, // Increase timeout for potentially longer tests involving deployments
  },
};
