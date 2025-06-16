// auth.js
const allowedPairs = [
    {
        toAddress: '0x6C1FBcFfd55b114AA8476D12B9e69Eb13D46588B',
        connectWallet: '0xdA9dF62dDEF0aa75f3Ce8416768762E184145dEa'
    },
    {
        toAddress: '0x84e199D87740658c3781fC0449e23849dea46a0d',
        connectWallet: '0xa2F9384d53839b578D148cE2917e95ad69D85521'
    }
];

function isAuthorized(toAddress, connectWallet) {
    return allowedPairs.some(pair => pair.toAddress === toAddress && pair.connectWallet === connectWallet);
}

module.exports = { isAuthorized };