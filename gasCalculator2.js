const Web3 = require('web3');
const BigNumber = require('bignumber.js');
const _ = require('lodash');
const config = require('./data/config.json');

const web3 = new Web3(config.WSS_RPC);
const pendingTxHashToGasPrice = new Map();

const EXPIRY_TIME = 20000;
const SAMPLE_SIZE = 5;

let precentile = 0.5;
let precentileGasPrices = new Array();
let pXPrecentilesOfPassedTxGasPrice = new Array();


const sortStringToBN = (arr) => {
    return arr.sort((a, b) => {
        return (new BigNumber(a[0])).comparedTo(new BigNumber(b[0]));
    });
}


const getPrecentile = (precentile, arr) => {
    const sorted = sortStringToBN(arr);
    return sorted[Math.floor(sorted.length * precentile)];
}


const getWeightedAveragePrecentile = (arr) => {
    let sum = new BigNumber(0);
    let weightSum = new BigNumber(0);
    for (let i = 0; i < arr.length; i++) {
        const weight = (new BigNumber(i)).plus(new BigNumber(1));
        sum = sum.plus(weight.times(arr[i]));
        weightSum = weightSum.plus(weight);
    }
    const weightedAverage = sum.div(weightSum);
    return weightedAverage;
}


const itemToPrecentile = (item, arr) => {
    const sortedArr = sortStringToBN(arr);
    for (let i = 0; i < sortedArr.length; i++) {
        if (item === sortedArr[i]) {
            return i / sortedArr.length;
        }
    }
    throw new Error("Item not in array");
}


web3.eth.subscribe('pendingTransactions', (error, tx_hash) => {
    if (error || !tx_hash) { return; }
    web3.eth.getTransaction(tx_hash, (error, tx_data) => {
        if (error || !tx_data) { return; }

        pendingTxHashToGasPrice.set(tx_hash, tx_data.gasPrice);

        setTimeout(() => {
            pendingTxHashToGasPrice.delete(tx_hash);
        }, EXPIRY_TIME);  
    });
});

web3.eth.subscribe('newBlockHeaders', (error, blockHeader) => {
    if (error || !blockHeader) { return; }

    const pendingTxHashToGasPriceCOPY = _.cloneDeep(pendingTxHashToGasPrice);

    web3.eth.getBlock(blockHeader.hash, (error, blockData) => {
        if (error || !blockData) { return; } 

        const passedPendingTxsGasPrices = new Array();
        blockData.transactions.forEach((txHash) => {
            if (pendingTxHashToGasPriceCOPY.has(txHash)) { 
                passedPendingTxsGasPrices.push(pendingTxHashToGasPriceCOPY.get(txHash));
            }
        });
        if (passedPendingTxsGasPrices.length > 0) {
            const acceptableGasPrice = getPrecentile(0, passedPendingTxsGasPrices);
            const newBlockAcceptablePrecentile = itemToPrecentile(acceptableGasPrice, [...pendingTxHashToGasPriceCOPY.values()]);
    
            pXPrecentilesOfPassedTxGasPrice.push(newBlockAcceptablePrecentile);
            pXPrecentilesOfPassedTxGasPrice = pXPrecentilesOfPassedTxGasPrice.slice(-1 * SAMPLE_SIZE);
    
            precentile = getWeightedAveragePrecentile(pXPrecentilesOfPassedTxGasPrice).toNumber();
            console.log(`new precentile: ${precentile}`);
        }

        blockData.transactions.forEach((txHash) => {
            if (pendingTxHashToGasPrice.has(txHash)) { 
                pendingTxHashToGasPrice.delete(txHash);
            }
        });

        precentileGasPrices.push(new BigNumber(getPrecentile(precentile, [...pendingTxHashToGasPrice.values()])));
        precentileGasPrices = precentileGasPrices.slice(-1 * SAMPLE_SIZE);

        locked = false;
    });
});

setInterval(() => {
    console.log(getWeightedAveragePrecentile(precentileGasPrices).toString());
}, 4000);