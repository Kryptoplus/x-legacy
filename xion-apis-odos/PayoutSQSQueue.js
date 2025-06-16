const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { ethers } = require('ethers');
const axios = require('axios');
const mysql = require('mysql2/promise');

// Environment variable for SQS queue URL and MySQL database details
const PAYOUT_SQS_QUEUE_URL = process.env.PAYOUT_SQS_QUEUE_URL;
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://rpc-mainnet.matic.quiknode.pro');

// Initialize the SQS client
const sqsClient = new SQSClient({ region: process.env.AWS_REGION });

require('events').EventEmitter.defaultMaxListeners = 20;

// MySQL client connection using mysql2 library
async function getDBConnection() {
    const connection = await mysql.createConnection({
        host: "xpayout-small-db.c7c7rkdnfqka.us-east-1.rds.amazonaws.com", // RDS endpoint
        user: "admin", // RDS username
        password: "b%2}Z8-~xL9z)bymLI5kkFkxe)!{", // RDS password
        database: "xpayoutSmallDb", // RDS database name
        port: 3306 // Default MySQL port
    });
    return connection;
}


// Function to check the transaction on-chain using ethers.js (SAME as xpayout)
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

// Handler function to process incoming events
exports.handler = async (event) => {
    let transactionHash;
    let resultMessage;

    try {
        console.log('Received event:', JSON.stringify(event, null, 2));

        // Check if it's an SQS event or API Gateway request
        if (event.Records) {
            console.log('Processing SQS event');
            for (const record of event.Records) {
                const parsedBody = JSON.parse(record.body);
                transactionHash = parsedBody.transactionHash;
                if (transactionHash) {
                    console.log(`Found transactionHash in SQS message: ${transactionHash}`);
                    resultMessage = await processTransaction(parsedBody);
                } else {
                    console.error('transactionHash not found in SQS message body');
                }
            }
        } else {
            console.log('Processing API Gateway event');
            const parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
            transactionHash = parsedBody ? parsedBody.transactionHash : undefined;

            if (transactionHash) {
                console.log(`Found transactionHash in API Gateway request body: ${transactionHash}`);
                resultMessage = await processTransaction(parsedBody);
            } else {
                console.error('transactionHash not found in request body');
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'transactionHash not found in request body' })
                };
            }
        }

        console.log(`Returning success response with message: ${resultMessage}`);
        return {
            statusCode: 200,
            body: JSON.stringify({ message: resultMessage })
        };
    } catch (error) {
        console.error('Error processing transaction:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};

// Function to process the transaction
async function processTransaction(params) {
    const {
        transactionHash,
        order_code,
        merchant_Id,
        webhookUrl
    } = params;

    console.log(`Processing transaction with transactionHash: ${transactionHash}`);

    try {
        // Check on-chain using ethers.js
        let receipt = await checkTransactionStatus(transactionHash);
        let status;

        // If receipt is not found, try checking with the Polygonscan API as a fallback
        if (!receipt) {
            console.log('Transaction not found with provider, falling back to Polygonscan API.');
            status = await checkTransactionWithExplorer(transactionHash);

            if (status === 'Transaction not found') {
                console.log(`Transaction ${transactionHash} not found on explorer, requeuing...`);
                await requeueTransactionHash(params);
                return `Transaction ${transactionHash} not found, requeued`;
            }
        } else {
            // Determine success or failure based on the provider receipt
            status = receipt.status === 1 ? 'Success' : 'Failed';
        }

        // Update status in Aurora RDS
        console.log(`Transaction ${transactionHash} is ${status}`);
        await updateTransactionStatusInRDS(order_code, merchant_Id, transactionHash, status);

        // Notify the merchant using the webhook URL
        console.log(`Notifying merchant via webhook: ${webhookUrl}`);
        await notifyMerchant(params, status, webhookUrl);
        console.log(`Merchant notified successfully for transaction ${transactionHash}`);

        return `Transaction ${transactionHash} updated to ${status}`;
    } catch (error) {
        console.error(`Error processing transaction ${transactionHash}:`, error);
        await requeueTransactionHash(params); // Requeueing even in the case of an error
        console.log(`Transaction ${transactionHash} requeued due to processing error.`);
        throw error;
    }
}

// Function to check transaction status using Polygonscan API
async function checkTransactionWithExplorer(txHash) {
    const API_KEY = process.env.POLYGONSCAN_API_KEY; // Get from polygonscan.com
    const url = `https://api.polygonscan.com/api?module=transaction&action=gettxreceiptstatus&txhash=${txHash}&apikey=${API_KEY}`;

    try {
        console.log(`Checking transaction ${txHash} with Polygonscan API.`);
        const response = await axios.get(url);
        const data = response.data;

        if (data.status === '1') {
            return data.result.status === '1' ? 'Success' : 'Failed';
        } else {
            return 'Transaction not found';
        }
    } catch (error) {
        console.error(`Failed to fetch transaction from Polygonscan: ${error.message}`);
        return 'Error';
    }
}

// Function to update the transaction status in Aurora RDS
async function updateTransactionStatusInRDS(order_code, merchant_Id, transactionHash, status) {
    const connection = await getDBConnection();
    const sql = `
        UPDATE transaction_table
        SET status = ?, updated_at = ?
        WHERE order_code = ? AND merchant_Id = ? AND transactionHash = ?
    `;

    const values = [status, new Date().toISOString(), order_code, merchant_Id, transactionHash];

    try {
        console.log(`Updating transaction ${transactionHash} to status ${status} in Aurora RDS`);
        await connection.execute(sql, values);
        console.log(`Successfully updated transaction ${transactionHash} to status ${status}`);
    } catch (error) {
        console.error(`Error updating transaction ${transactionHash} in RDS:`, error);
        throw error;
    } finally {
        await connection.end();
    }
}

// Function to notify the merchant via webhook
async function notifyMerchant(params, status, webhookUrl) {
    const {
        transactionHash,
        merchant_Id,
        customer_wallet_address,
        transaction_amount,
        merchant_fees,
        merchant_fee_address,
        token_address,
        customer_identifier,
        order_code,
        created_at,
        master_merchant_addresses,
        master_merchant_fees
    } = params;

    try {
        const response = await axios.post(webhookUrl, {
            transactionHash,
            status,
            merchant_Id,
            customer_wallet_address,
            transaction_amount,
            merchant_fees,
            merchant_fee_address,
            token_address,
            customer_identifier,
            order_code,
            created_at,
            master_merchant_addresses,
            master_merchant_fees
        });

        console.log(`Merchant notified: ${response.statusText}`);
    } catch (error) {
        console.error(`Failed to notify merchant: ${error.message}`);
    }
}

// Function to requeue the transaction hash with a delay of 5 seconds
async function requeueTransactionHash(params) {
    const requeueParams = {
        MessageBody: JSON.stringify(params),
        QueueUrl: PAYOUT_SQS_QUEUE_URL,
        DelaySeconds: 5
    };

    try {
        console.log(`Attempting to requeue transaction hash: ${params.transactionHash}`);
        const command = new SendMessageCommand(requeueParams);
        const result = await sqsClient.send(command);
        console.log(`Successfully requeued transaction hash: ${params.transactionHash}, MessageId: ${result.MessageId}`);
    } catch (error) {
        console.error(`Error requeuing transaction hash ${params.transactionHash}:`, error);
    }
}