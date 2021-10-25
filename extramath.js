const BigNumber = require('bignumber.js');

// all numbers used must be of type BigNumber

const floor = (bn) => new BigNumber(bn.toFixed(0, BigNumber.ROUND_FLOOR));
const ceil = (bn) => new BigNumber(bn.toFixed(0, BigNumber.ROUND_CEIL));

const compareBN = (a, b) => (new BigNumber(a)).comparedTo(new BigNumber(b));  // use to sort BigNumber arrays
const averageBN = (arr) => arr.reduce((a, b) => a.plus(new BigNumber(b)), new BigNumber(0)).div(arr.length);  // get average of array as BigNumber


// weight = sqrt(index + 1)
const sqrtWeightedAverage = (arr) => {
    let weightSum = new BigNumber(0);
    const sum = arr.reduce((a, b, index) => {
        const weight = (new BigNumber(index + 1)).sqrt();
        weightSum = weightSum.plus(weight);
        return a.plus((new BigNumber(b)).times(weight));
    }, new BigNumber(0));

    return sum.div(weightSum);
}


// assumes array is sorted
const precentile = (arr, precent) => {
    const precentBN = new BigNumber(precent);
    const arrLengthBN = new BigNumber(arr.length);
    const pos = floor(precentBN.times(arrLengthBN)).toNumber();
    return arr[pos];
}


module.exports = {
    floor,
    ceil,
    compareBN,
    averageBN,
    sqrtWeightedAverage,
    precentile
}