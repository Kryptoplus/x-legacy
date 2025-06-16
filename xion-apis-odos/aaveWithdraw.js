const { Relayer } = require("@openzeppelin/defender-relay-client");
const { ethers } = require("ethers");

// Define the ABI for the Aave Pool contract
const poolAbi = [
  "function withdraw(address asset, uint256 amount, address to) external returns (uint256)"
];

// Environment variables
const RELAYER_API_KEY = process.env.OTC_RELAYER_API_KEY;
const RELAYER_API_SECRET = process.env.OTC_RELAYER_API_SECRET;
const AAVE_POOL_ADDRESS = process.env.AAVE_POOL_ADDRESS; // Aave Pool contract address
const RPC_URL = process.env.POLYGON_RPC_URL; // RPC URL for the network
const ASSET_ADDRESS = process.env.APOL_ADDRESS; // Asset to withdraw (e.g., USDC or DAI)

exports.handler = async (event) => {
  try {
    // Parse input parameters
    const { amount, to } = JSON.parse(event.body);
    if (!amount || !to) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required parameters: amount or to" }),
      };
    }

    // Initialize provider and contract instance
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const poolContract = new ethers.Contract(AAVE_POOL_ADDRESS, poolAbi, provider);

    // Setup the Relayer
    const relayer = new Relayer({
      apiKey: RELAYER_API_KEY,
      apiSecret: RELAYER_API_SECRET,
    });

    // Encode the transaction
    const encodedData = poolContract.interface.encodeFunctionData("withdraw", [
      ASSET_ADDRESS,
      ethers.parseUnits(amount.toString(), 6), // Ensure amount is formatted correctly (USDT uses 6 decimals)
      to,
    ]);

    // Create transaction details
    const txDetails = {
      to: AAVE_POOL_ADDRESS,
      data: encodedData,
      gasLimit: 2000000, // Adjust based on Aave's requirements
    };

    // Send the transaction
    const txResponse = await relayer.sendTransaction(txDetails);

    console.log("Transaction sent:", txResponse);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Withdraw transaction submitted to Aave Pool",
        transactionHash: txResponse.hash,
      }),
    };
  } catch (error) {
    console.error("Error executing transaction:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
