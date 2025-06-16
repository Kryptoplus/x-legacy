require('events').EventEmitter.defaultMaxListeners = 20;
const { Relayer } = require('@openzeppelin/defender-relay-client');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const ethers = require('ethers');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const mysql = require('mysql2/promise');

const sqsClient = new SQSClient({ region: process.env.AWS_REGION });
const PAYOUT_SQS_QUEUE_URL = process.env.PAYOUT_SQS_QUEUE_URL;
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const jwt = require('jsonwebtoken');  // Import jwt for authentication

// MySQL client connection using mysql2 library
async function getDBConnection() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: 3306 // Default MySQL port
    });
    return connection;
}

// Whitelisted origins
// const whitelistedOrigins = [
//     // 'http://localhost:3000',
//     'https://www.xpayout.io',
//     'http://localhost:3000'
// ];

  // Fixed origin for Access-Control-Allow-Origin
//   const allowedOrigin = 'https://www.xpayout.io';


// ERC20 token ABI
const erc20Abi = [
    "function balanceOf(address owner) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)"
];

// Hardcoded spender address (replace this with the actual spender)
const SPENDER_ADDRESS = '0x7b0D537b00Da618366D0f5fD8818D2d9552D7b4C';

// Fixed fee in USDT (0.20 USDT represented in smallest unit, assuming 6 decimals)
const FIXED_TRANSACTION_FEE = 200000; // 0.20 USDT

// Helper function to check the allowance of the merchant
async function checkAllowance(tokenAddress, merchant_Id, totalAmount) {
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);

    // Fetch the allowance and log it
    const allowance = BigInt(await tokenContract.allowance(merchant_Id, SPENDER_ADDRESS));
    console.log(`Allowance: ${allowance.toString()}`); // Log allowance as a string for clarity

    totalAmount = BigInt(totalAmount); // Convert totalAmount to BigInt if it isn't already
    console.log(`Total Amount: ${totalAmount.toString()}`); // Log totalAmount as a string for clarity

    return allowance >= totalAmount; // Use >= operator for comparison
}

// Helper function to check the balance of the merchant
async function checkBalance(tokenAddress, merchant_Id, totalAmount) {
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);

    // Fetch the balance and log it
    const balance = BigInt(await tokenContract.balanceOf(merchant_Id));
    console.log(`Balance: ${balance.toString()}`); // Log balance as a string for clarity

    totalAmount = BigInt(totalAmount); // Convert totalAmount to BigInt if it isn't already
    console.log(`Total Amount: ${totalAmount.toString()}`); // Log totalAmount as a string for clarity

    return balance >= totalAmount; // Use >= operator for comparison
}

// Function to fetch merchant details from the database
async function getMerchantDetails(merchant_Id) {
    const connection = await getDBConnection();
    try {
        const [rows] = await connection.execute(
            `SELECT master_merchant_address, master_merchant_fee FROM merchant_table WHERE merchant_Id = ?`,
            [merchant_Id]
        );
        if (rows.length > 0) {
            // Assuming there's only one result per merchant_Id
            const master_merchant_addresses = rows.map(row => row.master_merchant_address);
            const master_merchant_fees = rows.map(row => row.master_merchant_fee);
            return { master_merchant_addresses, master_merchant_fees };
        } else {
            throw new Error(`No merchant details found for merchant_Id: ${merchant_Id}`);
        }
    } catch (error) {
        console.error('Error fetching merchant details:', error);
        throw error;
    } finally {
        await connection.end();
    }
}


// Helper function to add a delay
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Check the transaction on-chain using ethers.js
async function checkTransactionStatus(txHash) {
    try {
        console.log(`Checking on-chain transaction for hash: ${txHash}`);
        const receipt = await provider.getTransactionReceipt(txHash);

        if (!receipt) {
            console.log("Transaction not found on-chain.");
            return null;
        }

        console.log(`Transaction found on-chain: ${JSON.stringify(receipt)}`);
        return receipt;
    } catch (error) {
        console.error("Error checking on-chain transaction:", error);
        return null;
    }
}

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event));

    const jwtSecret = process.env.JWT_SECRET;

    const order_code = uuidv4().replace(/-/g, '').slice(0, 5);

   // Extract the origin from headers
