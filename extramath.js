const BigNumber = require('bignumber.js');

// all numbers used must be of type BigNumber

const floor = (bn) => new BigNumber(bn.toFixed(0, BigNumber.ROUND_FLOOR));
const ceil = (bn) => new BigNumber(bn.toFixed(0, BigNumber.ROUND_CEIL));

module.exports = {
    floor,
    ceil
}