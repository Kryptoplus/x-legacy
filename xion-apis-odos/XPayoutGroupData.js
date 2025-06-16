const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');

const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const TABLE_NAME = 'xpayouts';

require('events').EventEmitter.defaultMaxListeners = 20;

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event));

    // Handle preflight requests for CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        };
    }

    // Parse request body to get merchantid
    const { merchantid } = JSON.parse(event.body);

    // Validate merchantid
    if (!merchantid) {
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: 'Missing required parameter: merchantid' })
        };
    }

    try {
        // Scan the table for transactions matching the merchantid
        const scanParams = {
            TableName: TABLE_NAME,
            FilterExpression: "merchantid = :merchantid",
            ExpressionAttributeValues: {
                ":merchantid": { S: merchantid }
            }
        };

        const data = await dynamoDbClient.send(new ScanCommand(scanParams));

        // Aggregate customer statistics by wallet
        const customerStats = {};

        // Simulate MongoDB aggregation pipeline logic
        data.Items.forEach(item => {
            const wallets = item.wallets.SS;  // Assuming wallets is a String Set (SS)
            const amounts = item.amounts.NS.map(Number);  // Convert amounts to numbers
            const fees = item.fees.NS.map(Number);  // Convert fees to numbers
            const createdAt = new Date(item.createdAt.S);  // Created date as Date object

            // Loop through each wallet in the wallets array
            wallets.forEach((wallet, index) => {
                const amount = amounts[index] / 1e6;  // Convert from wei-like to USDT readable (6 decimals)
                const feeInBasisPoints = fees[index];

                // Calculate the fee percentage and corresponding fee
                const feePercentage = feeInBasisPoints / 100;  // Convert basis points to percentage
                const fee = amount * (feePercentage / 100);  // Calculate the fee for this amount

                // Log the calculation details
                console.log(`Wallet: ${wallet}`);
                console.log(`Amount (USDT): ${amount}`);
                console.log(`Fee in Basis Points: ${feeInBasisPoints}`);
                console.log(`Fee Percentage: ${feePercentage}%`);
                console.log(`Calculated Fee (USDT): ${fee}`);

                // Initialize wallet data if not already present
                if (!customerStats[wallet]) {
                    customerStats[wallet] = {
                        totalAmount: 0,
                        totalFees: 0,
                        firstTransactionDate: createdAt
                    };
                }

                // Aggregate amounts and fees individually for each wallet
                customerStats[wallet].totalAmount += amount;
                customerStats[wallet].totalFees += fee;

                // Update the first transaction date if this is an earlier date
                if (createdAt < customerStats[wallet].firstTransactionDate) {
                    customerStats[wallet].firstTransactionDate = createdAt;
                }
            });
        });

        // Format the response to include the total for each customer wallet
        const response = Object.keys(customerStats).map(wallet => ({
            wallet,
            totalAmountPaid: customerStats[wallet].totalAmount.toFixed(6),  // USDT is represented with 6 decimals
            totalFeesPaid: customerStats[wallet].totalFees.toFixed(6),  // USDT readable format
            firstTransactionDate: customerStats[wallet].firstTransactionDate.toISOString()
        }));

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(response)
        };

    } catch (error) {
        console.error("Error processing request:", error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: error.message })
        };
    }
};
