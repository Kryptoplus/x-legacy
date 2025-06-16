const { ethers } = require('ethers');

// Define the function signature for `setValue(int256)`
const functionSignature = {
    "inputs": [
        {
            "internalType": "int256",
            "name": "_value",
            "type": "int256"
        }
    ],
    "name": "setValue",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
}

// Value to set
const valueToSet = 7;

// Encode the function call
const iface = new ethers.Interface([functionSignature]);
const data = iface.encodeFunctionData('setValue', [valueToSet]);

console.log('Calldata:', data);