//    const origin = event.headers.origin || event.headers.Origin;
//    console.log("Request Origin:", origin);

   // Check if origin is in the whitelist
//    const isOriginAllowed = whitelistedOrigins.some(allowedOrigin => origin && origin.startsWith(allowedOrigin));


    // Declare variables to be used later
    let customer_wallet_address, transaction_amount, merchant_fees, merchant_fee_address, token_address, total_amount;
    let master_merchant_addresses = [], master_merchant_fees = [], merchant_Id, webhookUrl, customer_identifier;

    // Handle CORS for OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, x-integrator-id',
                'Access-Control-Allow-Credentials': 'true'
            }
        };
    }

    // If the origin is not allowed, return an error response
// if (!isOriginAllowed) {
//     return {
//         statusCode: 403,
//         headers: {
//             'Access-Control-Allow-Origin': 'null',
//             'Content-Type': 'application/json'
//         },
//         body: JSON.stringify({ error: 'Origin not allowed' })
//     };
// }

    // Extract JWT from Authorization header
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return {
            statusCode: 401,
            headers: {
                "Access-Control-Allow-Origin": "*",
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({ error: 'Authorization token is missing' })
        };
    }

    // JWT verification
    try {
        const decoded = jwt.verify(token, jwtSecret);
        console.log('Decoded JWT:', decoded);

        // Now proceed with parsing the body
        const body = JSON.parse(event.body);
        const transactions = body.transactions || [];
        merchant_fee_address = body.merchant_fee_address;
        token_address = body.token_address;
        total_amount = body.total_amount;
        master_merchant_addresses = body.master_merchant_addresses || [];
        master_merchant_fees = body.master_merchant_fees || [];
        merchant_Id = body.merchant_Id;
        webhookUrl = body.webhookUrl;

        // Now extract arrays from transactions
        customer_wallet_address = transactions.map(t => t.customer_wallet_address);
        transaction_amount = transactions.map(t => t.transaction_amount);
        merchant_fees = transactions.map(t => t.merchant_fees);
        customer_identifier = transactions.map(t => t.customer_identifier);

        console.log('Event body:', event.body);
        // Log each parameter individually
        console.log('customer_wallet_address:', customer_wallet_address);
        console.log('transaction_amount:', transaction_amount);
        console.log('merchant_fees:', merchant_fees);
        console.log('merchant_fee_address:', merchant_fee_address);
        console.log('token_address:', token_address);
        console.log('total_amount:', total_amount);
        console.log('master_merchant_addresses:', master_merchant_addresses);
        console.log('master_merchant_fees:', master_merchant_fees);
        console.log('merchant_Id:', merchant_Id);
        console.log('webhookUrl:', webhookUrl);
        console.log('customer_identifier:', customer_identifier);

         // Validate required parameters
         if (!transactions.length || !merchant_fee_address || !token_address || !total_amount || !merchant_Id) {
            console.error("Missing required parameters");
            return {
                statusCode: 400,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Credentials': 'true'
                },
                body: JSON.stringify({ error:"Missing required parameters"})
            };
        }

        // Validate each transaction
        for (let i = 0; i < transactions.length; i++) {
            const t = transactions[i];
            if (!t.customer_wallet_address || !t.transaction_amount || !t.merchant_fees || !t.customer_identifier) {
                console.error(`Missing required transaction parameters at index ${i}`);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Credentials': 'true'
                    },
                    body: JSON.stringify({ error: `Missing required transaction parameters at index ${i}` })
                };
            }
        }

        // Fetch the master merchant details from the database
        const merchantDetails = await getMerchantDetails(merchant_Id);
        master_merchant_addresses = merchantDetails.master_merchant_addresses;
        master_merchant_fees = merchantDetails.master_merchant_fees;

        console.log('Fetched master_merchant_addresses:', master_merchant_addresses);
        console.log('Fetched master_merchant_fees:', master_merchant_fees);

        // Flatten arrays
        master_merchant_addresses = master_merchant_addresses.flat();
        master_merchant_fees = master_merchant_fees.flat();

        // Sanitize master_merchant_addresses: Remove nulls and validate addresses
        master_merchant_addresses = master_merchant_addresses.filter(addr => addr !== null && addr !== undefined && ethers.isAddress(addr));

        // Sanitize master_merchant_fees: Remove nulls and ensure they are numbers
        master_merchant_fees = master_merchant_fees.filter(fee => fee !== null && fee !== undefined && typeof fee === 'number');

        // If master_merchant_addresses is empty after sanitization, ensure it's an empty array
        if (!master_merchant_addresses || master_merchant_addresses.length === 0) {
            master_merchant_addresses = [];
        }

        if (!master_merchant_fees || master_merchant_fees.length === 0) {
            master_merchant_fees = [];
        }

        // Check for mismatched array lengths
        if (customer_wallet_address.length !== transaction_amount.length || transaction_amount.length !== merchant_fees.length || merchant_fees.length !== customer_identifier.length) {
            console.error("Mismatched array lengths for customer_wallet_address, transaction_amount, merchant_fees, and customer_identifier");
            return {
                statusCode: 400,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Credentials': 'true'
                },
                body: JSON.stringify({ error: "Array lengths for customer_wallet_address, transaction_amount, merchant_fees, and customer_identifier must match"})
            };
        }


        // Compute total_master_fees as BigInt
        const total_master_fees_bigint = master_merchant_fees.reduce((acc, fee) => acc + BigInt(fee), BigInt(0));

        // Now perform the check for each transaction
        for (let i = 0; i < transaction_amount.length; i++) {
            const transaction_amount_bigint = BigInt(transaction_amount[i]);
            const merchant_fee_bigint = BigInt(merchant_fees[i]);

            const total_fees = merchant_fee_bigint + total_master_fees_bigint;
            if (total_fees > transaction_amount_bigint) {
                // Throw error and stop processing
                console.error("Fees are higher than payout amount for transaction index:", i);
                return {
                    statusCode: 400,
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Credentials': 'true'
                    },
                    body: JSON.stringify({ error: "Fees are higher than payout amount" })
                };                
            }
        }


        // Now we close the JWT verification `try` block here, after completing all JWT-specific logic
    } catch (error) {
        console.error("JWT verification error:", error);
        return {
            statusCode: 403,
            body: JSON.stringify({ error: 'Invalid token' })
        };
    }

    try {
        // Check allowance before proceeding
        const hasSufficientAllowance = await checkAllowance(token_address, merchant_Id, total_amount);
        if (!hasSufficientAllowance) {
            return {
                statusCode: 400,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Credentials': 'true'
                },
                body: JSON.stringify({ error: 'Allowance is insufficient' })
            };
        }

        // Check balance before proceeding
        const hasSufficientBalance = await checkBalance(token_address, merchant_Id, total_amount);
        if (!hasSufficientBalance) {
            return {
                statusCode: 400,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Credentials': 'true'
                },
                body: JSON.stringify({ error: 'Balance is insufficient' })
            };
        }

        // Proceed with transaction sending if checks pass

        // ABI and encoding
        const abi = [
            {
                "inputs": [
                    { "internalType": "address", "name": "sender", "type": "address" },
                    { "internalType": "uint256", "name": "totalAmount", "type": "uint256" },
                    { "internalType": "address[]", "name": "wallets", "type": "address[]" },
                    { "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" },
                    { "internalType": "uint256[]", "name": "fees", "type": "uint256[]" },
                    { "internalType": "address", "name": "merchantFeeAddress", "type": "address" },
                    { "internalType": "address", "name": "token", "type": "address" },
                    { "internalType": "address[]", "name": "masterMerchantAddresses", "type": "address[]" },
                    { "internalType": "uint256[]", "name": "masterMerchantFees", "type": "uint256[]" }
                ],
                "name": "airdrop",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            }
        ];

        const iface = new ethers.Interface(abi);
        const callData = iface.encodeFunctionData("airdrop", [
            merchant_Id,
            total_amount,
            customer_wallet_address,
            transaction_amount,
            merchant_fees,
            merchant_fee_address,
            token_address,
            master_merchant_addresses,
            master_merchant_fees
        ]);

        const credentials = { apiKey: process.env.RELAYER_API_KEY, apiSecret: process.env.RELAYER_API_SECRET };
        const relayer = new Relayer(credentials);

        const created_at = new Date().toISOString();

        let txHash = null;

        const txDetails = {
            to: '0x7b0D537b00Da618366D0f5fD8818D2d9552D7b4C',
            data: callData,
            value: "0",
            gasLimit: "6000000",
            // speed: "fastest",
            // gasPrice: "150000000032",
            maxFeePerGas: "1500000000032",
            maxPriorityFeePerGas: "500000000000"
        };

        console.log("Sending transaction:", txDetails);
        const tx = await relayer.sendTransaction(txDetails);
        txHash = tx.hash;  // Always assign the transaction hash
        console.log("Transaction sent with hash:", txHash);

        // Save transaction after it's sent
        await saveTransactionToDB(order_code, merchant_Id, customer_wallet_address, transaction_amount, merchant_fees, merchant_fee_address, token_address, total_amount, master_merchant_addresses, master_merchant_fees, customer_identifier, created_at, txHash);

        // Delay before checking transaction status
        console.log("Delaying for 4 seconds before checking transaction status...");
        await delay(4000);

        console.log("Checking transaction status:", txHash);
        const receipt = await checkTransactionStatus(txHash);
        if (!receipt) {
            console.log("Transaction not found on-chain:", txHash);
            await updateTransactionInDB(order_code, merchant_Id, 'Processing', txHash);

            await addToQueue({
                order_code,
                merchant_Id,
                customer_wallet_address,
                transaction_amount,
                merchant_fees,
                merchant_fee_address,
                token_address,
                total_amount,
                master_merchant_addresses,
                master_merchant_fees,
                webhookUrl,
                created_at,
                customer_identifier,
                transactionHash: txHash
            });

            return {
                statusCode: 200,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Credentials': 'true'
                },
                body: JSON.stringify({
                    // message: "Transaction not found on-chain, marked as Processing and added to requeue",
                    transactionHash: txHash,
                    status: 'Processing'
                })
            };
        }

        const status = receipt.status === 1 ? 'Success' : 'Failed';
        console.log(`Transaction ${status} on-chain with hash:`, txHash);
        await updateTransactionInDB(order_code, merchant_Id, status, txHash);

        if (status === 'Failed' || status === 'Success') {
            if (webhookUrl) {
                await notifyMerchant(txHash, status, order_code, merchant_fees, token_address, transaction_amount, customer_wallet_address, merchant_fee_address, total_amount, master_merchant_addresses, master_merchant_fees, created_at, webhookUrl);
            } else {
                console.log('Skipping merchant notification because webhookUrl is not provided.');
            }
        }

        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({
                // message: `Transaction ${status}`,
                transactionHash: txHash,
                status: status
            })
        };

    } catch (error) {
        console.error("Transaction error:", error);

        await updateTransactionInDB(order_code, merchant_Id, 'Failed', txHash);

        await notifyMerchant(txHash, 'Failed', order_code, merchant_fees, token_address, transaction_amount, customer_wallet_address, merchant_fee_address, total_amount, master_merchant_addresses, master_merchant_fees, created_at, webhookUrl);

        return {
            statusCode: 500,
            headers: {
                "Access-Control-Allow-Origin": "*",
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({ error: error.message })
        };
    }
};

