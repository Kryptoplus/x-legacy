const axios = require("axios");
const jwt = require('jsonwebtoken');

exports.handler = async (event) => {
  // Parsing only the needed parameters from the event body
  const { transactionId, requestId, fromChainId, toChainId } = JSON.parse(
    event.body
  );

  // Check if all required parameters are present
  if (!transactionId || !requestId || !fromChainId || !toChainId) {
    console.error(
      "Missing one or more required parameters: transactionId, requestId"
    );
    return {
      statusCode: 400,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // Allow all origins or specify your domain
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        'Access-Control-Allow-Headers': 'Content-Type, x-integrator-id, Authorization'
      },
      body: "Missing required body parameters.",
    };
  }

   // Get the JWT secret key from environment variables
   const jwtSecret = process.env.JWT_SECRET;

   // Extract the JWT from the 'Authorization' header
   const authHeader = event.headers.Authorization || event.headers.authorization; // Check both cases
   const token = authHeader?.split(' ')[1]; // Get the token part

   if (!token) {
       return {
           statusCode: 401,
           body: JSON.stringify({ error: 'Authorization token is missing' })
       };
   }

   let decoded;
   try {
       // Verify the JWT
       decoded = jwt.verify(token, jwtSecret);
       console.log('Decoded JWT:', decoded); // Log the decoded token for debugging
   } catch (error) {
       console.error('Invalid token:', error.message); // Log the specific JWT error
       return {
           statusCode: 401,
           body: JSON.stringify({ error: 'Invalid token' })
       };
   }


  // Construct the URL with the necessary query parameters
  const url = `https://v2.api.squidrouter.com/v2/status?transactionId=${transactionId}&requestId=${requestId}&fromChainId=${fromChainId}&toChainId=${toChainId}`;
  console.log(
    `Fetching status for Transaction ID: ${transactionId} with Request ID: ${requestId}`
  );

  try {
    const response = await axios.get(url, {
      headers: {
        "x-integrator-id": process.env.INTEGRATOR_ID,
        "Content-Type": "application/json",
      },
    });

    console.log("Status fetched successfully:", response.data);

    // Create a clean response that includes requested details and the status
    const cleanedResponse = {
      transactionId: transactionId,
      requestId: requestId,
      status:
        response.data.routeStatus[response.data.routeStatus.length - 1].status,
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // Allow all origins or specify your domain
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        'Access-Control-Allow-Headers': 'Content-Type, x-integrator-id, Authorization'
      },
      body: JSON.stringify(cleanedResponse),
    };
  } catch (error) {
    console.error(
      "API error during status fetching:",
      error.response ? error.response.data : error.message
    );
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // Allow all origins or specify your domain
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        'Access-Control-Allow-Headers': 'Content-Type, x-integrator-id, Authorization'
      },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
