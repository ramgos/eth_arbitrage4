const Web3 = require('web3');
const BigNumber = require('bignumber.js');
const _ = require('lodash');

const config = require('./data/config.json');
const web3 = new Web3(config.WSS_RPC);

const blockTransactions = new Array();
const blockPendingTransactionsToGasPrices = new Array(new Map());


// return new map where every transaction's gas price is less than maxGasPrice
const chopByGasPrice = (pendingTransactionsToGasPrices, maxGasPrice) => {
    const maxGasPriceBn = new BigNumber(maxGasPrice);
    return new Map([...pendingTransactionsToGasPrices.entries()].filter(([txHash, gasPrice]) => maxGasPriceBn.isGreaterThanOrEqualTo(new BigNumber(gasPrice))));
}


// return a map of txHashes to gasPrices that appear in a block that were pending during a block
const pendingTxsWithGOrLessInBlock = (pendingTransactionsToGasPrices, maxGasPrice, blockTransactionsSet) => {
    return new Map([...chopByGasPrice(pendingTransactionsToGasPrices, maxGasPrice).entries()].filter(([txHash, gasPrice]) => blockTransactionsSet.has(txHash)));
}


// divide amount of previously pending transactions during block N that were approved during K (K > N) by the tx count of pending transactions during block N
const probPendingTxsWithGOrLessInBlock = (pendingTransactionsToGasPrices, maxGasPrice, blockTransactionsSet) => {
    return (new BigNumber(
        pendingTxsWithGOrLessInBlock(
            pendingTransactionsToGasPrices,
            maxGasPrice,
            blockTransactionsSet
        ).size
    )).div(new BigNumber(pendingTransactionsToGasPrices.size));
}


// like probPendingTxsWithGOrLessInBlock but for array and returns sum of probabilites
const probPendingTxsWithGOrLessInBlocksArray = (pendingTransactionsToGasPrices, maxGasPrice, blockTransactionsSetArray) => {
    return blockTransactionsSetArray.map((blockTransactionsSet) => probPendingTxsWithGOrLessInBlock(pendingTransactionsToGasPrices, maxGasPrice, blockTransactionsSet))
        .reduce((a, b) => a.plus(b), new BigNumber(0));
}


const timeAndGasPriceToChances = (blockPendingTransactionsToGasPricesTAG, maxGasPrice, blockTransactionsTAG, inXBlocksOrLess, sampleSize) => {
    return blockPendingTransactionsToGasPricesTAG.slice(0, -2 -inXBlocksOrLess).map((pendingTransactionsToGasPrices, index) => {
        return probPendingTxsWithGOrLessInBlocksArray(
            pendingTransactionsToGasPrices,
            maxGasPrice,
            blockTransactionsTAG.slice(index + 1, index + inXBlocksOrLess)
        ).toString();
    }).slice(-sampleSize);
}


web3.eth.subscribe('pendingTransactions', (error, txHash) => {
    if (error || !txHash) { /*console.trace(error);*/ return; }
    web3.eth.getTransaction(txHash, (error, tx_data) => {
        if (error || !tx_data) { /*console.trace(error);*/; return; }

        blockPendingTransactionsToGasPrices[blockPendingTransactionsToGasPrices.length - 1].set(txHash, tx_data.gasPrice);
    });
});


web3.eth.subscribe('newBlockHeaders', (error, newBlockHeader) => {
    if (error || !newBlockHeader) { /*console.trace(error);*/ return; }
    blockPendingTransactionsToGasPrices.push(new Map());

    web3.eth.getBlock(newBlockHeader.hash, (error, newBlockData) => {
        if (error || !newBlockData) { /*console.trace(error);*/ return; }

        blockTransactions.push(new Set(newBlockData.transactions));
        console.log(timeAndGasPriceToChances(
            blockPendingTransactionsToGasPrices,
            '2000000000',
            blockTransactions,
            15,
            20
        ));
    });
})
