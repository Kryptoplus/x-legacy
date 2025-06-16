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

    // Validate the required input
    if (!merchant_Id) {
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({ error: 'Missing required parameter: merchant_Id' })
        };
    }

    try {
        const connection = await getDBConnection();
        const checkMerchantSql = `SELECT * FROM merchant_table WHERE merchant_Id = ?`;
        const [existingMerchant] = await connection.execute(checkMerchantSql, [merchant_Id]);

        const created_at = new Date().toISOString();
        const updated_at = created_at;

        if (existingMerchant.length > 0) {
            // Build the update query dynamically
            let updateFields = [];
            let updateValues = [];

            if (master_merchant_address) {
                updateFields.push('master_merchant_address = ?');
                updateValues.push(JSON.stringify(master_merchant_address));
            }
            if (master_merchant_fee) {
                updateFields.push('master_merchant_fee = ?');
                updateValues.push(JSON.stringify(master_merchant_fee));
            }
            if (webhookUrl) {
                updateFields.push('webhookUrl = ?');
                updateValues.push(webhookUrl);
            }

            updateFields.push('updated_at = ?');
            updateValues.push(updated_at);
            updateValues.push(merchant_Id);

            if (updateFields.length > 1) {  // Only update if there are fields to update
                const updateSql = `UPDATE merchant_table SET ${updateFields.join(', ')} WHERE merchant_Id = ?`;
                await connection.execute(updateSql, updateValues);
                console.log(`Merchant data updated for merchant_Id: ${merchant_Id}`);
            } else {
                console.log("No updates needed for merchant:", merchant_Id);
            }

        } else {
            // Build the insert query dynamically
            let insertFields = ['merchant_Id', 'created_at', 'updated_at'];
            let insertPlaceholders = ['?', '?', '?'];
            let insertValues = [merchant_Id, created_at, updated_at];

            if (master_merchant_address) {
                insertFields.push('master_merchant_address');
                insertPlaceholders.push('?');
                insertValues.push(JSON.stringify(master_merchant_address));
            }
            if (master_merchant_fee) {
                insertFields.push('master_merchant_fee');
                insertPlaceholders.push('?');
                insertValues.push(JSON.stringify(master_merchant_fee));
            }
            if (webhookUrl) {
                insertFields.push('webhookUrl');
                insertPlaceholders.push('?');
                insertValues.push(webhookUrl);
            }

            const insertSql = `INSERT INTO merchant_table (${insertFields.join(', ')}) VALUES (${insertPlaceholders.join(', ')})`;
            await connection.execute(insertSql, insertValues);
            console.log(`New merchant added: merchant_Id = ${merchant_Id}`);
        }

        await connection.end();

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({ message: 'Merchant data saved or updated successfully', merchant_Id })
        };

    } catch (error) {
        console.error("Error saving or updating merchant data:", error);
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