// Function to save the transaction to Aurora RDS
async function saveTransactionToDB(order_code, merchant_Id, customer_wallet_address, transaction_amount, merchant_fees, merchant_fee_address, token_address, total_amount, master_merchant_addresses, master_merchant_fees, customer_identifier, created_at, transactionHash) {
    const connection = await getDBConnection();

    // const transaction_fee = transaction_amount.map(amount => parseFloat(amount) * 0.01);

    // Implementing a fixed fee of 0.20 USDT per transaction
    const transaction_fee = transaction_amount.map(() => FIXED_TRANSACTION_FEE);

    const sql = `INSERT INTO transaction_table (order_code, merchant_Id, customer_wallet_address, transaction_amount, merchant_fees, transaction_fee, merchant_fee_address, token_address, total_amount, master_merchant_addresses, master_merchant_fees, customer_identifier, status, created_at, transactionHash) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)`;
    try {
        await connection.execute(sql, [
            order_code,
            merchant_Id,
            JSON.stringify(customer_wallet_address),
            JSON.stringify(transaction_amount),
            JSON.stringify(merchant_fees),
            JSON.stringify(transaction_fee),
            merchant_fee_address,
            token_address,
            total_amount,
            JSON.stringify(master_merchant_addresses),
            JSON.stringify(master_merchant_fees),
            JSON.stringify(customer_identifier),
            created_at,
            transactionHash || 'N/A'
        ]);
        console.log(`Transaction ${order_code} saved to Aurora RDS with status "Pending"`);
    } catch (error) {
        console.error('Error saving transaction to Aurora RDS:', error);
        throw error;
    } finally {
        await connection.end();
    }
}

