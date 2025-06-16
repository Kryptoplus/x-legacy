const axios = require('axios');
const mysql = require('mysql2/promise');

// MySQL client connection using mysql2 library for the new RDS database
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

require('events').EventEmitter.defaultMaxListeners = 20;

// Main Lambda function handler
exports.handler = async (event) => {
    try {
        console.log('Received event:', JSON.stringify(event, null, 2));

        for (const record of event.Records) {
            const parsedBody = JSON.parse(record.body);
            const transactionHash = parsedBody.transactionHash;

            if (transactionHash) {
                console.log(`Processing transaction hash: ${transactionHash}`);
                await storeTransactionData(parsedBody); // Store data in MySQL RDS
                console.log(`Transaction hash ${transactionHash} stored in RDS as "Not Found"`);
                await notifyMerchant(parsedBody); // Notify merchant if webhook URL exists
                console.log(`Merchant notified for transaction hash ${transactionHash}`);
            } else {
                console.error('transactionHash not found in SQS message body');
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'SQS messages processed successfully' })
        };
    } catch (error) {
        console.error('Error processing SQS messages:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};

// Function to store transaction data in MySQL RDS with finalStatus as "Not Found"
async function storeTransactionData(transaction) {
    const {
        customer_wallet_address,
        transaction_amount,
        merchant_fees,
        merchant_fee_address,
        token_address,
        total_amount,
        master_merchant_addresses = [],  // Default to empty array if null or not provided
        master_merchant_fees = [],       // Default to empty array if null or not provided
        merchant_Id,
        webhookUrl,
        customer_identifier,
        transactionHash
    } = transaction;

    const connection = await getDBConnection();

    const sql = `INSERT INTO not_found_table 
                 (customer_wallet_address, transaction_amount, merchant_fees, merchant_fee_address, 
                 token_address, total_amount, master_merchant_addresses, master_merchant_fees, 
                 merchant_Id, customer_identifier, transactionHash, status, created_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Not Found', CURRENT_TIME)`;

    try {
        console.log(`Storing transaction ${transactionHash} in MySQL RDS as "Not Found"`);

        await connection.execute(sql, [
            JSON.stringify(customer_wallet_address),   // Save as JSON string
            JSON.stringify(transaction_amount),        // Save as JSON string
            JSON.stringify(merchant_fees),             // Save as JSON string
            merchant_fee_address,
            token_address,
            total_amount,
            JSON.stringify(master_merchant_addresses), // Save as JSON string
            JSON.stringify(master_merchant_fees),      // Save as JSON string
            merchant_Id,
            JSON.stringify(customer_identifier),       // Save as JSON string
            transactionHash
        ]);

        console.log(`Transaction ${transactionHash} stored in MySQL RDS successfully.`);
    } catch (error) {
        console.error(`Error storing transaction ${transactionHash} in MySQL RDS:`, error);
        throw error;
    } finally {
        await connection.end();
    }
}

// Function to notify the merchant via their webhook
async function notifyMerchant(transaction) {
    const {
        transactionHash,
        customer_wallet_address,
        transaction_amount,
        merchant_fees,
        merchant_fee_address,
        token_address,
        total_amount,
        master_merchant_addresses,
        master_merchant_fees,
        merchant_Id,
        webhookUrl,
        customer_identifier
    } = transaction;

    // Prepare the notification data
    const notificationData = {
        transactionHash,
        customer_wallet_address,
        transaction_amount,
        merchant_fees,
        merchant_fee_address,
        token_address,
        total_amount,
        master_merchant_addresses,
        master_merchant_fees,
        merchant_Id,
        customer_identifier,
        status: "Not Found"
    };

    const hardcodedWebhook = 'https://hooks.slack.com/services/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'; // Replace with the actual hardcoded URL

    try {
        console.log(`Notifying merchant via hardcoded webhook: ${hardcodedWebhook}`);
        const response = await axios.post(hardcodedWebhook, notificationData);
        console.log(`Merchant notified: ${response.statusText}`);
    } catch (error) {
        console.error(`Failed to notify merchant: ${error.message}`);
    }
}
