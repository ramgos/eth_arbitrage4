const Web3 = require('web3');
const config = require('./data/config.json');

//*********************************\\
// Gas Price Calculation Prototype \\
//*********************************\\

const web3 = new Web3(config.WSS_RPC);
const pendingTxHashToInfo = new Map();

web3.eth.subscribe('pendingTransactions', (error, tx_hash) => {
    if (!error && tx_hash) {
        web3.eth.getTransaction(tx_hash, (error, tx_data) => {
            if (!error && tx_data) {
                pendingTxHashToInfo.set(tx_hash, {
                    timeSent: Date.now(),
                    gasPrice: tx_data.gasPrice,
                    timeTook: null
                });
            }
        });
    }
});

web3.eth.subscribe('newBlockHeaders', (error, blockHeader) => {
    if (!error && blockHeader) {
        web3.eth.getBlock(blockHeader.hash, (error, blockData) => {
            const timeNow = Date.now();
            blockData.transactions.forEach(tx_hash => {
                if (pendingTxHashToInfo.has(tx_hash)) {
                    pendingTxHashToInfo.get(tx_hash).timeTook = timeNow - pendingTxHashToInfo.get(tx_hash).timeSent;
                    console.log(pendingTxHashToInfo.get(tx_hash));
                }                
            });
        });
    }
});