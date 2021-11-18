const Web3 = require('web3');
const BigNumber = require('bignumber.js');

const extraMath = require('./extramath.js');

const consts = require('./data/consts.json');
const config = require('./data/config.json');

const { getWeb3 } = require('./web3provider.js');

// get gas prices sorted of all transactions in each block in the past n blocks
const getBlockGasDataArray = (callback, n, web3) => {
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
const getGasPrice = (callback, p, n, web3) => {
    getBlockGasDataArray((blockGasDataArray) => {
        const targetPrecentile = new BigNumber(p);
        const precentileGasPrices = blockGasDataArray.map(blockGasData => extraMath.precentile(blockGasData, targetPrecentile));
        const acceptableGasPrice = extraMath.ceil(extraMath.sqrtWeightedAverage(precentileGasPrices));

        callback(acceptableGasPrice);
    }, n, web3);
}


// gas provider acts as a proxy with the functions in this script - default values set in ./data/consts.json
// if getGasPrice was called in the last GASPRICE_THROTTLE seconds, that result will be returned instead
class GasPriceProvider {
    constructor() {
        getWeb3()
            .then((web3) => {
                this.initialized = true;
                this.web3 = web3;
                this.throttle = consts.GASPRICE_THROTTLE;
                this.sampleSize = consts.SAMPLE_SIZE;
                this.acceptablePrecentile = consts.ACCEPTABLE_PRECENTILE;
                this.lastGasPrice = 0;
                this.lastCalled = 0;
                this.isWorkingNow = false;
                this.callbackQueue = new Array();
            })
            .catch((error) => {
                console.log("gas calculator could not connect to web3 provider");
                console.error(error);
                throw new Error("gas calculator could not connect to web3 provider");
            });
    }

    getGasPrice(callback) {
        if (!this.initialized) {
            console.log("gas calculator not initialized yet");
            throw new Error("gas calculator not initialized yet");
        }

        if (this.isWorkingNow) {
            this.callbackQueue.push(callback);
        }
        else {
            const delay = Date.now() - this.lastCalled 
            if (delay < this.throttle) {
                callback(this.lastGasPrice);
            }
            else {
                this.callbackQueue.push(callback);
                this.isWorkingNow = true;
                getGasPrice((gasPrice) => {
                    this.lastCalled = Date.now();
                    this.lastGasPrice = gasPrice;
                    
                    this.callbackQueue.forEach(pendingCallback => pendingCallback(gasPrice));
                    this.callbackQueue = new Array();
                    this.isWorkingNow = false;
                    
                }, this.acceptablePrecentile, this.sampleSize, this.web3);
            }
        }
    }
}

module.exports = {
    GasPriceProvider
}
