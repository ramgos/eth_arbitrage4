## About consts.json

ETH - Address of ETH
WMATIC - address of WMATIC
EXPIRY (ms) - Max delay between swap event fire and sending arb transaction
GASPRICE_THROTTLE (ms) - How much time to cache gas price estimation
ACCEPTABLE_PRECENTILE - What precentile is deemed acceptable in order to get into the next block
SAMPLE_SIZE - How much blocks to sample for gas price calculation
GAS_PRECENT - What precentage of transaction profit to delegate to paying the gas
GAS_OVERESTIMATE - Add buffer to gas estimation (multiply GAS_OVERESTIMATE by gasEstimated)
DEADLINE (ms) - deadline for arb transaction after sending, handled in the contract