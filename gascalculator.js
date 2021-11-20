const Web3 = require('web3');
const BigNumber = require('bignumber.js');

const extraMath = require('./extramath.js');

const consts = require('./data/consts.json');

const { logger } = require('./logger.js');
// const { getWeb3 } = require('./web3provider.js');

// get gas prices sorted of all transactions in each block in the past n blocks
const getBlockGasDataArray = async (n, web3) => {
    return new Promise((resolve, reject) => {
        web3.eth.getBlockNumber(async (error, blockNumber) => {
            if (error) {
                const ERROR_MSG = "gascalculator.js: Could not get initial block number";

                logger.error(error, {meta: {msg: ERROR_MSG}});
                reject(ERROR_MSG);
            }
            else {
                try {
                    const rawBlockData = await Promise.all([...Array(n).keys()].reverse().map(i => web3.eth.getBlock(blockNumber - i, true)));
                    const blockGasDataArray = rawBlockData.map(blockData => blockData.transactions.map(txData => txData.gasPrice).sort(extraMath.compareBN));
                    resolve(blockGasDataArray);
                } catch (error) {
                    const ERROR_MSG = "gascalculator.js: Failure to fetch block gas data";
                    logger.error(error, {meta: {msg: ERROR_MSG}});
                    reject(ERROR_MSG);
                }
            }
        });
    });
}


// sqrt weighted average of p precentile amongst last n blocks
const getGasPrice = (p, n, web3) => {
    return new Promise((resolve, reject) => {
        getBlockGasDataArray(n, web3)
            .then((blockGasDataArray) => {
                const targetPrecentile = new BigNumber(p);
                const precentileGasPrices = blockGasDataArray.map(blockGasData => extraMath.precentile(blockGasData, targetPrecentile));
                const acceptableGasPrice = extraMath.ceil(extraMath.sqrtWeightedAverage(precentileGasPrices));

                resolve(acceptableGasPrice);
            })
            .catch((reason) => {
                const ERROR_MSG = "gascalculator.js: Failed to get gas price";
                logger.error(reason, {meta: {msg: ERROR_MSG}});
                reject(ERROR_MSG);
            });
    });
}

const getGasPriceDefault = (web3) => getGasPrice(consts.ACCEPTABLE_PRECENTILE, consts.SAMPLE_SIZE, web3);

module.exports = {
    getGasPrice,
    getGasPriceDefault
}
