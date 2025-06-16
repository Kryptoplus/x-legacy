const { Relayer } = require('@openzeppelin/defender-relay-client');
const { ethers } = require('ethers');

// Contract address for the CallerContract
const contractAddress = '0x64474968042Fed33CC768DB6E07aac3142C5784a';  // Replace with your actual contract address

exports.handler = async (event) => {
    const req = JSON.parse(event.body);
    console.log("Received event:", JSON.stringify(req));

    const { calleeContractAddress, data } = req;

    if (!calleeContractAddress || !data ) {
        console.error("Missing required parameters");
        return {
            statusCode: 400,
            body: JSON.stringify({ message: "Missing required parameters" })
        };
    }

    // Define the ABI of the callWithCalldata function
    const abi = [
        {
            "inputs": [
                {
                    "internalType": "address",
                    "name": "calleeContractAddress",
                    "type": "address"
                },
                {
                    "internalType": "bytes",
                    "name": "data",
                    "type": "bytes"
                }
            ],
            "name": "callWithCalldata",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function"
        },
    ];

    // Setting up the ethers interface
    const iface = new ethers.Interface(abi);
    const encodedCallData = iface.encodeFunctionData("callWithCalldata", [calleeContractAddress, data]);

    console.log("Encoded call data:", encodedCallData);

        // Decode the encoded call data and log it
        const decodedData = iface.decodeFunctionData("callWithCalldata", encodedCallData);
        console.log("Decoded call data:", decodedData);

    const credentials = { apiKey: process.env.RELAYER_API_KEY, apiSecret: process.env.RELAYER_API_SECRET };
    const relayer = new Relayer(credentials);

    try {
        // Sending the transaction
        const txDetails = {
            to: contractAddress,
            data: encodedCallData,
            value: "0",
            gasLimit: "300000",
            speed: "fastest"
        };

        console.log("Sending transaction:", txDetails);
        const tx = await relayer.sendTransaction(txDetails);
        console.log("Transaction successful with hash:", tx.hash);

        return {
            statusCode: 200,
            body: JSON.stringify({
                transactionId: tx.hash,
            })
        };
    } catch (error) {
        console.error("Transaction error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
