# eth_arbitrage4

Monitor new blocks for swap transactions from a list of known dexes (`data/dexes.json`).
Computes optimal trade for every possible dex pair and executes if any of them are profitable.

succesful transaction example (0.0002$ net profit):
https://polygonscan.com/tx/0x017f07944534b1903051c9109feede2b729d418a1ef6d0be2b207173dd428175
