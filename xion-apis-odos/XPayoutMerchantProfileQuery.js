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

    // Parse the request body to extract merchant_Id
    const { merchant_Id } = JSON.parse(event.body);

    // Validate the merchant_Id
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

    try {
        const connection = await getDBConnection();

        // SQL query to retrieve data from the merchant_table based on merchant_Id
        const query = `
            SELECT merchant_Id, master_merchant_address, master_merchant_fee, webhookUrl
            FROM merchant_table
            WHERE merchant_Id = ?;
        `;

        // Execute the query
        const [rows] = await connection.execute(query, [merchant_Id]);

        // Close the connection
        await connection.end();

        // If no results are found, return a not found response
        if (rows.length === 0) {
            return {
                statusCode: 404,
                headers: {
                    'Access-Control-Allow-Origin': accessControlAllowOrigin,
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Credentials': 'true'
                },
                body: JSON.stringify({ message: 'Merchant not found' })
            };
        }

        // Return the result of the query
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify(rows[0]) // Assuming only one merchant per merchant_Id
        };

    } catch (error) {
        console.error("Error querying merchant data:", error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': accessControlAllowOrigin,
                'Content-Type': 'application/json',
                'Access-Control-Allow-Credentials': 'true'
            },
            body: JSON.stringify({ error: 'Internal Server Error' })
        };
    }
};