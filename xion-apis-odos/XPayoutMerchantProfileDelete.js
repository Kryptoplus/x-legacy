require('events').EventEmitter.defaultMaxListeners = 20;
const mysql = require('mysql2/promise');

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
const whitelistedOrigins = [
    'https://www.xpayout.io',
    'http://localhost:3001'
];

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event));

    // Check the Origin header
    const origin = event.headers.Origin || event.headers.origin; // Check both upper and lowercase
    const isOriginAllowed = whitelistedOrigins.includes(origin);
    const accessControlAllowOrigin = isOriginAllowed ? origin : 'null';

    if (!whitelistedOrigins.includes(origin)) {
        return {
            statusCode: 403,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({ error: 'Access denied' })
        };
    }

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Allow-Credentials': 'true'
            }
        };
    }

    // If the origin is not allowed, return an error response
if (!isOriginAllowed) {
    return {
        statusCode: 403,
        headers: {
            'Access-Control-Allow-Origin': 'null',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Origin not allowed' })
    };
}


    let body;
    try {
        // Parse the event body
        console.log("Event body before parsing:", event.body);
        body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        console.log("Parsed body:", body);
    } catch (error) {
        console.error("Error parsing request body:", error);
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({ error: 'Invalid JSON in request body' })
        };
    }

    const { merchant_Id, master_merchant_address, master_merchant_fee, webhookUrl } = body;

    // Validate that at least merchant_Id and one other parameter are provided
    if (!merchant_Id || (!master_merchant_address && !master_merchant_fee && !webhookUrl)) {
        console.error("Missing required parameters.");
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({ error: 'Missing required parameters' })
        };
    }

    try {
        const connection = await getDBConnection();

        // Check if merchant_Id exists
        const checkMerchantSql = `
            SELECT master_merchant_address, master_merchant_fee, webhookUrl
            FROM merchant_table 
            WHERE merchant_Id = ?
        `;
        const [existingMerchant] = await connection.execute(checkMerchantSql, [merchant_Id]);

        if (existingMerchant.length === 0) {
            console.error("Merchant not found:", merchant_Id);
            return {
                statusCode: 404,
                headers: {
                    'Access-Control-Allow-Origin': accessControlAllowOrigin,
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Credentials': 'true'
                },
                body: JSON.stringify({ error: 'Merchant not found' })
            };
        }

        let existingAddresses = [];
        let existingFees = [];
        let existingWebhookUrl = existingMerchant[0].webhookUrl;

        // Parse the existing addresses and fees
        try {
            existingAddresses = Array.isArray(existingMerchant[0].master_merchant_address)
                ? existingMerchant[0].master_merchant_address
                : JSON.parse(existingMerchant[0].master_merchant_address);

            existingFees = Array.isArray(existingMerchant[0].master_merchant_fee)
                ? existingMerchant[0].master_merchant_fee
                : JSON.parse(existingMerchant[0].master_merchant_fee);
        } catch (parseError) {
            console.error("Error parsing existing merchant data:", existingMerchant[0]);
            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': accessControlAllowOrigin,
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Credentials': 'true'
                },
                body: JSON.stringify({ error: 'Error parsing existing merchant data' })
            };
        }

        // Handle deletion of specific values from master_merchant_address or master_merchant_fee
        if (master_merchant_address) {
            console.log("Deleting specific addresses:", master_merchant_address);
            existingAddresses = existingAddresses.filter(
                (address) => !master_merchant_address.includes(address)
            );
        }

        if (master_merchant_fee) {
            console.log("Deleting specific fees:", master_merchant_fee);
            existingFees = existingFees.filter(
                (fee) => !master_merchant_fee.includes(fee)
            );
        }

        // If webhookUrl is provided, set it to null (or any desired default)
        if (webhookUrl) {
            console.log("Deleting webhookUrl:", webhookUrl);
            if (existingWebhookUrl === webhookUrl) {
                existingWebhookUrl = null;
            }
        }

        // Update the merchant record in the database
        const updateMerchantSql = `
            UPDATE merchant_table
            SET master_merchant_address = ?, master_merchant_fee = ?, webhookUrl = ?, updated_at = ?
            WHERE merchant_Id = ?
        `;
        const updated_at = new Date().toISOString();

        await connection.execute(updateMerchantSql, [
            JSON.stringify(existingAddresses),
            JSON.stringify(existingFees),
            existingWebhookUrl,
            updated_at,
            merchant_Id
        ]);

        console.log(`Merchant data updated: merchant_Id = ${merchant_Id}`);

        // Close the connection
        await connection.end();

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({
                message: 'Merchant data updated successfully',
                merchant_Id: merchant_Id
            })
        };

    } catch (error) {
        console.error("Error updating merchant data:", error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({ error: error.message })
        };
    }
};