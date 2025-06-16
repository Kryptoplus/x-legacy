const jwt = require('jsonwebtoken');
require('events').EventEmitter.defaultMaxListeners = 20;

exports.handler = async (event) => {
    // Get the JWT secret key from environment variables
    const jwtSecret = process.env.JWT_SECRET;

    // Extract the wallet addresses and webhook URL from the event body
    const body = JSON.parse(event.body);
    const solanaWalletAddress = body.solanaWalletAddress; // Optional Solana wallet address
    const evmWalletAddress = body.evmWalletAddress;       // Optional EVM wallet address
    const webhookUrl = body.webhookUrl;                   // Optional webhook URL

    // Ensure at least one of the wallet addresses (Solana or EVM) is provided
    if (!solanaWalletAddress && !evmWalletAddress) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'At least one wallet address (Solana or EVM) is required' }),
        };
    }

    // Create a JWT payload with optional fields
    const payload = {
        ...(solanaWalletAddress && { solanaWalletAddress }), // Add Solana wallet address if provided
        ...(evmWalletAddress && { evmWalletAddress }),       // Add EVM wallet address if provided
        ...(webhookUrl && { webhookUrl })                   // Add webhook URL if provided
    };

    try {
        // Sign the JWT
        const token = jwt.sign(payload, jwtSecret);

        // Return the JWT token
        return {
            statusCode: 200,
            body: JSON.stringify({ token }),
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Error creating JWT' }),
        };
    }
};
