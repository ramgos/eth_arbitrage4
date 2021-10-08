const Web3 = require('web3');
const BigNumber = require('bignumber.js');
const _ = require('lodash');

const config = require('./data/config.json');

const web3 = new Web3(config.WSS_RPC);
const pendingTxHashToInfo = new Map();
const blockToPendingTxHash = new Map();
const blockToGasPricesToChances = new Map();

const EXPIRY_TIME = 600000;
const DEPTH = 30;
const gweiMatch = /([0-9]{1,})[0-9]{9}/;

let lastBlockNumber = 0;  // not actual block number, but block counter


const ErrorCode = {
    EmptyHistory: "EmptyHistory",
    GasTooLow: "GasTooLow",
}


const defaultProbabiltyObject = (size) => {
    const returnObject = {};
    for (let i = 1; i < size + 1; i++) {
        returnObject[i] = 0;
    }
    return returnObject;
}


const addYes = (yesTo, yesFrom, weight) => {
    Object.keys(yesTo).forEach((key) => {
        yesTo[key] += yesFrom[key] * weight;
    });
}

const addNo = (noTo, noFrom, weight) => {
    Object.keys(noTo).forEach((key) => {
        noTo[key] += noFrom[key] * weight;
    });
}

const addYesNo = (yesNoTo, yesNoFrom, weight) => {
    addYes(yesNoTo.yes, yesNoFrom.yes, weight);
    addNo(yesNoTo.no, yesNoFrom.no, weight);
}


const addYesNoIterable = (yesNoTo, yesNoFromArray, weight) => {
    for (let i = 0; i < yesNoFromArray.length; i++) {
        addYesNo(yesNoTo, yesNoFromArray[i], weight);
    }
}


const clumpGasPrices = (gasPriceToChances) => {
    const gasPriceToChancesClumped = new Map();
    const groupedByGwei = _.groupBy([...gasPriceToChances.entries()], ([gasPrice, yesNo]) => {
        const match = gasPrice.match(gweiMatch);
        if (!match) {
            return "-1";
        }
        else {
            return match[1];
        }
    });
    Object.entries(groupedByGwei).forEach(([gwei, gasPriceToChancesArray]) => {
        const wei = gwei + '000000000';
        const baseYesNo = gasPriceToChancesArray.shift()[1];
        addYesNoIterable(baseYesNo, gasPriceToChancesArray.map(([gasPrice, yesNo]) => yesNo), 1);
        gasPriceToChancesClumped.set(wei, baseYesNo);
    });
    return gasPriceToChancesClumped;
}


// apply smoothing (add yes values from gas prices below, add no values from gas prices above) no order
const smoothedGasPriceToChances = (gasPriceToChances) => {
    const gasPriceChancesSmoothedUnordered = new Map();
    const clumpedGasPriceToChances = clumpGasPrices(gasPriceToChances);
    clumpedGasPriceToChances.forEach((valueI, keyI) => {
        const bnGasPrice = new BigNumber(keyI);
        const yesNo = _.cloneDeep(valueI);

        clumpedGasPriceToChances.forEach((valueJ, keyJ) => {
            if (keyJ === keyI) { return; }
            if (bnGasPrice.isGreaterThan(new BigNumber(keyJ))) {
                addYes(yesNo.yes, valueJ.yes, 1);
            }
            else {
                addNo(yesNo.no, valueJ.no, 1);
            }
        });
        gasPriceChancesSmoothedUnordered.set(keyI, yesNo);
    });

    return gasPriceChancesSmoothedUnordered;
}


// sum yes no objects in array with weight equal to pos in array
const summedOrderedSmoothedGasPricesToChances = (gasPriceToChancesArray) => {
    const orderedSmoothGasPricesToChances = gasPriceToChancesArray.map(smoothedGasPriceToChances);
    let summedGasPricesToChances = new Map();
    for (let i = 0; i < gasPriceToChancesArray.length; i++) {
        const gasPriceToChances = orderedSmoothGasPricesToChances[i];
        const weight = 1;

        gasPriceToChances.forEach((yesNo, gasPrice) => {
            if (!summedGasPricesToChances.has(gasPrice)) {
                summedGasPricesToChances.set(gasPrice, {
                    yes: defaultProbabiltyObject(DEPTH),
                    no: defaultProbabiltyObject(DEPTH)
                });
            }
            addYesNo(summedGasPricesToChances.get(gasPrice), yesNo, weight);
        });
    }

    // order
    const summedGasPricesToChancesOrdered = new Map([...summedGasPricesToChances].sort((a, b) => {
        return (new BigNumber(a[0])).comparedTo(new BigNumber(b[0])); 
    }));

    return summedGasPricesToChancesOrdered;
}


// see bottom comment
const processYesNo = (yesNo, inXBlocksOrLess) => {
    let yes = 0;
    let no = 0;

    for (let i = inXBlocksOrLess; i > 0; i--) { yes += yesNo.yes[i];}
    no = yesNo.no[inXBlocksOrLess];

    return [yes, no];
}


// get summed chances of DEPTH last blocks of gasPrice
const gasAndTimeToChance = (gasPrice, inXBlocksOrLess) => {
    const summedGasPricesToChances = summedOrderedSmoothedGasPricesToChances([...blockToGasPricesToChances.values()].slice(-1 * (DEPTH * 2 + 1), -1));
    const bnGasPrice = new BigNumber(gasPrice)
    const entries = [...summedGasPricesToChances.entries()];

    if (entries.length === 0 ) { throw new Error(ErrorCode.EmptyHistory); }

    // possible optimization: binary search
    for (let i = 0; i < entries.length - 1; i++) {
        const left = entries[i];
        const right = entries[i + 1];
        const leftGasPrice = new BigNumber(left[0]);
        const rightGasPrice = new BigNumber(right[0]);

        if (bnGasPrice.isGreaterThan(rightGasPrice)) {
            continue;
        }
        else {
            if (bnGasPrice.isGreaterThan(leftGasPrice)) {
                return processYesNo(left[1], inXBlocksOrLess);
            }
            else {
                throw new Error(ErrorCode.GasTooLow);
            }
        }
    }
    
    return processYesNo(entries[entries.length - 1][1], inXBlocksOrLess);
}


// place pending transactions in maps with block number when they were sent, and their gas price
web3.eth.subscribe('pendingTransactions', (error, tx_hash) => {
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
    if (error || !blockHeader) { return; }  // handle error here

    lastBlockNumber += 1;
    const thisBlockNumber = lastBlockNumber;  // copy blocknumber to const so new event fire won't mess calculations of prev event fire mid calc

    web3.eth.getBlock(blockHeader.hash, (error, blockData) => {
        if (error || !blockData) { return; }  // handle error here
        // set of all transactions approved in block
        const blockTransactions = new Set(blockData.transactions);
        

        // iterate over DEPTH blocks before this
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

        try {
            console.log(gasAndTimeToChance('35000000000', 3));
        }
        catch (error) {
            console.log(error);
        }
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