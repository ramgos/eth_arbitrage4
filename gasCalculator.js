const Web3 = require('web3');
const BigNumber = require('bignumber.js');
const _ = require('lodash');
const config = require('./data/config.json');

const web3 = new Web3(config.WSS_RPC);
const pendingTxHashToInfo = new Map();
const blockToPendingTxHash = new Map();
const blockToGasPricesToChances = new Map();


const EXPIRY_TIME = 60000;
const DEPTH = 10;

let lastBlockNumber = 0;
let firstBlockNumber = 0;
let locked = true;  // events locked until gotten block number


const defaultProbabiltyObject = (size) => {
    const returnObject = {};
    for (let i = 1; i < size + 1; i++) {
        returnObject[i] = 0;
    }
    return returnObject;
}


// apply smoothing (add yes values from gas prices below, add no values from gas prices above)
const orderedSmoothedGasPriceToChances = (gasPriceToChances) => {
    const gasPriceChancesSmoothedUnordered = new Map();

    gasPriceToChances.forEach((valueI, keyI, mapI) => {
        const bnGasPrice = new BigNumber(keyI);
        const yesNo = _.cloneDeep(valueI);

        gasPriceToChances.forEach((valueJ, keyJ, mapJ) => {
            if (keyJ === keyI) { return; }
            if (bnGasPrice.isGreaterThan(new BigNumber(keyJ))) {
                Object.keys(valueJ.yes).forEach((key) => {
                    yesNo.yes[key] += valueJ.yes[key];
                });
            }
            else {
                Object.keys(valueJ.no).forEach((key) => {
                    yesNo.no[key] += valueJ.no[key];
                });
            }
        });
        gasPriceChancesSmoothedUnordered.set(keyI, yesNo);
    });

    const gasPriceChancesSmoothedOrdered = new Map([...gasPriceChancesSmoothedUnordered].sort((a, b) => {
        return (new BigNumber(a[0])).comparedTo(new BigNumber(b[0])); 
    }));

    return gasPriceChancesSmoothedOrdered;
}


web3.eth.getBlockNumber((error, blockNumber) => {
    if (error || !blockNumber) {
        throw new Error("initial block number not succesful");
    }
    lastBlockNumber = blockNumber;
    firstBlockNumber = blockNumber;
    locked = false;
});


// place pending transactions in maps with block number when they were sent, and their gas price
web3.eth.subscribe('pendingTransactions', (error, tx_hash) => {
    if (locked) { return; }
    if (error || !tx_hash) { return; }  // handle error here
    web3.eth.getTransaction(tx_hash, (error, tx_data) => {
        if (error || !tx_data) { return; }  //handle error here
        
        const pendingTxInfo = {
            blockSent: lastBlockNumber,
            gasPrice: tx_data.gasPrice
        }
        pendingTxHashToInfo.set(tx_hash, pendingTxInfo);
        if (!blockToPendingTxHash.has(lastBlockNumber)) {
            blockToPendingTxHash.set(lastBlockNumber, new Array());
        }
        blockToPendingTxHash.get(lastBlockNumber).push(tx_hash);

        if (!blockToGasPricesToChances.has(lastBlockNumber)) {
            blockToGasPricesToChances.set(lastBlockNumber, new Map());
        }
        setTimeout(() => {
            pendingTxHashToInfo.delete(tx_hash);
        }, EXPIRY_TIME);
    });
});


web3.eth.subscribe('newBlockHeaders', (error, blockHeader) => {
    if (locked) { return; }
    if (error || !blockHeader) { return; }  // handle error here

    lastBlockNumber = blockHeader.number;
    const thisBlockNumber = blockHeader.number;  // copy blocknumber to const so new event fire won't mess calculations of prev event fire mid calc

    web3.eth.getBlock(blockHeader.hash, (error, blockData) => {
        if (error || !blockData) { return; }  // handle error here
        // set of all transactions approved in block
        const blockTransactions = new Set(blockData.transactions);
        
        // iterate over 10 blocks before this
        for (let i = 1; i < DEPTH + 1; i++) {
            // break if no data about block
            if (!blockToPendingTxHash.has(thisBlockNumber - i)) { break; }

            // create map if key value pair hasn't been initialized
            if (!blockToGasPricesToChances.has(thisBlockNumber - i)) {
                blockToGasPricesToChances.set(thisBlockNumber - i, new Map());
            }

            // iterate over all pending transactions that existed when block was most recent
            blockToPendingTxHash.get(thisBlockNumber - i).forEach((pendingTxHash) => {
                // skip if pending transaction has been resolved
                if (!pendingTxHashToInfo.has(pendingTxHash)) { return; }

                const pendingTxGasPrice = pendingTxHashToInfo.get(pendingTxHash).gasPrice;
                const blocksTook = i;

                // check if met a transaction within the same block with said gas price before, and if not initialize chances
                if (!blockToGasPricesToChances.get(thisBlockNumber - i).has(pendingTxGasPrice)) {
                    blockToGasPricesToChances.get(thisBlockNumber - i).set(pendingTxGasPrice, {
                        yes: defaultProbabiltyObject(DEPTH),
                        no: defaultProbabiltyObject(DEPTH)
                    });
                }

                // increment yes/no section based on whether tha block included the transaction.
                if (blockTransactions.has(pendingTxHash)) {
                    blockToGasPricesToChances.get(thisBlockNumber - i).get(pendingTxGasPrice).yes[blocksTook] += 1;
                    pendingTxHashToInfo.delete(pendingTxHash);
                }
                else {
                    blockToGasPricesToChances.get(thisBlockNumber - i).get(pendingTxGasPrice).no[blocksTook] += 1;
                }
            });
        }

        if (!blockToGasPricesToChances.has(firstBlockNumber + 1)) { return; }
        console.log(orderedSmoothedGasPriceToChances(blockToGasPricesToChances.get(firstBlockNumber + 1)));
    });
});

/**
 * How to read blockToGasPricesToChances:
 *      (Map) blockNumber: int -> gasPrice: string -> chances: object
 *      How to read chances for G gasPrice from N block in map:
 *      
 *          yes.1, yes.2, ... -> number of transactions that were 
 *                                   pending during block N 
 *                                   with G gas price 
 *                                   that were approved in block N + 1, 
 *                                   number of ... that were approved in block N + 2, 
 *          no.1, no2, ... -> number of transactions 
 *                                that were still pending on block N + 1 
 *                                since block N 
 *                                with G gas price, number of transactions that were still pending on block N + 1 ...
 *  
 *      To get number of transactions with G gas price that were sent during N 
 *      that were approved in 3 blocks or less - get sum from yes.3 to yes.1, 
 *      and to get the number of transaction with G gas price that were sent during N 
 *      and were still pending after 3 blocks - get no.3
 *  
 *      To get the probabilty that a transaction with G gas price that was sent during N would be approved in less than A blocks,
 *      sum all 'yes' probabilities of every gas price of transactions that were sent during N lower than or equal to G, 
 *      and sum all 'no' probabilites of every gas price of transactions that were sent during N greater than or equal to G
 *  
 */