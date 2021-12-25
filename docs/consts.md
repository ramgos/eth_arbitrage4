## About consts.json

ETH - Address of ETH
WMATIC - address of WMATIC
EXPIRY (ms) - Max delay between swap event fire and sending arb transaction
GASPRICE_THROTTLE (ms) - How much time to cache gas price estimation
ACCEPTABLE_PRECENTILE (precentage) - What precentile is deemed acceptable in order to get into the next block
SAMPLE_SIZE - How much blocks to sample for gas price calculation
GAS_PRECENT (precentage)- What precentage of transaction profit to delegate to paying the gas
GAS_OVERESTIMATE (precentage) - Add buffer to gas estimation (multiply GAS_OVERESTIMATE by gasEstimated)
DEADLINE (block number) - deadline for arb transaction after sending, handled in the contract
MIN_OUTPUT_FACTOR (precentage) - how much to multiply the result of the first swap and require it to be the min output in first swap in
                    function call (i.e account for slippage in first swap)
MAX_GAS_PRICE - if total gas cost is bigger than MAX_GAS_PRICE, don't continue calculation
CHECKING_DELAY (ms) - how many milliseconds to wait before checking if hashes updated? (after sending transaction)
CANCEL_GASPRICE (precentage) by what precentage to overpay in order to cancel the transaction
CHECKS - how many times to check whether the transaction should be cancelled
TX_COUNT - how many of the same transaction to send (anti-copiers strat)
TX_DELAY (ms) - delay between every transaction of the same transaction sent