// Function to update the transaction status in Aurora RDS
async function updateTransactionInDB(order_code, merchant_Id, status, transactionHash) {
    const connection = await getDBConnection();
    const sql = `UPDATE transaction_table SET status = ?, transactionHash = ?, updated_at = ? WHERE order_code = ? AND merchant_Id = ?`;
    try {
        await connection.execute(sql, [status, transactionHash || 'N/A', new Date().toISOString(), order_code, merchant_Id]);
        console.log(`Transaction ${order_code} updated to status "${status}" in Aurora RDS`);
    } catch (error) {
        console.error('Error updating transaction in Aurora RDS:', error);
        throw error;
    } finally {
        await connection.end();
    }
}

// Function to notify the merchant via webhook
async function notifyMerchant(transactionHash, status, order_code, merchant_fees, token_address, transaction_amount, customer_wallet_address, merchant_fee_address, total_amount, master_merchant_addresses, master_merchant_fees, created_at, webhookUrl) {
    try {
        console.log(`Notifying merchant at ${webhookUrl}`);
        const response = await axios.post(webhookUrl, {
            transactionHash,
            status,
            order_code,
            transaction_amount,
            merchant_fees,
            customer_wallet_address,
            merchant_fee_address,
            token_address,
            total_amount,
            master_merchant_addresses,
            master_merchant_fees,
            created_at
        });
        console.log(`Merchant notified: ${response.statusText}`);
    } catch (error) {
        console.error(`Failed to notify merchant: ${error.message}`);
    }
}

// Function to add the transaction to the SQS queue for reprocessing
async function addToQueue(transactionData) {
    const sqsParams = {
        MessageBody: JSON.stringify(transactionData),
        QueueUrl: PAYOUT_SQS_QUEUE_URL,
        DelaySeconds: 5
    };

    try {
        console.log(`Adding transaction to SQS queue:`, transactionData);
        const command = new SendMessageCommand(sqsParams);
        const result = await sqsClient.send(command);
        console.log(`Transaction added to SQS queue. MessageId: ${result.MessageId}`);
    } catch (error) {
        console.error(`Failed to add transaction to SQS queue: ${error.message}`);
    }
}