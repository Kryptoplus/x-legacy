const { Relayer } = require("@openzeppelin/defender-relay-client");
const { ethers } = require("ethers");
const jwt = require("jsonwebtoken");

const USDT_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const VAULT_ADDRESS = "0xB3AE89D80CbA6D296104C30A8A71Ac1263d4fA5D";
const VAULT_SPENDER = VAULT_ADDRESS;
const POLYGON_RPC = process.env.RPC_URL;

const vaultAbi = [
  // Only the deposit and previewDeposit functions
  {
    "inputs": [
      { "internalType": "address", "name": "from", "type": "address" },
      { "internalType": "address[]", "name": "assets", "type": "address[]" },
      { "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" },
      { "internalType": "address", "name": "receiver", "type": "address" },
      { "internalType": "bool", "name": "depositToCasino", "type": "bool" }
    ],
    "name": "deposit",
    "outputs": [{ "internalType": "uint256", "name": "shares", "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address[]", "name": "assets", "type": "address[]" },
      { "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }
    ],
    "name": "previewDeposit",
    "outputs": [{ "internalType": "uint256", "name": "shares", "type": "uint256" }],
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
    const { from, receiver, amount, casino } = body;
    console.log("Parsed body:", body);
    if (!from || !receiver || !amount) {
      console.error("Missing params:", { from, receiver, amount });
      return { statusCode: 400, body: JSON.stringify({ error: "Missing params" }) };
    }

    // Setup provider/contracts
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const usdt = new ethers.Contract(USDT_ADDRESS, [
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)"
    ], provider);
    const vault = new ethers.Contract(VAULT_ADDRESS, vaultAbi, provider);

    // Check balance/allowance
    const usdtBalance = await usdt.balanceOf(from);
    const usdtAllowance = await usdt.allowance(from, VAULT_SPENDER);
    console.log(`USDT balance for ${from}:`, usdtBalance.toString());
    console.log(`USDT allowance for ${from} to ${VAULT_SPENDER}:`, usdtAllowance.toString());
    if (usdtBalance < BigInt(amount)) {
      console.error("Insufficient USDT balance");
      return { statusCode: 400, body: JSON.stringify({ error: "Insufficient USDT balance" }) };
    }
    if (usdtAllowance < BigInt(amount)) {
      console.error("Insufficient USDT allowance");
      return { statusCode: 400, body: JSON.stringify({ error: "Insufficient USDT allowance" }) };
    }

    // Preview CHIP to be received
    const assets = [USDT_ADDRESS];
    const amounts = [amount];
    const chipAmount = await vault.previewDeposit(assets, amounts);
    console.log("Previewed CHIP amount to be received:", chipAmount.toString());

    // Relayer setup
    const relayer = new Relayer({
      apiKey: process.env.RELAYER_API_KEY,
      apiSecret: process.env.RELAYER_API_SECRET
    });

    // Encode deposit call
    const iface = new ethers.Interface(vaultAbi);
    const data = iface.encodeFunctionData("deposit", [
      from, assets, amounts, receiver, !!casino
    ]);
    console.log("Encoded deposit data:", data);

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
    console.log("Deposit successful:", {
      txHash: tx.hash,
      usdtDeposited: ethers.formatUnits(amount, 6),
      chipReceived: ethers.formatUnits(chipAmount, 18),
      chipRaw: chipAmount.toString(),
      usdtRaw: amount.toString(),
      status: "success"
    });
    return {
      statusCode: 200,
      body: JSON.stringify({
        txHash: tx.hash,
        usdtDeposited: ethers.formatUnits(amount, 6),
        chipReceived: ethers.formatUnits(chipAmount, 18),
        chipRaw: chipAmount.toString(),
        usdtRaw: amount.toString(),
        status: "success"
      })
    };
  } catch (e) {
    console.error("Handler error:", e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
