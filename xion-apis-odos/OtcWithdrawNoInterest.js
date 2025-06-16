const { Relayer } = require('@openzeppelin/defender-relay-client');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const ethers = require('ethers');

require('events').EventEmitter.defaultMaxListeners = 20;

const ABI = [
    "function withdrawFromAave(address from, address aTokenAddress, address asset, uint256 amount, uint256 feeAmount, address recipient) returns (uint256)"
];

const RPC_URL = process.env.RPC_URL;
const CONTRACT_ADDRESS = "0x776D1CFD21483Ef314a73900e98751AE9Ca7D10e";
const ASSET_TOKEN_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const ATOKEN_ADDRESS = "0x6ab707Aca953eDAeFBc4fD23bA73294241490620";
const RELAYER_API_KEY = process.env.RELAYER_API_KEY;
const RELAYER_API_SECRET = process.env.RELAYER_API_SECRET;
const OTC_WITHDRAW_TABLE = "otcWithdraw";

const provider = new ethers.JsonRpcProvider(RPC_URL);

const withdrawFromAave = async (from, amount, feeAmount, recipientAddress) => {
    console.log("Preparing to withdraw from Aave (No Interest) with parameters:", {
        from,
        amount,
        feeAmount,
        recipientAddress,
        aTokenAddress: ATOKEN_ADDRESS,
        assetTokenAddress: ASSET_TOKEN_ADDRESS,
        contractAddress: CONTRACT_ADDRESS,
    });

    const relayer = new Relayer({
        apiKey: RELAYER_API_KEY,
        apiSecret: RELAYER_API_SECRET,
    });

    const iface = new ethers.Interface(ABI);

    try {
        const callData = iface.encodeFunctionData("withdrawFromAave", [
            from,
            ATOKEN_ADDRESS,
            ASSET_TOKEN_ADDRESS,
            amount,
            feeAmount,
            recipientAddress,
        ]);

        const txDetails = {
            to: CONTRACT_ADDRESS,
            data: callData,
            gasLimit: "6000000",
        };

        console.log("Sending withdrawFromAave transaction with details:", txDetails);

        const tx = await relayer.sendTransaction(txDetails);
        console.log("Transaction sent:", tx.hash);

        const receipt = await provider.waitForTransaction(tx.hash);
        console.log("Transaction receipt:", receipt);

        const status = receipt.status === 1 ? "Success" : "Failed";

        return { status, txHash: tx.hash, amount: ethers.formatUnits(amount, 6), feeAmount: ethers.formatUnits(feeAmount, 6) };
    } catch (error) {
        console.error("Error during withdrawFromAave (No Interest):", error.message);
        throw error;
    }
};

const saveToDynamoDB = async (transactionData) => {
    console.log("Saving transaction data to DynamoDB:", transactionData);

    const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
    const params = {
        TableName: OTC_WITHDRAW_TABLE,
        Item: {
            transactionHash: { S: transactionData.txHash },
            status: { S: transactionData.status },
            amount: { N: transactionData.amount },
            feeAmount: { N: transactionData.feeAmount },
            recipient: { S: transactionData.recipient },
            from: { S: transactionData.from },
            timestamp: { S: new Date().toISOString() },
        },
    };

    try {
        console.log("DynamoDB PutItem params:", params);
        await dynamoDbClient.send(new PutItemCommand(params));
        console.log("Transaction data saved successfully to DynamoDB.");
    } catch (error) {
        console.error("Error saving transaction to DynamoDB:", error.message);
        throw error;
    }
};

exports.handler = async (event) => { 
    console.log("OtcWithdrawNoInterest handler started");

    let parsedBody;
    try {
        parsedBody = JSON.parse(event.body);
    } catch (error) {
        console.error("Invalid JSON payload:", error.message);
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "Invalid JSON payload" }),
        };
    }

    const { from, amount, recipient, feeAmount } = parsedBody;

    if (!from || !amount || !recipient || feeAmount === undefined) {
        console.error("Missing required parameters: from, amount, or recipient");
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "from, amount, and recipient are required" }),
        };
    }

    const parsedAmount = parseFloat(amount);
    const parsedFee = parseFloat(feeAmount);
    if (isNaN(parsedAmount) || isNaN(parsedFee)) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "Invalid amount or feeAmount provided" }),
        };
    }

    try {
        // For no-interest withdrawals, the fee amount is zero.
        const parsedWithdrawalAmount = ethers.parseUnits(parsedAmount.toFixed(6), 6);
        const parsedFeeAmount = ethers.parseUnits(parsedFee.toFixed(6), 6);

        console.log("Calling withdrawFromAave with:");
        console.log("from:", from);
        console.log("amount:", parsedWithdrawalAmount);
        console.log("feeAmount:", parsedFeeAmount);
        console.log("recipient:", recipient);

        const result = await withdrawFromAave(from, parsedWithdrawalAmount, parsedFeeAmount, recipient);

        // Optionally, save the transaction data to DynamoDB.
        const saveData = { ...result, from, recipient };
        await saveToDynamoDB(saveData);

        return {
            statusCode: 200,
            body: JSON.stringify({
                status: result.status,
                txHash: result.txHash,
                amount: result.amount,
                feeAmount: result.feeAmount,
                recipient,
                from,
            }),
        };
    } catch (error) {
        console.error("Error during OtcWithdrawNoInterest:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
