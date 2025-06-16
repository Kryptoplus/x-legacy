const { Relayer } = require("@openzeppelin/defender-relay-client");
const { ethers } = require("ethers");
const jwt = require("jsonwebtoken");

const USDT_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const CHIP_ADDRESS = "0x3c379d78cE2fcD019FAE993f777E6be7A6e09a1C"; // <-- FILL THIS IN
const VAULT_ADDRESS = "0xB3AE89D80CbA6D296104C30A8A71Ac1263d4fA5D";
const CASINO_TREASURY_ADDRESS = "0xa6C3ED8723Bf84D13079604Eb04a8d8cbd8043Ec"; // <-- FILL THIS IN
const POLYGON_RPC = process.env.RPC_URL;

const vaultAbi = [
  {
    "inputs": [
      { "internalType": "address", "name": "from", "type": "address" },
      { "internalType": "uint256", "name": "shares", "type": "uint256" },
      { "internalType": "address", "name": "userRecipient", "type": "address" },
      { "internalType": "address", "name": "casinoTreasury_", "type": "address" },
      { "internalType": "address[]", "name": "assets", "type": "address[]" },
      { "internalType": "uint256[]", "name": "userAmounts", "type": "uint256[]" },
      { "internalType": "uint256[]", "name": "casinoAmounts", "type": "uint256[]" },
      { "internalType": "uint256[]", "name": "minAmounts", "type": "uint256[]" }
    ],
    "name": "withdraw",
    "outputs": [
      { "internalType": "uint256[]", "name": "userReceived", "type": "uint256[]" },
      { "internalType": "uint256[]", "name": "casinoReceived", "type": "uint256[]" }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

const treasuryAbi = [
  {
    "inputs": [
      { "internalType": "address", "name": "_user", "type": "address" },
      { "internalType": "address", "name": "_token", "type": "address" }
    ],
    "name": "getUserStats",
    "outputs": [
      { "internalType": "uint256", "name": "balance", "type": "uint256" },
      { "internalType": "uint256", "name": "deposited", "type": "uint256" },
      { "internalType": "uint256", "name": "withdrawn", "type": "uint256" },
      { "internalType": "uint256", "name": "winningsCredited", "type": "uint256" },
      { "internalType": "uint256", "name": "amountInPendingEscrow", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

exports.handler = async (event) => {
  try {
    // JWT Auth
    const jwtSecret = process.env.JWT_SECRET;
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const token = authHeader?.split(" ")[1];
    console.log("Received JWT:", token ? "[REDACTED]" : "None");
    if (!token) return { statusCode: 401, body: JSON.stringify({ error: "Missing JWT" }) };
    let decoded;
    try { 
      decoded = jwt.verify(token, jwtSecret); 
      console.log("JWT decoded:", decoded);
    }
    catch (e) { 
      console.error("JWT verification failed:", e.message);
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid JWT" }) }; 
    }

    // Parse body
    const body = event.body ? JSON.parse(event.body) : event;
    const { from, receiver, chipAmount, userAmounts, casinoAmounts } = body;
    console.log("Parsed body:", body);
    if (!from || !receiver || !chipAmount || !userAmounts || !casinoAmounts) {
      console.error("Missing params:", { from, receiver, chipAmount, userAmounts, casinoAmounts });
      return { statusCode: 400, body: JSON.stringify({ error: "Missing params" }) };
    }

    // Setup provider/contracts
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const vault = new ethers.Contract(VAULT_ADDRESS, vaultAbi, provider);
    const treasury = new ethers.Contract(CASINO_TREASURY_ADDRESS, treasuryAbi, provider);

    // Check CHIP balance in treasury
    const [chipBalance] = await treasury.getUserStats(from, CHIP_ADDRESS);
    console.log(`CHIP balance in treasury for ${from}:`, chipBalance.toString());
    if (chipBalance < chipAmount) {
      console.error("Insufficient CHIP balance in treasury");
      return { statusCode: 400, body: JSON.stringify({ error: "Insufficient CHIP balance in treasury" }) };
    }

    // Prepare withdraw call
    const shares = chipAmount;
    const userRecipient = receiver;
    const casinoTreasury_ = CASINO_TREASURY_ADDRESS;
    const assets = [USDT_ADDRESS];
    const minAmounts = [0]; // Accept any amount

    // Validate userAmounts and casinoAmounts
    if (!Array.isArray(userAmounts) || !Array.isArray(casinoAmounts) || userAmounts.length !== 1 || casinoAmounts.length !== 1) {
      console.error("userAmounts and casinoAmounts must be arrays of length 1");
      return { statusCode: 400, body: JSON.stringify({ error: "userAmounts and casinoAmounts must be arrays of length 1" }) };
    }

    console.log("Withdraw call params:", {
      from, shares, userRecipient, casinoTreasury_, assets, userAmounts, casinoAmounts, minAmounts
    });

    // Relayer setup
    const relayer = new Relayer({
      apiKey: process.env.RELAYER_API_KEY,
      apiSecret: process.env.RELAYER_API_SECRET
    });

    // Encode withdraw call
    const iface = new ethers.Interface(vaultAbi);
    const data = iface.encodeFunctionData("withdraw", [
      from, shares, userRecipient, casinoTreasury_, assets, userAmounts, casinoAmounts, minAmounts
    ]);
    console.log("Encoded withdraw data:", data);

    // Send tx
    const tx = await relayer.sendTransaction({
      to: VAULT_ADDRESS,
      data,
      gasLimit: 500_000 // adjust as needed
    });
    console.log("Sent transaction, hash:", tx.hash);

    // Wait for receipt
    const receipt = await provider.waitForTransaction(tx.hash, 2, 120_000);
    console.log("Transaction receipt:", receipt);
    if (!receipt || receipt.status !== 1) {
      console.error("Transaction failed:", receipt);
      return { statusCode: 500, body: JSON.stringify({ error: "Transaction failed", txHash: tx.hash }) };
    }

    // Return result
    console.log("Withdraw successful:", {
      txHash: tx.hash,
      chipWithdrawn: (chipAmount / 1e18).toString(),
      chipRaw: chipAmount.toString(),
      status: "success"
    });
    return {
      statusCode: 200,
      body: JSON.stringify({
        txHash: tx.hash,
        chipWithdrawn: (chipAmount / 1e18).toString(),
        chipRaw: chipAmount.toString(),
        status: "success"
      })
    };
  } catch (e) {
    console.error("Handler error:", e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
