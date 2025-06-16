const { Relayer } = require('@openzeppelin/defender-relay-client');
const ethers = require('ethers');

require('events').EventEmitter.defaultMaxListeners = 20;

const ABI = [
    "function withdrawFromAave(address from, address aTokenAddress, address asset, uint256 amount, uint256 feeAmount, address recipient) returns (uint256)"
];

const RPC_URL = process.env.RPC_URL; // Ethereum RPC URL
const CONTRACT_ADDRESS = "0x776D1CFD21483Ef314a73900e98751AE9Ca7D10e"; // Replace with smart contract address
const ASSET_TOKEN_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"; // Replace with asset token address
const ATOKEN_ADDRESS = "0x6ab707Aca953eDAeFBc4fD23bA73294241490620"; // Replace with aToken address
const FROM_ADDRESS = "0xF1B47552b22786624057eEdCF96B01910e3Fb749"; // Replace with sender address
const RECIPIENT_ADDRESS = "0xF1B47552b22786624057eEdCF96B01910e3Fb749"; // Replace with recipient address
const RELAYER_API_KEY = process.env.RELAYER_API_KEY; // Defender relayer API key
const RELAYER_API_SECRET = process.env.RELAYER_API_SECRET; // Defender relayer API secret

const provider = new ethers.JsonRpcProvider(RPC_URL);

const withdrawFromAave = async (amount, feeAmount) => {
    console.log("Preparing to withdraw from Aave with the following parameters:");
    console.log({ amount, feeAmount });

    const relayer = new Relayer({
        apiKey: RELAYER_API_KEY,
        apiSecret: RELAYER_API_SECRET,
    });

    const iface = new ethers.Interface(ABI);

    try {
        const callData = iface.encodeFunctionData("withdrawFromAave", [
            FROM_ADDRESS,
            ATOKEN_ADDRESS,
            ASSET_TOKEN_ADDRESS,
            amount,
            feeAmount,
            RECIPIENT_ADDRESS
        ]);

        const txDetails = {
            to: CONTRACT_ADDRESS,
            data: callData,
            gasLimit: "6000000",
        };

        console.log("Sending withdrawFromAave transaction with details:", txDetails);

        const tx = await relayer.sendTransaction(txDetails);
        console.log("Transaction sent:", tx.hash);

        // Wait for the transaction receipt
        const receipt = await provider.waitForTransaction(tx.hash);
        console.log("Transaction receipt:", receipt);

        // Check if the transaction was successful
        const status = receipt.status === 1 ? "Success" : "Failed";

        return { status, txHash: tx.hash, amount: ethers.formatUnits(amount, 6) };
    } catch (error) {
        console.error("Error during withdrawFromAave:", error.message);
        console.error("Stack trace:", error.stack);
        throw error;
    }
};

exports.handler = async (event) => {
    console.log("Handler started");

    let parsedBody;
    try {
        parsedBody = JSON.parse(event.body);
    } catch (error) {
        console.error("Invalid JSON payload:", error.message);
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid JSON payload' }),
        };
    }

    const { amount, feeAmount } = parsedBody;

    if (!amount || !feeAmount) {
        console.error("Missing required parameters: amount or feeAmount");
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'amount and feeAmount are required' }),
        };
    }

    const parsedAmount = ethers.parseUnits(amount.toString(), 6);
    const parsedFeeAmount = ethers.parseUnits(feeAmount.toString(), 6);

    console.log("Parsed request parameters:");
    console.log({ amount: ethers.formatUnits(parsedAmount, 6), feeAmount: ethers.formatUnits(parsedFeeAmount, 6) });

    try {
        const result = await withdrawFromAave(parsedAmount, parsedFeeAmount);

        return {
            statusCode: 200,
            body: JSON.stringify({
                status: result.status,
                txHash: result.txHash,
                amount: result.amount,
            }),
        };
    } catch (error) {
        console.error("Error during withdrawFromAave:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to withdraw from Aave' }),
        };
    }
};
