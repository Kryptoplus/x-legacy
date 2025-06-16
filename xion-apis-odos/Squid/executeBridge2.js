const axios = require('axios');
const { Relayer } = require('@openzeppelin/defender-relay-client');
const { DefenderRelayProvider, DefenderRelaySigner } = require('@openzeppelin/defender-relay-client/lib/ethers');
const { ethers } = require('ethers');
const { Squid } = require("@0xsquid/sdk");
const { Defender } = require('@openzeppelin/defender-sdk');



// Token ABI including balanceOf
// const tokenAbi = [
//     "function balanceOf(address owner) external view returns (uint256)"
// ];

// exports.handler = async (event) => {
//     console.log("Received event:", JSON.stringify(event, null, 2));

//     const { fromAmount, toAmount, requestId, target, data, gasLimit, value, route } = JSON.parse(event.body);
//     // if (!requestId || !fromAmount) {
//     //     console.error('Missing required body parameters: requestId or fromAmount');
//     //     return { statusCode: 400, body: 'Missing required body parameters: requestId or fromAmount.' };
//     // }

//     // const fromAddress = "0x84e199D87740658c3781fC0449e23849dea46a0d";
//     // const contractAddress = "0x320Ea3C447C671d0d19B708dE39978235B3dC87E";
//     // const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
//     // const usdt = new ethers.Contract("0xc2132D05D31c914a87C6611C10748AEb04B58e8F", tokenAbi, provider);

//     // const abi = [
//     //     {
//     //         "inputs": [
//     //             {
//     //                 "internalType": "address",
//     //                 "name": "from",
//     //                 "type": "address"
//     //             },
//     //             {
//     //                 "internalType": "uint256",
//     //                 "name": "amount",
//     //                 "type": "uint256"
//     //             }
//     //         ],
//     //         "name": "transferFunds",
//     //         "outputs": [],
//     //         "stateMutability": "nonpayable",
//     //         "type": "function"
//     //     }
//     // ];

//     // const iface = new ethers.Interface(abi);
//     // const callData = iface.encodeFunctionData("transferFunds", [fromAddress, fromAmount.toString()]);

//     // const preHooks = [{
//     //     callType: 0,
//     //     target: contractAddress,
//     //     value: "0",
//     //     callData: callData,
//     //     estimatedGas: "300000"
//     // }];

//     const credentials = {
//         apiKey: process.env.RELAYER_API_KEY,
//         apiSecret: process.env.RELAYER_API_SECRET
//     };
//     const relayer = new Relayer(credentials);

//     try {
//         // console.log('Executing pre-hook transferFunds');
//         // const preHookTx = await relayer.sendTransaction({
//         //     to: contractAddress,
//         //     data: callData,
//         //     value: '0',
//         //     gasLimit: '300000',
//         //     speed: 'fastest'
//         // });
//         // console.log('Pre-hook transaction hash:', preHookTx.hash);

//         // console.log('Fetching balance...');
//         // const balance = await usdt.balanceOf("0x2ce6D2961885E0fF079f7Cf252B5363d2d3cfA0a");
//         // const balanceInUInt = ethers.parseUnits(balance.toString(), 6);
//         // const formattedFromAmount = fromAmount.toString();

//         // console.log('Balance after pre-hook:', formattedFromAmount);

//         // Hardcoded transaction parameters
//         // const routeData = {
//         //     route: {
//         //         transactionRequest: {
//         //             target: '0xce16F69375520ab01377ce7B88f5BA8C48F8D666',
//         //             data: '0xa9059cbb00000000000000000000000084e199d87740658c3781fc0449e23849dea46a0d00000000000000000000000000000000000000000000000000000000000c3500',
//         //             value: '0',
//         //             gasLimit: '667535',
//         //             speed: 'fastest',
//         //         }
//         //     }
//         // };

//         // console.log('Transaction parameters:', JSON.stringify(routeData));

//         const txReceipt = await relayer.sendTransaction({
//             to: target,
//             data,
//             value,
//             gasLimit,
//             speed: 'fastest'
//         });

//         console.log('Main transaction executed. Transaction Hash:', txReceipt.hash);
//         return {
//             statusCode: 200,
//             body: JSON.stringify({
//                 transactionId: txReceipt.hash,
//                 requestId: requestId,
//                 // fromAmount: formattedFromAmount.toString()
//             }),
//         };

//     } catch (error) {
//         console.error("API or transaction error:", error);
//         return { statusCode: 500, body: `An unexpected error occurred: ${error.message}` };
//     }
// };

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event, null, 2));

    const { fromAmount, toAmount, requestId, target, data, gasLimit, value, route } = JSON.parse(event.body);

    // const credentials = {
    //     apiKey: process.env.RELAYER_API_KEY,
    //     apiSecret: process.env.RELAYER_API_SECRET
    // };
    const validUntil = new Date(Date.now() + 120 * 1000).toISOString();
    const credentials = { relayerApiKey: process.env.RELAYER_API_KEY, relayerApiSecret: process.env.RELAYER_API_SECRET };
    const client = new Defender(credentials);

    const provider = client.relaySigner.getProvider();
    const signer = await client.relaySigner.getSigner(provider, { speed: 'fast', validUntil });
    // const provider = new DefenderRelayProvider(credentials);
    // const signer = new DefenderRelaySigner(credentials, provider, { speed: 'fast' });

    // const squid = new Squid({
    //     signer,
    // });
    // const squid = new Squid({
    //     baseUrl: "https://v2.api.squidrouter.com",
    //     integratorId: process.env.INTEGRATOR_ID
    // });

    try {
        const squid = new Squid({
            baseUrl: "https://v2.api.squidrouter.com",
            integratorId: process.env.INTEGRATOR_ID
        });

        await squid.init();
        console.log("Squid initialized");
        console.log('Executing swap and deposit transaction using Squid SDK');

        const tx = await squid.executeRoute({
            route,
            signer,
        });
        const txReceipt = await tx.wait();

        console.log('Main transaction executed. Transaction Hash:', txReceipt.hash);
        return {
            statusCode: 200,
            body: JSON.stringify({
                transactionId: txReceipt.hash,
                requestId: requestId,
            }),
        };

    } catch (error) {
        console.error("API or transaction error:", error);
        return { statusCode: 500, body: `An unexpected error occurred: ${error.message}` };
    }
};
