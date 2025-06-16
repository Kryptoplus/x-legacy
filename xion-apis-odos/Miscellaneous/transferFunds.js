const { Relayer } = require('@openzeppelin/defender-relay-client');
const ethers = require('ethers');

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event));

    const { amount, fromAddress, contract } = JSON.parse(event.body);
    if (!amount || !fromAddress || !contract) {
        console.error("Missing required parameters");
        return { statusCode: 400, body: "Missing required parameters" };
    }

    // Define the ABI of the function to be called
    const abi = [
        {
            "inputs": [
                {
                    "internalType": "address",
                    "name": "from",
                    "type": "address"
                },
                {
                    "internalType": "uint256",
                    "name": "amount",
                    "type": "uint256"
                }
            ],
            "name": "transferFunds",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function"
        }
    ];

    // Setting up the ethers interface
    const iface = new ethers.Interface(abi);
    // Notice the correct parameter order as per ABI
    const callData = iface.encodeFunctionData("transferFunds", [fromAddress, amount]);

    // Prepare the pre-hook object
    const preHooks = [{
        callType: 0,
        target: contract,
        value: "0",
        callData: callData,
        estimatedGas: "300000"
    }];

    console.log("Prepared pre-hook:", JSON.stringify(preHooks));

    const credentials = { apiKey: process.env.RELAYER_API_KEY, apiSecret: process.env.RELAYER_API_SECRET };
    const relayer = new Relayer(credentials);

    try {
        // Now sending the transaction with preHook
        const txDetails = {
            to: contract,
            data: callData,
            value: "0",
            gasLimit: "300000",
            speed: "fastest",
            preHooks: preHooks
        };

        console.log("Sending transaction with pre-hook:", txDetails);
        const tx = await relayer.sendTransaction(txDetails);
        console.log("Transaction successful with hash:", tx.hash);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Transaction executed successfully with pre-hook",
                transactionHash: tx.hash
            })
        };
    } catch ( error) {
        console.error("Transaction error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
