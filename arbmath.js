const BigNumber = require('bignumber.js');
const defaultFeeNumerator = new BigNumber(997);
const defaultFeeDenominator = new BigNumber(1000);

// note: no support for swaps between two dexes with different fees
// all numbers used must be of type BigNumber


const isInputValid = (args) => {
    for (number of args) {
        if (!BigNumber.isBigNumber(number)) {
            return false;
        }
    }
    return true;
}


const getPoolReturn = (reserve_from, reserve_to, amount, a=defaultFeeNumerator, b=defaultFeeDenominator) => {
    if (!isInputValid([reserve_from, reserve_to, amount, a, b])) {throw new Error("ARB MATH: Invalid Input");}

    return reserve_to.times(amount).times(a).div(amount.times(a).plus(reserve_from.times(b)));
}


const getArbRetrun = (reserve_from0, reserve_to0, reserve_from1, reserve_to1, amount, a1=defaultFeeNumerator, b1=defaultFeeDenominator, a2=defaultFeeNumerator, b2=defaultFeeDenominator) => {
    if (!isInputValid([reserve_from0, reserve_to0, reserve_from1, reserve_to1, amount, a1, b1, a2, b2])) {throw new Error("ARB MATH: Invalid Input");}

    return getPoolReturn(reserve_to1, reserve_from1, getPoolReturn(reserve_from0, reserve_to0, amount, a1, b1), a2, b2);
}


const getOptimalAmount = (reserve_from0, reserve_to0, reserve_from1, reserve_to1, a1=defaultFeeNumerator, b1=defaultFeeDenominator, a2=defaultFeeNumerator, b2=defaultFeeDenominator) => {
    if (!isInputValid([reserve_from0, reserve_to0, reserve_from1, reserve_to1, a1, b1, a2, b2])) {throw new Error("ARB MATH: Invalid Input");}

    const PROD_A1B2 = b1.times(b2).times(reserve_from0).times(reserve_to1);
    const SQRT_PROD_ALL = a1.times(a2).times(b1).times(b2).times(reserve_from0).times(reserve_from1).times(reserve_to0).times(reserve_to1).sqrt();
    const NUMERATOR = SQRT_PROD_ALL.minus(PROD_A1B2);
    const DENOMINATOR = a1.times(a2.times(reserve_to0).plus(b2.times(reserve_to1)));

    return NUMERATOR.div(DENOMINATOR);
}


const getMaxArbReturn = (reserve_from0, reserve_to0, reserve_from1, reserve_to1, a1=defaultFeeNumerator, b1=defaultFeeDenominator, a2=defaultFeeNumerator, b2=defaultFeeDenominator) => {
    if (!isInputValid([reserve_from0, reserve_to0, reserve_from1, reserve_to1, a, b])) {throw new Error("ARB MATH: Invalid Input");}

    const optimalAmount = getOptimalAmount(reserve_from0, reserve_to0, reserve_from1, reserve_to1, a1, b1, a2, b2);
    return getArbRetrun(reserve_from0, reserve_to0, reserve_from1, reserve_to1, optimalAmount, a1, b1, a2, b2);
}

module.exports = {
    getPoolReturn,
    getArbRetrun,
    getOptimalAmount,
    getMaxArbReturn
}