const Web3 = require('web3');
const BigNumber = require('bignumber.js');

const extraMath = require('./extramath.js');

const consts = require('./data/consts.json');
const config = require('./data/config.json');

const web3 = new Web3(config.WSS_RPC);


// get gas prices sorted of all transactions in each block in the past n blocks
const getBlockGasDataArray = (callback, n) => {
    web3.eth.getBlockNumber((error, blockNumber) => {
        if (error) {console.log(error); return;}
    
        const blockGasDataArray = new Array();

        const getBlocks = (i) => {
            if (i === -1) {
                callback(blockGasDataArray);
            }
            else {
                web3.eth.getBlock(blockNumber - i, true, (error, blockData) => {
                    if (error) {console.log(error); return;}
            
                    blockGasDataArray.push(blockData.transactions.map(txData => txData.gasPrice).sort(extraMath.compareBN));
                    getBlocks(i - 1);
                });
            }
        }

        getBlocks(n - 1);
    });
}


// sqrt weighted average of p precentile amongst last n blocks
const getGasPrice = (callback, p, n) => {
    getBlockGasDataArray((blockGasDataArray) => {
        const targetPrecentile = new BigNumber(p);
        const precentileGasPrices = blockGasDataArray.map(blockGasData => extraMath.precentile(blockGasData, targetPrecentile));
        const acceptableGasPrice = extraMath.ceil(extraMath.sqrtWeightedAverage(precentileGasPrices));

        callback(acceptableGasPrice);
    }, n);
}


// gas provider acts as a proxy with the functions in this script - default values set in ./data/consts.json
// if getGasPrice was called in the last GASPRICE_THROTTLE seconds, that result will be returned instead
class GasPriceProvider {
    constructor() {
        this.throttle = consts.GASPRICE_THROTTLE;
        this.sampleSize = consts.SAMPLE_SIZE;
        this.acceptablePrecentile = consts.ACCEPTABLE_PRECENTILE;
        this.lastGasPrice = 0;
        this.lastCalled = 0;
    }

    getGasPrice(callback) {
        const delay = Date.now() - this.lastCalled 
        if (delay < this.throttle) {
            console.log(`delay: ${delay}`);
            callback(this.lastGasPrice);
        }
        else {
            console.log('noble:');
            getGasPrice((gasPrice) => {
                this.lastCalled = Date.now();
                this.lastGasPrice = gasPrice;
                callback(gasPrice);
            }, this.acceptablePrecentile, this.sampleSize);
        }
    }
}

module.exports = {
    GasPriceProvider
}
